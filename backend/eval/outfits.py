"""Blind comparison of outfit recommendation variants on a real closet.

generate: python -m eval.outfits generate <user_id> [--strong-model MODEL]  (paid, prints real cost)
score:    python -m eval.outfits score <results.json>
"""

import argparse
import base64
import datetime as dt
import hashlib
import io
import json
import random
import time
import uuid
from collections import defaultdict
from pathlib import Path

import httpx
from PIL import Image, ImageDraw
from sqlalchemy import select

from app.ai import openrouter
from app.ai import outfits as ai
from app.config import get_settings
from app.db import SessionLocal
from app.models import Garment, GarmentCategory, GarmentStatus, Occasion, User
from app.outfits.candidates import select_candidates
from app.outfits.service import BATCH_SIZE, _is_wearable
from app.outfits.weather import Forecast
from app.storage import get_storage

OUT = Path(__file__).parent / "out"
CREDITS_SETTLE_SECONDS = 90
DAY = dt.date(2026, 1, 15)

# The prompt before style notes, kept here as the baseline to beat.
BASELINE_PROMPT = """You are a personal stylist. Build {count} different outfits for {occasion} \
using ONLY the garments listed below, which the person already owns.

Weather today: {weather}

Garments (JSON): {garments}

Rules:
- Every outfit needs shoes, plus either one top and one bottom, or one one_piece. Never both.
- {outerwear_rule}
- An accessory is optional, at most one.
- Use each garment only in the slot of its own category and refer to it by its "ref".
- Prefer combinations whose colors and formality work well together.
- The outfits must differ from each other in their top, bottom or one_piece.
- Do not repeat any of these combinations already shown today: {seen}
- If fewer than {count} good outfits are possible, return fewer.
- "explanation": one short sentence, at most 20 words, in neutral Latin American Spanish, \
addressing the person as "tú", saying why the outfit works today. Talk about the outfit, never \
describe the person: no adjectives or participles about them such as "cómodo", "protegida" or \
"abrigado"; use verbs instead ("te protege de la lluvia", "te mantiene a gusto"). No emojis, no \
garment refs. Mention only garments that are in that outfit."""

IMAGE_NOTE = """

The attached image shows every garment labelled with its ref. Trust it over the written fields \
when judging color, texture and fit."""

C, W, N, F = Occasion.CASUAL, Occasion.WORK, Occasion.NIGHT_OUT, Occasion.FORMAL
SCENARIOS = [
    (C, Forecast(24, 32, False), "Casual, día caluroso"),
    (C, Forecast(13, 21, False), "Casual, día templado"),
    (C, Forecast(6, 13, False), "Casual, día frío"),
    (C, Forecast(12, 19, True), "Casual, lluvia"),
    (W, Forecast(24, 31, False), "Trabajo, día caluroso"),
    (W, Forecast(13, 21, False), "Trabajo, día templado"),
    (W, Forecast(11, 18, True), "Trabajo, lluvia"),
    (N, Forecast(22, 30, False), "Salir, noche cálida"),
    (N, Forecast(12, 20, False), "Salir, noche templada"),
    (N, Forecast(6, 13, False), "Salir, noche fría"),
    (F, Forecast(13, 22, False), "Formal, día templado"),
    (F, Forecast(24, 31, False), "Formal, día caluroso"),
]


def _thumb(storage, garment: Garment, size: int) -> Image.Image:
    image = Image.open(io.BytesIO(storage.read(garment.image_path))).convert("RGB")
    image.thumbnail((size, size))
    return image


def _montage(storage, garments: list[Garment]) -> bytes:
    cell, columns = 260, 5
    rows = (len(garments) + columns - 1) // columns
    sheet = Image.new("RGB", (cell * columns, cell * rows), "white")
    draw = ImageDraw.Draw(sheet)
    for index, garment in enumerate(garments):
        x, y = cell * (index % columns), cell * (index // columns)
        sheet.paste(_thumb(storage, garment, cell - 20), (x + 10, y + 20))
        draw.text((x + 8, y + 4), f"g{index + 1}", fill="black")
    buffer = io.BytesIO()
    sheet.save(buffer, "JPEG", quality=85)
    return buffer.getvalue()


REVIEW_PROMPT = """You are a demanding head stylist reviewing outfits a junior proposed for \
{occasion}. Weather: {weather}. About the person: {profile}

Proposals (JSON): {proposals}

Pick the one a well-dressed person would most want to wear, judging formality coherence, color \
contrast on a neutral base, at most one protagonist piece, similar visual weight, and shoes that \
finish the outfit. Return its index, starting at 0."""

REVIEW_SCHEMA = {
    "type": "object",
    "properties": {"best": {"type": "integer"}},
    "required": ["best"],
    "additionalProperties": False,
}


def _review(choices, garments, occasion, forecast, profile, model):
    # Second pass under test: is a reviewer worth its extra call and wait?
    by_id = {g.id: g for g in garments}
    proposals = [
        {
            "index": index,
            "pieces": [ai.describe_garment("", by_id[g]) for g in c.garment_ids.values() if g],
        }
        for index, c in enumerate(choices)
    ]
    data = openrouter.chat_json(
        model,
        REVIEW_PROMPT.format(
            occasion=ai.OCCASION_DESCRIPTIONS[occasion],
            weather=ai._describe_weather(forecast),
            profile=json.dumps(profile, ensure_ascii=False),
            proposals=json.dumps(proposals, ensure_ascii=False),
        ),
        REVIEW_SCHEMA,
    )
    best = data.get("best", 0)
    return [choices[best]] if 0 <= best < len(choices) else choices


def _suggest(candidates, occasion, forecast, *, prompt, notes, model, storage=None, profile=None):
    # Patches instead of parameters, so production code carries nothing for this experiment.
    settings = get_settings()
    saved = ai.PROMPT, ai.describe_garment, settings.outfit_model, openrouter.chat_json
    real_describe, real_chat = saved[1], saved[3]
    ai.PROMPT = prompt
    settings.outfit_model = model
    if not notes:

        def without_notes(ref, garment, history=None):
            described = real_describe(ref, garment, history)
            return {k: v for k, v in described.items() if k != "style_notes"}

        ai.describe_garment = without_notes
    if storage is not None:
        garments = [g for group in candidates.by_category.values() for g in group]
        sheet = _montage(storage, garments)
        openrouter.chat_json = lambda m, p, s: real_chat(m, p, s, image=sheet)
    try:
        started = time.monotonic()
        choices = ai.sugerir_outfits(
            candidates, occasion, forecast, [], BATCH_SIZE, profile=profile
        )
        return choices, time.monotonic() - started
    finally:
        ai.PROMPT, ai.describe_garment, settings.outfit_model, openrouter.chat_json = saved


def _credits_used() -> float:
    response = httpx.get(
        f"{openrouter.BASE_URL}/credits",
        headers={"Authorization": f"Bearer {get_settings().openrouter_api_key}"},
        timeout=30,
    )
    response.raise_for_status()
    return response.json()["data"]["total_usage"]


def _problems(choice) -> list[str]:
    problems = []
    if not _is_wearable(choice):
        problems.append("outfit incompleto")
    if len(choice.explanation.split()) > 24:
        problems.append("explicación larga")
    if any(f"g{n}" in choice.explanation.lower().split() for n in range(1, 100)):
        problems.append("ref en el texto")
    return problems


def _data_url(storage, garment: Garment) -> str:
    buffer = io.BytesIO()
    _thumb(storage, garment, 280).save(buffer, "JPEG", quality=80)
    return f"data:image/jpeg;base64,{base64.b64encode(buffer.getvalue()).decode()}"


def generate(user_id: str, strong_model: str | None) -> None:
    base_model = get_settings().outfit_model
    storage = get_storage()
    with SessionLocal() as db:
        garments = list(
            db.scalars(
                select(Garment).where(
                    Garment.user_id == uuid.UUID(user_id), Garment.status == GarmentStatus.READY
                )
            )
        )
        variants = {
            "A_actual": {"prompt": BASELINE_PROMPT, "notes": False, "model": base_model},
            "B_notas_y_criterio": {"prompt": ai.PROMPT, "notes": True, "model": base_model},
            "C_con_imagenes": {
                "prompt": ai.PROMPT + IMAGE_NOTE,
                "notes": True,
                "model": base_model,
                "storage": storage,
            },
        }
        variants["E_con_revisor"] = {"prompt": ai.PROMPT, "notes": True, "model": base_model}
        if strong_model:
            variants["D_modelo_fuerte"] = {
                "prompt": ai.PROMPT,
                "notes": True,
                "model": strong_model,
            }

        owner = db.get(User, uuid.UUID(user_id))
        for name in variants:
            if name != "A_actual":
                variants[name]["profile"] = owner.style_profile
        cards: dict[str, dict] = {}
        key: dict[str, list[dict]] = {}
        stats: dict[str, dict] = defaultdict(lambda: {"seconds": [], "problems": [], "empty": 0})
        before = _credits_used()
        for occasion, forecast, label in SCENARIOS:
            candidates = select_candidates(garments, occasion, forecast, DAY)
            if candidates.missing:
                print(f"Se omite '{label}': faltan {candidates.missing}")
                continue
            for name, config in variants.items():
                try:
                    choices, seconds = _suggest(candidates, occasion, forecast, **config)
                except openrouter.AIError as exc:
                    print(f"{name} falló en '{label}': {exc}")
                    stats[name]["empty"] += 1
                    continue
                stats[name]["seconds"].append(seconds)
                valid = [c for c in choices if _is_wearable(c)]
                if not valid:
                    stats[name]["empty"] += 1
                    continue
                if name == "E_con_revisor" and len(valid) > 1:
                    started = time.monotonic()
                    valid = _review(
                        valid, garments, occasion, forecast, owner.style_profile, base_model
                    )
                    stats[name]["seconds"][-1] += time.monotonic() - started
                choice = valid[0]
                stats[name]["problems"] += [f"{label}: {p}" for p in _problems(choice)]
                ids = sorted(str(g) for g in choice.garment_ids.values() if g)
                card_id = hashlib.sha1(f"{label}|{ids}|{choice.explanation}".encode()).hexdigest()[
                    :10
                ]
                by_id = {g.id: g for g in garments}
                cards[card_id] = {
                    "id": card_id,
                    "label": label,
                    "explanation": choice.explanation,
                    "images": [
                        _data_url(storage, by_id[g])
                        for category in GarmentCategory
                        if (g := choice.garment_ids.get(category))
                    ],
                }
                key.setdefault(card_id, []).append({"variant": name, "label": label})
        # The counter lags behind the calls, so it is read after giving it time to settle.
        time.sleep(CREDITS_SETTLE_SECONDS)
        cost = _credits_used() - before

    OUT.mkdir(exist_ok=True)
    shuffled = list(cards.values())
    random.shuffle(shuffled)
    (OUT / "calificar.html").write_text(_page(shuffled), encoding="utf-8")
    (OUT / "key.json").write_text(json.dumps(key, ensure_ascii=False), encoding="utf-8")
    report = {
        name: {
            "segundos_promedio": round(sum(s["seconds"]) / max(len(s["seconds"]), 1), 1),
            "sin_resultado": s["empty"],
            "problemas": s["problems"],
        }
        for name, s in stats.items()
    }
    (OUT / "stats.json").write_text(json.dumps(report, ensure_ascii=False, indent=1), "utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=1))
    print(f"Tarjetas: {len(cards)}. Costo real: ${cost:.4f}")


def _page(cards: list[dict]) -> str:
    return (
        (Path(__file__).parent / "calificar.template.html")
        .read_text(encoding="utf-8")
        .replace("__CARDS__", json.dumps(cards, ensure_ascii=False))
    )


def score(results_path: str) -> None:
    key = json.loads((OUT / "key.json").read_text(encoding="utf-8"))
    results = json.loads(Path(results_path).read_text(encoding="utf-8"))
    totals: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for card_id, answer in results.items():
        for entry in key.get(card_id, []):
            totals[entry["variant"]][answer["wear"]] += 1
            totals[entry["variant"]]["explicacion_mala"] += int(answer.get("badText", False))
    for variant in sorted(totals):
        t = totals[variant]
        rated = t["si"] + t["maso"] + t["no"]
        share = 100 * t["si"] / rated if rated else 0
        print(
            f"{variant}: {share:.0f}% se lo pondría ({t['si']} sí, {t['maso']} más o menos, "
            f"{t['no']} no); explicaciones malas: {t['explicacion_mala']}"
        )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest="command", required=True)
    generate_parser = commands.add_parser("generate")
    generate_parser.add_argument("user_id")
    generate_parser.add_argument("--strong-model")
    commands.add_parser("score").add_argument("results")
    args = parser.parse_args()
    if args.command == "generate":
        generate(args.user_id, args.strong_model)
    else:
        score(args.results)
