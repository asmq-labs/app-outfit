import uuid

import httpx
import pytest

from app.ai import openrouter
from app.ai.inspirations import extraer_estilo
from app.ai.openrouter import AIError
from app.ai.outfits import MAX_EXPLANATION_CHARS, short_sentence, sugerir_outfits
from app.models import Formality, Garment, GarmentCategory, GarmentStatus, Occasion, Warmth
from app.outfits.candidates import select_candidates
from tests.test_outfits import TODAY


def piece(category):
    return Garment(
        id=uuid.uuid4(),
        status=GarmentStatus.READY,
        category=category,
        name=category.value,
        color="azul",
        warmth=Warmth.MEDIUM,
        formality=Formality.CASUAL,
        original_path="x.jpg",
    )


def closet():
    return [piece(GarmentCategory.TOP), piece(GarmentCategory.BOTTOM), piece(GarmentCategory.SHOES)]


def candidates():
    return select_candidates(closet(), Occasion.CASUAL, None, TODAY)


def test_a_short_sentence_stays_untouched():
    assert short_sentence("  El azul  y el gris.  ") == "El azul y el gris."


def test_a_long_text_is_cut_at_its_last_full_stop():
    first = "El azul combina con el gris y da un contraste tranquilo para todo el día."
    text = f"{first} {'Además aporta muchísimo equilibrio al conjunto completo ' * 3}"

    assert short_sentence(text) == first


def test_a_long_text_without_a_stop_is_cut_at_a_word():
    result = short_sentence("palabra " * 60)

    assert len(result) <= MAX_EXPLANATION_CHARS + 1
    assert result.endswith("palabra…")


@pytest.mark.parametrize(
    "reply",
    [
        ["not", "an", "object"],
        {"outfits": "nothing"},
        {"outfits": ["a string"]},
        {"outfits": [{"top": 3, "explanation": "x"}]},
    ],
)
def test_a_badly_shaped_outfit_reply_is_a_model_error_not_a_crash(monkeypatch, reply):
    monkeypatch.setattr(openrouter, "chat_json", lambda *a, **k: reply)

    with pytest.raises(AIError):
        sugerir_outfits(candidates(), Occasion.CASUAL, None, [], 3)


def test_outfit_slots_only_admit_refs_of_their_own_category(monkeypatch):
    schemas = []

    def answer(model, prompt, schema, **_):
        schemas.append(schema)
        return {"outfits": [{"top": "g1", "bottom": "g1", "explanation": "x" * 500}]}

    monkeypatch.setattr(openrouter, "chat_json", answer)

    choice = sugerir_outfits(candidates(), Occasion.CASUAL, None, [], 3)[0]

    slots = schemas[0]["properties"]["outfits"]["items"]["properties"]
    assert slots["top"]["enum"] == ["g1", None]
    assert slots["shoes"]["enum"] == ["g3", None]
    assert choice.garment_ids[GarmentCategory.BOTTOM] is None
    assert len(choice.explanation) <= MAX_EXPLANATION_CHARS + 1


def test_a_look_only_admits_refs_of_the_closet(monkeypatch):
    schemas = []

    def answer(model, prompt, schema, **_):
        schemas.append(schema)
        return {
            "is_look": True,
            "top": "g1",
            "shoes": "g1",
            "missing": [{"category": "outerwear", "name": "Abrigo camel"}],
            "explanation": "Tu versión.",
        }

    monkeypatch.setattr(openrouter, "chat_json", answer)
    pieces = closet()

    match = extraer_estilo(b"photo", pieces)

    assert schemas[0]["properties"]["top"]["enum"] == ["g1", None]
    assert match.garment_ids[GarmentCategory.TOP] == pieces[0].id
    assert match.garment_ids[GarmentCategory.SHOES] is None
    assert match.missing[0].name == "Abrigo camel"


def test_a_badly_shaped_look_reply_is_a_model_error(monkeypatch):
    monkeypatch.setattr(openrouter, "chat_json", lambda *a, **k: {"top": "g1"})

    with pytest.raises(AIError):
        extraer_estilo(b"photo", closet())


def good_chat_response(request):
    content = '{"ok": true}'
    return httpx.Response(
        200, json={"choices": [{"message": {"content": content}}]}, request=request
    )


class FakeApi:
    def __init__(self, *responses):
        self.responses = list(responses)
        self.payloads = []

    def post(self, url, headers, json, timeout):
        self.payloads.append(json)
        request = httpx.Request("POST", url)
        answer = self.responses.pop(0)
        if isinstance(answer, Exception):
            raise answer
        return answer(request)


def test_chat_retries_once_after_a_transient_failure(monkeypatch):
    fake = FakeApi(httpx.ConnectError("down"), good_chat_response)
    monkeypatch.setattr(openrouter.httpx, "post", fake.post)

    assert openrouter.chat_json("m", "p", {}) == {"ok": True}
    assert len(fake.payloads) == 2


def test_chat_retries_invalid_json_and_then_gives_up(monkeypatch):
    def garbage(request):
        return httpx.Response(
            200, json={"choices": [{"message": {"content": "no"}}]}, request=request
        )

    fake = FakeApi(garbage, garbage)
    monkeypatch.setattr(openrouter.httpx, "post", fake.post)

    with pytest.raises(AIError):
        openrouter.chat_json("m", "p", {})
    assert len(fake.payloads) == 2


def test_chat_only_goes_to_providers_that_honor_the_schema(monkeypatch):
    fake = FakeApi(good_chat_response)
    monkeypatch.setattr(openrouter.httpx, "post", fake.post)

    openrouter.chat_json("m", "p", {"type": "object"})

    assert fake.payloads[0]["provider"] == {"require_parameters": True}
    assert fake.payloads[0]["response_format"]["json_schema"]["strict"] is True
