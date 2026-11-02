from sqlalchemy import select
from sqlalchemy.orm import Session

from app.ai.garments import analizar_estilo
from app.ai.openrouter import AIError
from app.db import SessionLocal
from app.garments.basics import parse_key
from app.models import Garment, GarmentStatus
from app.storage import Storage, get_storage


def backfill_style_notes(db: Session, storage: Storage) -> tuple[int, int]:
    garments = db.scalars(
        select(Garment).where(Garment.status == GarmentStatus.READY, Garment.style_notes.is_(None))
    ).all()
    done = failed = 0
    for garment in garments:
        try:
            if garment.basic_key:
                garment.style_notes = parse_key(garment.basic_key)[0].description
            else:
                garment.style_notes = analizar_estilo(storage.read(garment.image_path))
        except AIError:
            failed += 1
            continue
        db.commit()
        done += 1
    return done, failed


if __name__ == "__main__":
    # Paid for photographed garments: one cheap vision call each. Basics cost nothing.
    with SessionLocal() as session:
        print("done, failed:", backfill_style_notes(session, get_storage()))
