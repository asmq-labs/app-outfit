import json

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.ai import openrouter
from app.config import get_settings
from app.db import SessionLocal
from app.garments.basics import parse_key
from app.garments.tags import ALL_TAGS, BASIC_TAGS, TAGS_RULE, clean_tags
from app.models import Garment, GarmentStatus, User

PROMPT = (
    "Tag these clothes from what their description says. For each garment return its ref and "
    f"{TAGS_RULE}\nGarments (JSON): {{garments}}"
)
SCHEMA = {
    "type": "object",
    "properties": {
        "garments": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "ref": {"type": "string"},
                    "tags": {"type": "array", "items": {"type": "string", "enum": ALL_TAGS}},
                },
                "required": ["ref", "tags"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["garments"],
    "additionalProperties": False,
}


def backfill_tags(db: Session) -> tuple[int, int]:
    from_basics = from_model = 0
    for user_id in db.scalars(select(User.id)).all():
        garments = db.scalars(
            select(Garment).where(Garment.user_id == user_id, Garment.status == GarmentStatus.READY)
        ).all()
        untagged = [garment for garment in garments if not garment.tags]
        photographed = []
        for garment in untagged:
            if garment.basic_key:
                garment.tags = BASIC_TAGS[parse_key(garment.basic_key)[0].key]
                from_basics += 1
            else:
                photographed.append(garment)
        db.commit()
        if not photographed:
            continue
        by_ref = {f"g{index}": garment for index, garment in enumerate(photographed, start=1)}
        described = [
            {"ref": ref, "category": g.category.value, "name": g.name, "notes": g.style_notes}
            for ref, g in by_ref.items()
        ]
        prompt = PROMPT.format(garments=json.dumps(described, ensure_ascii=False))
        data = openrouter.chat_json(get_settings().outfit_model, prompt, SCHEMA)
        for item in data["garments"]:
            garment = by_ref.get(item["ref"])
            if garment is not None:
                garment.tags = clean_tags(item["tags"])
                from_model += 1
        db.commit()
    return from_basics, from_model


if __name__ == "__main__":
    # Paid: one cheap text call per closet with photographed garments. Basics cost nothing.
    with SessionLocal() as session:
        print("from basics, from the model:", backfill_tags(session))
