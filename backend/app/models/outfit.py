import datetime as dt
import enum
import uuid

from sqlalchemy import JSON, Date, DateTime, ForeignKey, Index, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.garment import GarmentCategory, text_enum


class Occasion(enum.StrEnum):
    CASUAL = "casual"
    WORK = "work"
    NIGHT_OUT = "night_out"
    FORMAL = "formal"
    SPORT = "sport"


class Feeling(enum.StrEnum):
    GOOD = "good"
    BAD = "bad"


def garment_slot() -> Mapped[uuid.UUID | None]:
    # A deleted garment empties its slot instead of deleting the whole outfit.
    return mapped_column(ForeignKey("garments.id", ondelete="SET NULL"))


class Outfit(Base):
    __tablename__ = "outfits"
    __table_args__ = (Index("ix_outfits_user_day_occasion", "user_id", "day", "occasion"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    # The user's local calendar day, sent by the phone.
    day: Mapped[dt.date] = mapped_column(Date)
    occasion: Mapped[Occasion] = mapped_column(text_enum(Occasion))
    position: Mapped[int]

    top_id: Mapped[uuid.UUID | None] = garment_slot()
    bottom_id: Mapped[uuid.UUID | None] = garment_slot()
    one_piece_id: Mapped[uuid.UUID | None] = garment_slot()
    outerwear_id: Mapped[uuid.UUID | None] = garment_slot()
    shoes_id: Mapped[uuid.UUID | None] = garment_slot()
    accessory_id: Mapped[uuid.UUID | None] = garment_slot()

    explanation: Mapped[str] = mapped_column(Text)
    # What this outfit was asked for, so "Otra" keeps honoring it.
    request_note: Mapped[str | None] = mapped_column(String(200))
    anchor_garment_id: Mapped[uuid.UUID | None] = garment_slot()
    # Chosen by the user ahead of time rather than suggested by the app.
    planned: Mapped[bool] = mapped_column(default=False, server_default="false")
    dismissed_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    worn_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    # How it felt to the person, which guides later suggestions.
    feeling: Mapped[Feeling | None] = mapped_column(text_enum(Feeling))
    feeling_reasons: Mapped[list[str]] = mapped_column(JSON, default=list, server_default="[]")
    # The pieces the opinion was about; empty means the outfit as a whole.
    feeling_garment_ids: Mapped[list[str]] = mapped_column(JSON, default=list, server_default="[]")
    felt_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    def garment_ids(self) -> dict[GarmentCategory, uuid.UUID | None]:
        return {category: getattr(self, f"{category.value}_id") for category in GarmentCategory}

    @property
    def is_complete(self) -> bool:
        has_base = bool(self.one_piece_id) or bool(self.top_id and self.bottom_id)
        return has_base and bool(self.shoes_id)


class SavedOutfit(Base):
    # A combination the user wants to keep, independent of any day.
    __tablename__ = "saved_outfits"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )

    top_id: Mapped[uuid.UUID | None] = garment_slot()
    bottom_id: Mapped[uuid.UUID | None] = garment_slot()
    one_piece_id: Mapped[uuid.UUID | None] = garment_slot()
    outerwear_id: Mapped[uuid.UUID | None] = garment_slot()
    shoes_id: Mapped[uuid.UUID | None] = garment_slot()
    accessory_id: Mapped[uuid.UUID | None] = garment_slot()

    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    def garment_ids(self) -> dict[GarmentCategory, uuid.UUID | None]:
        return {category: getattr(self, f"{category.value}_id") for category in GarmentCategory}
