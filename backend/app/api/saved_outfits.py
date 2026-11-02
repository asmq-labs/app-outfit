import datetime as dt
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.outfits import Latitude, Longitude, _forecast, _not_enough_garments, _outfit_out
from app.api.schemas import GarmentOut, OutfitOut, SavedOutfitIn, SavedOutfitOut
from app.auth.deps import CurrentUser, DbSession
from app.models import Garment, GarmentCategory, Occasion, SavedOutfit
from app.outfits import service

router = APIRouter(prefix="/saved-outfits", tags=["outfits"])


def _saved_out(db: Session, saved: SavedOutfit) -> SavedOutfitOut:
    garments = {}
    for category, garment_id in saved.garment_ids().items():
        garment = db.get(Garment, garment_id) if garment_id else None
        garments[category.value] = GarmentOut.model_validate(garment) if garment else None
    return SavedOutfitOut(id=saved.id, garments=garments, created_at=saved.created_at)


def _owned(saved_id: uuid.UUID, user: CurrentUser, db: DbSession) -> SavedOutfit:
    try:
        return service.get_saved_for_user(db, user, saved_id)
    except service.OutfitNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "saved_outfit_not_found") from exc


OwnedSaved = Annotated[SavedOutfit, Depends(_owned)]


@router.post("", status_code=status.HTTP_201_CREATED)
def save_outfit(body: SavedOutfitIn, user: CurrentUser, db: DbSession) -> SavedOutfitOut:
    garment_ids = {category: body.garments.get(category) for category in GarmentCategory}
    try:
        return _saved_out(db, service.save(db, user, garment_ids))
    except service.InvalidOutfitError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "invalid_outfit") from exc


@router.get("")
def list_saved_outfits(user: CurrentUser, db: DbSession) -> list[SavedOutfitOut]:
    return [_saved_out(db, saved) for saved in service.list_saved(db, user)]


@router.put("/{saved_id}")
def update_saved_outfit(
    saved: OwnedSaved, body: SavedOutfitIn, user: CurrentUser, db: DbSession
) -> SavedOutfitOut:
    garment_ids = {category: body.garments.get(category) for category in GarmentCategory}
    try:
        return _saved_out(db, service.update_saved(db, user, saved, garment_ids))
    except service.InvalidOutfitError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "invalid_outfit") from exc


@router.delete("/{saved_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_saved_outfit(saved: OwnedSaved, db: DbSession) -> None:
    service.delete_saved(db, saved)


@router.post("/{saved_id}/use")
def use_saved_outfit(
    saved: OwnedSaved,
    day: dt.date,
    occasion: Occasion,
    user: CurrentUser,
    db: DbSession,
    lat: Latitude = None,
    lon: Longitude = None,
) -> OutfitOut:
    forecast = _forecast(day, lat, lon)
    try:
        outfit = service.use_look(
            db, user, saved.garment_ids(), service.SAVED_EXPLANATION, day, occasion, forecast
        )
    except service.NotEnoughGarmentsError as exc:
        raise _not_enough_garments(exc) from exc
    return _outfit_out(db, outfit, forecast)
