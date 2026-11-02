import datetime as dt
import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models import (
    Feeling,
    Formality,
    GarmentCategory,
    GarmentStatus,
    InspirationStatus,
    Occasion,
    Warmth,
)


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str | None
    display_name: str | None
    is_guest: bool
    style_profile: str | None


class StyleProfileIn(BaseModel):
    style_profile: str = Field(max_length=300)


class OutfitRequestIn(BaseModel):
    day: dt.date
    occasion: Occasion
    garment_id: uuid.UUID | None = None
    note: str | None = Field(default=None, max_length=200)


class SessionOut(BaseModel):
    user: UserOut
    access_token: str
    refresh_token: str
    expires_in: int


class IdTokenIn(BaseModel):
    id_token: str


class RefreshTokenIn(BaseModel):
    refresh_token: str


class GarmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    status: GarmentStatus
    failure_reason: str | None
    category: GarmentCategory | None
    name: str | None
    color: str | None
    warmth: Warmth | None
    formality: Formality | None
    brand: str | None
    size: str | None
    notes: str | None
    image_version: str | None
    basic_key: str | None
    wear_count: int
    last_worn_at: datetime | None
    created_at: datetime


class BasicColorOut(BaseModel):
    key: str
    # The color adjective agreeing with the shape, such as "blanca" for "Camiseta".
    name: str
    swatch: str
    owned: bool


class BasicOut(BaseModel):
    key: str
    name: str
    category: GarmentCategory
    colors: list[BasicColorOut]


class BasicsIn(BaseModel):
    keys: list[str] = Field(min_length=1, max_length=40)


class GarmentUpdate(BaseModel):
    category: GarmentCategory | None = None
    name: str | None = Field(default=None, min_length=1, max_length=120)
    color: str | None = Field(default=None, min_length=1, max_length=60)
    warmth: Warmth | None = None
    formality: Formality | None = None
    # An empty string clears the detail.
    brand: str | None = Field(default=None, max_length=60)
    size: str | None = Field(default=None, max_length=20)
    notes: str | None = Field(default=None, max_length=500)


class ForecastOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    min_c: float
    max_c: float
    rain: bool


class OutfitOut(BaseModel):
    id: uuid.UUID
    day: dt.date
    occasion: Occasion
    explanation: str
    worn: bool
    planned: bool
    # The saved outfit with these same garments, if the user kept it.
    saved_id: uuid.UUID | None
    # One entry per garment category; empty slots are null.
    garments: dict[str, GarmentOut | None]
    # Categories the closet could only fill with something off the occasion.
    off_occasion: list[str]
    forecast: ForecastOut | None
    feeling: Feeling | None
    feeling_reasons: list[str]
    feeling_garment_ids: list[uuid.UUID]


class MissingPieceOut(BaseModel):
    category: GarmentCategory
    name: str


class InspirationOut(BaseModel):
    id: uuid.UUID
    status: InspirationStatus
    failure_reason: str | None
    # The closet's stand-in for each piece of the look; empty slots are null.
    garments: dict[str, GarmentOut | None]
    missing: list[MissingPieceOut]
    explanation: str | None
    created_at: datetime


class OutfitIn(BaseModel):
    day: dt.date
    occasion: Occasion
    # True logs it as worn; false plans it for that day.
    worn: bool
    garments: dict[GarmentCategory, uuid.UUID | None]


class OutfitGarmentsIn(BaseModel):
    garments: dict[GarmentCategory, uuid.UUID | None]


class FeelingIn(BaseModel):
    # Null takes the opinion back.
    feeling: Feeling | None
    reasons: list[str] = Field(default=[], max_length=8)
    garment_ids: list[uuid.UUID] = Field(default=[], max_length=6)


class SavedOutfitIn(BaseModel):
    garments: dict[GarmentCategory, uuid.UUID | None]


class SavedOutfitOut(BaseModel):
    id: uuid.UUID
    garments: dict[str, GarmentOut | None]
    created_at: datetime
