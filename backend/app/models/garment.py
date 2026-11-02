import enum
import uuid
import zlib
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class GarmentStatus(enum.StrEnum):
    PROCESSING = "processing"
    READY = "ready"
    FAILED = "failed"


class GarmentCategory(enum.StrEnum):
    # One category per outfit slot, see "Composición de un outfit" in CLAUDE.md.
    TOP = "top"
    BOTTOM = "bottom"
    ONE_PIECE = "one_piece"
    OUTERWEAR = "outerwear"
    SHOES = "shoes"
    ACCESSORY = "accessory"


class Warmth(enum.StrEnum):
    LIGHT = "light"
    MEDIUM = "medium"
    WARM = "warm"


class Formality(enum.StrEnum):
    CASUAL = "casual"
    SMART = "smart"
    FORMAL = "formal"
    # Made for exercise; everyday sneakers stay casual.
    SPORT = "sport"


def text_enum(enum_class: type[enum.StrEnum]) -> Enum:
    # Stored as plain text so adding a value never needs a database type migration.
    return Enum(
        enum_class,
        native_enum=False,
        length=20,
        values_callable=lambda members: [member.value for member in members],
    )


class Garment(Base):
    __tablename__ = "garments"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    status: Mapped[GarmentStatus] = mapped_column(
        text_enum(GarmentStatus), default=GarmentStatus.PROCESSING
    )
    failure_reason: Mapped[str | None] = mapped_column(String(50))

    category: Mapped[GarmentCategory | None] = mapped_column(text_enum(GarmentCategory))
    name: Mapped[str | None] = mapped_column(String(120))
    color: Mapped[str | None] = mapped_column(String(60))
    warmth: Mapped[Warmth | None] = mapped_column(text_enum(Warmth))
    formality: Mapped[Formality | None] = mapped_column(text_enum(Formality))
    # What a stylist would notice in the photo: fabric, texture, fit, pattern, visual weight.
    style_notes: Mapped[str | None] = mapped_column(String(200))
    # Optional details only the user knows; never required to get an outfit.
    brand: Mapped[str | None] = mapped_column(String(60))
    size: Mapped[str | None] = mapped_column(String(20))
    notes: Mapped[str | None] = mapped_column(String(500))

    # The user's photo is kept so the catalog image can be regenerated later.
    original_path: Mapped[str] = mapped_column(String(255))
    image_path: Mapped[str | None] = mapped_column(String(255))
    # Which item this garment is when its photo shows several; empty for a photo of one item.
    focus: Mapped[str | None] = mapped_column(String(200))
    # Set when the garment was picked from the basics list instead of photographed.
    basic_key: Mapped[str | None] = mapped_column(String(40))

    last_worn_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    wear_count: Mapped[int] = mapped_column(default=0, server_default="0")

    @property
    def image_version(self) -> str | None:
        # Changes whenever the catalog image is replaced; clients use it to refresh their cache.
        if self.image_path is None:
            return None
        return format(zlib.crc32(self.image_path.encode()), "08x")

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
