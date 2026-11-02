import json

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.ai import openrouter
from app.config import get_settings
from app.db import SessionLocal
from app.models import Formality, Garment, GarmentStatus, User

PROMPT = (
    "These clothes were catalogued before the app knew about sportswear. Return the refs of the "
    "ones clearly made for exercise: leggings, gym shorts, sports bras, jerseys, tracksuits, "
    "running shoes, technical fabrics. Everyday sneakers, plain t-shirts, tank tops and jeans are "
    "not sportswear. When in doubt, leave it out.\nGarments (JSON): {garments}"
)
SCHEMA = {
    "type": "object",
    "properties": {"refs": {"type": "array", "items": {"type": "string"}}},
    "required": ["refs"],
    "additionalProperties": False,
}


def backfill_sport(db: Session) -> list[str]:
    changed = []
    for user_id in db.scalars(select(User.id)).all():
        garments = db.scalars(
            select(Garment).where(
                Garment.user_id == user_id,
                Garment.status == GarmentStatus.READY,
                Garment.formality == Formality.CASUAL,
                Garment.basic_key.is_(None),
            )
        ).all()
        if not garments:
            continue
        by_ref = {f"g{index}": garment for index, garment in enumerate(garments, start=1)}
        described = [
            {"ref": ref, "name": g.name, "style_notes": g.style_notes} for ref, g in by_ref.items()
        ]
        prompt = PROMPT.format(garments=json.dumps(described, ensure_ascii=False))
        data = openrouter.chat_json(get_settings().outfit_model, prompt, SCHEMA)
        for ref in data["refs"]:
            if ref in by_ref:
                by_ref[ref].formality = Formality.SPORT
                changed.append(f"{user_id} {by_ref[ref].name}")
        db.commit()
    return changed


if __name__ == "__main__":
    # Paid: one cheap text call per closet. Run once, and only clear sportswear changes.
    with SessionLocal() as session:
        print("\n".join(backfill_sport(session)) or "nothing changed")
