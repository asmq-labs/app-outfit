import base64
import json
import logging
from typing import Any

import httpx
from pydantic import BaseModel, ValidationError

from app.config import get_settings

BASE_URL = "https://openrouter.ai/api/v1"
# Outfits are generated inside a request, so a stuck model must fail soon and fall back.
CHAT_TIMEOUT_SECONDS = 45.0
# Images run in the worker, which has its own retries.
IMAGE_TIMEOUT_SECONDS = 120.0
CHAT_ATTEMPTS = 2

logger = logging.getLogger(__name__)


class AIError(Exception):
    pass


def validated[Reply: BaseModel](reply_type: type[Reply], data: Any) -> Reply:
    # The schema is a request to the model; this is what actually guarantees the shape.
    try:
        return reply_type.model_validate(data)
    except ValidationError as exc:
        raise AIError(f"reply does not match {reply_type.__name__}: {str(data)[:300]}") from exc


def _post(path: str, payload: dict[str, Any], timeout: float) -> dict[str, Any]:
    try:
        response = httpx.post(
            f"{BASE_URL}{path}",
            headers={"Authorization": f"Bearer {get_settings().openrouter_api_key}"},
            json=payload,
            timeout=timeout,
        )
        response.raise_for_status()
        return response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise AIError(f"OpenRouter request to {path} failed: {exc!r}") from exc


def image_data_url(image: bytes, mime_type: str = "image/jpeg") -> str:
    return f"data:{mime_type};base64,{base64.b64encode(image).decode()}"


def chat_json(
    model: str, prompt: str, schema: dict[str, Any], image: bytes | None = None
) -> dict[str, Any]:
    content: list[dict[str, Any]] = [{"type": "text", "text": prompt}]
    if image is not None:
        content.append({"type": "image_url", "image_url": {"url": image_data_url(image)}})
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": content}],
        "response_format": {
            "type": "json_schema",
            "json_schema": {"name": "result", "strict": True, "schema": schema},
        },
        # Only providers that honor the schema: others would silently ignore it.
        "provider": {"require_parameters": True},
    }
    last_error: AIError | None = None
    for _ in range(CHAT_ATTEMPTS):
        try:
            body = _post("/chat/completions", payload, CHAT_TIMEOUT_SECONDS)
            logger.info("chat model=%s usage=%s", model, body.get("usage"))
            return json.loads(body["choices"][0]["message"]["content"])
        except AIError as exc:
            last_error = exc
        except (KeyError, IndexError, TypeError, ValueError) as exc:
            last_error = AIError(f"unexpected chat response: {str(body)[:300]}")
            last_error.__cause__ = exc
    raise last_error


def generate_image(model: str, prompt: str, reference: bytes | None = None) -> bytes:
    payload: dict[str, Any] = {"model": model, "prompt": prompt, "aspect_ratio": "1:1", "n": 1}
    if reference is not None:
        payload["input_references"] = [
            {"type": "image_url", "image_url": {"url": image_data_url(reference)}}
        ]
    body = _post("/images", payload, IMAGE_TIMEOUT_SECONDS)
    try:
        return base64.b64decode(body["data"][0]["b64_json"])
    except (KeyError, IndexError, TypeError, ValueError) as exc:
        raise AIError(f"unexpected image response: {str(body)[:300]}") from exc
