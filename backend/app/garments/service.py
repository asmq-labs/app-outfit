import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import jobs
from app.ai.garments import GarmentAnalysis
from app.config import get_settings
from app.garments.images import make_thumbnail, normalize_photo, thumbnail_path
from app.models import Garment, GarmentStatus, User
from app.storage import Storage

PROCESS_JOB = "process_garment"


class GarmentNotFoundError(Exception):
    pass


class GarmentNotRetryableError(Exception):
    pass


class UploadLimitError(Exception):
    pass


def _enqueue_processing(db: Session, garment: Garment) -> None:
    jobs.enqueue(db, PROCESS_JOB, {"garment_id": str(garment.id)})


def create_from_photo(db: Session, storage: Storage, user: User, photo: bytes) -> Garment:
    since = datetime.now(UTC) - timedelta(days=1)
    recent = db.scalar(
        select(func.count())
        .select_from(Garment)
        .where(Garment.user_id == user.id, Garment.created_at > since)
    )
    if recent >= get_settings().garments_per_day:
        raise UploadLimitError
    garment_id = uuid.uuid4()
    original_path = storage.save(user.id, f"{garment_id}_original.jpg", normalize_photo(photo))
    garment = Garment(id=garment_id, user_id=user.id, original_path=original_path)
    db.add(garment)
    _enqueue_processing(db, garment)
    db.commit()
    return garment


def create_from_shared_photo(
    db: Session, storage: Storage, source: Garment, item: GarmentAnalysis
) -> Garment:
    # Each garment owns a copy of the photo, so deleting one never breaks the others.
    garment_id = uuid.uuid4()
    photo = storage.read(source.original_path)
    garment = Garment(
        id=garment_id,
        user_id=source.user_id,
        original_path=storage.save(source.user_id, f"{garment_id}_original.jpg", photo),
    )
    describe(garment, item)
    garment.focus = item.description
    db.add(garment)
    _enqueue_processing(db, garment)
    return garment


def describe(garment: Garment, item: GarmentAnalysis) -> None:
    garment.category = item.category
    garment.name = item.name
    garment.color = item.color
    garment.warmth = item.warmth
    garment.formality = item.formality
    garment.style_notes = item.style_notes


def list_for_user(db: Session, user: User, status: GarmentStatus | None = None) -> list[Garment]:
    query = select(Garment).where(Garment.user_id == user.id).order_by(Garment.created_at.desc())
    if status is not None:
        query = query.where(Garment.status == status)
    return list(db.scalars(query))


def get_for_user(db: Session, user: User, garment_id: uuid.UUID) -> Garment:
    garment = db.get(Garment, garment_id)
    # Someone else's garment looks exactly like a missing one.
    if garment is None or garment.user_id != user.id:
        raise GarmentNotFoundError
    return garment


def update(db: Session, garment: Garment, changes: dict[str, Any]) -> Garment:
    for field, value in changes.items():
        setattr(garment, field, value)
    db.commit()
    return garment


def retry(db: Session, garment: Garment) -> Garment:
    if garment.status != GarmentStatus.FAILED:
        raise GarmentNotRetryableError
    garment.status = GarmentStatus.PROCESSING
    garment.failure_reason = None
    _enqueue_processing(db, garment)
    db.commit()
    return garment


def delete(db: Session, storage: Storage, garment: Garment) -> None:
    paths = [path for path in (garment.original_path, garment.image_path) if path]
    db.delete(garment)
    db.commit()
    for path in paths:
        storage.delete(path)
        storage.delete(thumbnail_path(path))


def thumbnail(storage: Storage, image_path: str) -> str:
    # Made the first time it is asked for, then served from disk.
    path = thumbnail_path(image_path)
    if not storage.exists(path):
        storage.save_shared(path, make_thumbnail(storage.read(image_path)))
    return path
