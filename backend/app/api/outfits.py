import datetime as dt
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.schemas import ForecastOut, GarmentOut, OutfitIn, OutfitOut, OutfitRequestIn
from app.auth.deps import CurrentUser, DbSession
from app.garments import service as garment_service
from app.models import Garment, GarmentCategory, Occasion, Outfit
from app.outfits import service
from app.outfits.candidates import FORMALITY_BY_OCCASION
from app.outfits.weather import Forecast, get_forecast

router = APIRouter(prefix="/outfits", tags=["outfits"])

Latitude = Annotated[float | None, Query(ge=-90, le=90)]
Longitude = Annotated[float | None, Query(ge=-180, le=180)]
# Minutes east of UTC, as the phone reports it (Ecuador is -300).
UtcOffsetMinutes = Annotated[int | None, Query(ge=-720, le=840)]


def _forecast(day: dt.date, lat: float | None, lon: float | None) -> Forecast | None:
    if lat is None or lon is None:
        return None
    return get_forecast(lat, lon, day)


def _outfit_out(db: Session, outfit: Outfit, forecast: Forecast | None) -> OutfitOut:
    garments = {}
    off_occasion = []
    fitting = FORMALITY_BY_OCCASION[outfit.occasion]
    for category, garment_id in outfit.garment_ids().items():
        garment = db.get(Garment, garment_id) if garment_id else None
        garments[category.value] = GarmentOut.model_validate(garment) if garment else None
        if garment is not None and garment.formality not in fitting:
            off_occasion.append(category.value)
    saved = service.find_saved(db, outfit.user_id, outfit.garment_ids())
    return OutfitOut(
        id=outfit.id,
        day=outfit.day,
        occasion=outfit.occasion,
        explanation=outfit.explanation,
        worn=outfit.worn_at is not None,
        planned=outfit.planned,
        saved_id=saved.id if saved else None,
        garments=garments,
        off_occasion=off_occasion,
        forecast=ForecastOut.model_validate(forecast) if forecast else None,
    )


def _not_enough_garments(error: service.NotEnoughGarmentsError) -> HTTPException:
    missing = [category.value for category in error.missing]
    return HTTPException(
        status.HTTP_409_CONFLICT, {"code": "not_enough_garments", "missing": missing}
    )


def _owned_outfit(outfit_id: uuid.UUID, user: CurrentUser, db: DbSession) -> Outfit:
    try:
        return service.get_for_user(db, user, outfit_id)
    except service.OutfitNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "outfit_not_found") from exc


OwnedOutfit = Annotated[Outfit, Depends(_owned_outfit)]


@router.get("/today")
def read_today(
    day: dt.date,
    occasion: Occasion,
    user: CurrentUser,
    db: DbSession,
    lat: Latitude = None,
    lon: Longitude = None,
    tz: UtcOffsetMinutes = None,
) -> OutfitOut:
    service.remember_context(db, user, lat, lon, tz)
    forecast = _forecast(day, lat, lon)
    try:
        outfit = service.get_today(db, user, day, occasion, forecast)
    except service.NotEnoughGarmentsError as exc:
        raise _not_enough_garments(exc) from exc
    return _outfit_out(db, outfit, forecast)


@router.post("/request")
def request_outfit(
    body: OutfitRequestIn,
    user: CurrentUser,
    db: DbSession,
    lat: Latitude = None,
    lon: Longitude = None,
) -> OutfitOut:
    forecast = _forecast(body.day, lat, lon)
    note = body.note.strip() if body.note else None
    try:
        garment = (
            garment_service.get_for_user(db, user, body.garment_id) if body.garment_id else None
        )
        outfit = service.request_outfit(
            db, user, body.day, body.occasion, forecast, garment=garment, note=note or None
        )
    except garment_service.GarmentNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "garment_not_found") from exc
    except service.GarmentNotReadyError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, {"code": "garment_not_ready"}) from exc
    except service.NotEnoughGarmentsError as exc:
        raise _not_enough_garments(exc) from exc
    return _outfit_out(db, outfit, forecast)


@router.get("/history")
def read_history(
    user: CurrentUser, db: DbSession, limit: Annotated[int, Query(ge=1, le=100)] = 30
) -> list[OutfitOut]:
    return [_outfit_out(db, outfit, None) for outfit in service.list_worn(db, user, limit)]


@router.post("", status_code=status.HTTP_201_CREATED)
def create_outfit(body: OutfitIn, user: CurrentUser, db: DbSession) -> OutfitOut:
    garment_ids = {category: body.garments.get(category) for category in GarmentCategory}
    try:
        outfit = service.create_manual(db, user, body.day, body.occasion, garment_ids, body.worn)
    except service.InvalidOutfitError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "invalid_outfit") from exc
    return _outfit_out(db, outfit, None)


@router.get("/calendar")
def read_calendar(
    start: dt.date, end: dt.date, user: CurrentUser, db: DbSession
) -> list[OutfitOut]:
    if not dt.timedelta(0) <= end - start <= dt.timedelta(days=62):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "invalid_range")
    return [_outfit_out(db, outfit, None) for outfit in service.list_calendar(db, user, start, end)]


@router.delete("/{outfit_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_outfit(outfit: OwnedOutfit, db: DbSession) -> None:
    service.delete(db, outfit)


@router.post("/{outfit_id}/another")
def suggest_another(
    outfit: OwnedOutfit,
    user: CurrentUser,
    db: DbSession,
    lat: Latitude = None,
    lon: Longitude = None,
) -> OutfitOut:
    forecast = _forecast(outfit.day, lat, lon)
    try:
        replacement = service.another(db, user, outfit, forecast)
    except (service.NoMoreOutfitsError, service.NotEnoughGarmentsError) as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, {"code": "no_more_outfits"}) from exc
    return _outfit_out(db, replacement, forecast)


@router.post("/{outfit_id}/wear")
def wear_outfit(
    outfit: OwnedOutfit, db: DbSession, lat: Latitude = None, lon: Longitude = None
) -> OutfitOut:
    return _outfit_out(db, service.wear(db, outfit), _forecast(outfit.day, lat, lon))


@router.post("/{outfit_id}/unwear")
def unwear_outfit(
    outfit: OwnedOutfit, db: DbSession, lat: Latitude = None, lon: Longitude = None
) -> OutfitOut:
    return _outfit_out(db, service.unwear(db, outfit), _forecast(outfit.day, lat, lon))
