import datetime as dt
import enum
import uuid

from sqlalchemy import DateTime, ForeignKey, Index, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.garment import text_enum
from app.models.outfit import Occasion


class SignalKind(enum.StrEnum):
    FELT = "felt"
    WORN = "worn"
    SKIPPED = "skipped"
    SWAPPED_OUT = "swapped_out"
    SWAPPED_IN = "swapped_in"
    HAND_PICKED = "hand_picked"


class TasteSignal(Base):
    # Every sign of taste as it happens: what cannot be logged today cannot be learned from later.
    __tablename__ = "taste_signals"
    __table_args__ = (Index("ix_taste_signals_user_kind", "user_id", "kind"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    # Empty when it was about the combination as a whole.
    garment_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("garments.id", ondelete="SET NULL"), index=True
    )
    # Outlives its outfit, which can be removed when one of its garments is deleted.
    outfit_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("outfits.id", ondelete="SET NULL"), index=True
    )
    kind: Mapped[SignalKind] = mapped_column(text_enum(SignalKind))
    # The reason given, for a feeling.
    value: Mapped[str | None] = mapped_column(String(40))
    occasion: Mapped[Occasion | None] = mapped_column(text_enum(Occasion))
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
