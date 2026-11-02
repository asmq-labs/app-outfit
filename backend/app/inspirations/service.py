import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import jobs
from app.config import get_settings
from app.garments.images import normalize_photo, thumbnail_path
from app.models import Garment, Inspiration, User
from app.storage import Storage

MATCH_JOB = "match_inspiration"


class InspirationNotFoundError(Exception):
    pass


class InspirationNotReadyError(Exception):
    pass


class InspirationLimitError(Exception):
    pass


def create_from_photo(db: Session, storage: Storage, user: User, photo: bytes) -> Inspiration:
    since = datetime.now(UTC) - timedelta(days=1)
    recent = db.scalar(
        select(func.count())
        .select_from(Inspiration)
        .where(Inspiration.user_id == user.id, Inspiration.created_at > since)
    )
    if recent >= get_settings().inspirations_per_day:
        raise InspirationLimitError
    inspiration_id = uuid.uuid4()
    photo_path = storage.save(user.id, f"look_{inspiration_id}.jpg", normalize_photo(photo))
    inspiration = Inspiration(id=inspiration_id, user_id=user.id, photo_path=photo_path)
    db.add(inspiration)
    jobs.enqueue(db, MATCH_JOB, {"inspiration_id": str(inspiration_id)})
    db.commit()
    return inspiration


def list_for_user(db: Session, user: User) -> list[Inspiration]:
    return list(
        db.scalars(
            select(Inspiration)
            .where(Inspiration.user_id == user.id)
            .order_by(Inspiration.created_at.desc())
        )
    )


def get_for_user(db: Session, user: User, inspiration_id: uuid.UUID) -> Inspiration:
    inspiration = db.get(Inspiration, inspiration_id)
    if inspiration is None or inspiration.user_id != user.id:
        raise InspirationNotFoundError
    return inspiration


def mark_missing(db: Session, garment: Garment) -> None:
    # The look still asks for that piece, and now the closet lacks it.
    looks = db.scalars(select(Inspiration).where(Inspiration.user_id == garment.user_id))
    for look in looks:
        for category, slot in look.garment_ids().items():
            if slot == garment.id and garment.name:
                piece = {"category": category.value, "name": garment.name}
                look.missing = [*(look.missing or []), piece]


def delete(db: Session, storage: Storage, inspiration: Inspiration) -> None:
    db.delete(inspiration)
    db.commit()
    storage.delete(inspiration.photo_path)
    storage.delete(thumbnail_path(inspiration.photo_path))
