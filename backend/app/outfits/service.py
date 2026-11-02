import datetime as dt
import logging
import uuid

from sqlalchemy import ColumnElement, and_, or_, select
from sqlalchemy.orm import Session

from app.ai.openrouter import AIError
from app.ai.outfits import OutfitChoice, sugerir_outfits
from app.models import (
    Feeling,
    Garment,
    GarmentCategory,
    GarmentStatus,
    Occasion,
    Outfit,
    SavedOutfit,
    SignalKind,
    User,
)
from app.outfits import taste
from app.outfits.candidates import Candidates, select_candidates
from app.outfits.weather import Forecast

logger = logging.getLogger(__name__)

# Outfits generated per model call: today's pick plus ready-made answers to "otra".
BATCH_SIZE = 3
FALLBACK_EXPLANATION = "Una combinación sencilla con prendas que no has usado últimamente."
PLANNED_EXPLANATION = "El outfit que planeaste para hoy."
SAVED_EXPLANATION = "Uno de tus outfits guardados."
SWAPPED_EXPLANATION = "Tu versión de este outfit, con el cambio que elegiste."

ABOUT_THE_COMBINATION = {"bad_match", "colors", "right_occasion", "wrong_occasion"}
# Enough to show a taste without making every prompt long.
FEELINGS_IN_PROMPT = 10

Combo = frozenset[uuid.UUID]


class NotEnoughGarmentsError(Exception):
    def __init__(self, missing: list[GarmentCategory]) -> None:
        self.missing = missing


class NoMoreOutfitsError(Exception):
    pass


class OutfitNotFoundError(Exception):
    pass


class GarmentNotReadyError(Exception):
    pass


class InvalidOutfitError(Exception):
    pass


class InvalidFeelingError(Exception):
    pass


def _combo(garment_ids: dict[GarmentCategory, uuid.UUID | None]) -> Combo:
    return frozenset(garment_id for garment_id in garment_ids.values() if garment_id)


def _is_wearable(choice: OutfitChoice) -> bool:
    ids = choice.garment_ids
    separates = bool(ids[GarmentCategory.TOP] and ids[GarmentCategory.BOTTOM])
    one_piece = bool(ids[GarmentCategory.ONE_PIECE])
    mixes_both = one_piece and bool(ids[GarmentCategory.TOP] or ids[GarmentCategory.BOTTOM])
    return (separates or one_piece) and not mixes_both and bool(ids[GarmentCategory.SHOES])


def _fallback_choice(candidates: Candidates) -> OutfitChoice:
    # Used when the model is unavailable: the least recently worn garment of each slot.
    first = {
        category: garments[0].id if garments else None
        for category, garments in candidates.by_category.items()
    }
    if first[GarmentCategory.TOP] and first[GarmentCategory.BOTTOM]:
        first[GarmentCategory.ONE_PIECE] = None
    else:
        first[GarmentCategory.TOP] = first[GarmentCategory.BOTTOM] = None
    if not candidates.wants_outerwear:
        first[GarmentCategory.OUTERWEAR] = None
    first[GarmentCategory.ACCESSORY] = None
    return OutfitChoice(first, FALLBACK_EXPLANATION)


def _for_day(db: Session, user: User, day: dt.date, occasion: Occasion) -> list[Outfit]:
    return list(
        db.scalars(
            select(Outfit)
            .where(Outfit.user_id == user.id, Outfit.day == day, Outfit.occasion == occasion)
            .order_by(Outfit.position)
        )
    )


def _is_available(outfit: Outfit) -> bool:
    return outfit.dismissed_at is None and outfit.is_complete


def _with_feeling(user: User):
    return select(Outfit).where(Outfit.user_id == user.id, Outfit.feeling.is_not(None))


def _recent_feelings(db: Session, user: User) -> list[dict]:
    outfits = db.scalars(
        _with_feeling(user).order_by(Outfit.felt_at.desc()).limit(FEELINGS_IN_PROMPT)
    )
    feelings = []
    for outfit in outfits:
        garments = (db.get(Garment, gid) for gid in _combo(outfit.garment_ids()))
        feelings.append(
            {
                "felt": outfit.feeling.value,
                "reasons": [taste.REASONS[outfit.feeling][r] for r in outfit.feeling_reasons],
                "garments": sorted(g.name for g in garments if g is not None and g.name),
            }
        )
    return feelings


def _disliked(db: Session, user: User) -> set[Combo]:
    outfits = db.scalars(_with_feeling(user).where(Outfit.feeling == Feeling.BAD))
    return {_combo(outfit.garment_ids()) for outfit in outfits}


def _generate(
    db: Session,
    user: User,
    day: dt.date,
    occasion: Occasion,
    forecast: Forecast | None,
    existing: list[Outfit],
    around: Garment | None = None,
    note: str | None = None,
    # A direct request answers with what fits it, even if it was already shown today.
    fresh: bool = False,
) -> list[Outfit]:
    garments = list(
        db.scalars(
            select(Garment).where(Garment.user_id == user.id, Garment.status == GarmentStatus.READY)
        )
    )
    candidates = select_candidates(garments, occasion, forecast, day)
    if around is not None:
        candidates = candidates.built_around(around)
    if candidates.missing:
        raise NotEnoughGarmentsError(candidates.missing)

    seen = set() if fresh else {_combo(outfit.garment_ids()) for outfit in existing}
    disliked = _disliked(db, user)
    try:
        choices = sugerir_outfits(
            candidates,
            occasion,
            forecast,
            list(seen | disliked),
            BATCH_SIZE,
            profile=user.style_profile,
            note=note,
            feelings=_recent_feelings(db, user),
            history=taste.garment_history(db, user),
            learned=taste.learned_tags(db, user, garments),
        )
    except AIError as exc:
        logger.warning("outfit model failed, using the fallback: %s", exc)
        choices = []
    must_answer = not existing or around is not None or fresh
    if must_answer:
        # The first outfit of the day, or one asked for, must never fail because of the model.
        choices.append(_fallback_choice(candidates))

    usable = [c for c in choices if _is_wearable(c) and _combo(c.garment_ids) not in seen]
    wanted = [c for c in usable if _combo(c.garment_ids) not in disliked]
    # A combination they disliked comes back only when the closet can make nothing else.
    outfits = []
    for choice in wanted or (usable[:1] if must_answer else []):
        combo = _combo(choice.garment_ids)
        if combo in seen:
            continue
        seen.add(combo)
        slots = {f"{category.value}_id": gid for category, gid in choice.garment_ids.items()}
        outfits.append(
            Outfit(
                user_id=user.id,
                day=day,
                occasion=occasion,
                position=len(existing) + len(outfits),
                explanation=choice.explanation or FALLBACK_EXPLANATION,
                request_note=note,
                anchor_garment_id=around.id if around else None,
                **slots,
            )
        )
    if not outfits:
        raise NoMoreOutfitsError

    db.add_all(outfits)
    db.commit()
    return outfits


def remember_context(
    db: Session, user: User, lat: float | None, lon: float | None, utc_offset_minutes: int | None
) -> None:
    user.last_seen_at = dt.datetime.now(dt.UTC)
    if lat is not None and lon is not None:
        user.latitude, user.longitude = lat, lon
    if utc_offset_minutes is not None:
        user.utc_offset_minutes = utc_offset_minutes
    db.commit()


def get_today(
    db: Session, user: User, day: dt.date, occasion: Occasion, forecast: Forecast | None
) -> Outfit:
    existing = _for_day(db, user, day, occasion)
    for outfit in existing:
        if _is_available(outfit):
            return outfit
    # Hoy always shows something: with nothing left, a combination seen earlier is fine again.
    return _generate(db, user, day, occasion, forecast, existing, fresh=True)[0]


def request_outfit(
    db: Session,
    user: User,
    day: dt.date,
    occasion: Occasion,
    forecast: Forecast | None,
    garment: Garment | None = None,
    note: str | None = None,
) -> Outfit:
    if garment is not None and garment.status != GarmentStatus.READY:
        raise GarmentNotReadyError
    existing = _for_day(db, user, day, occasion)
    outfits = _generate(
        db, user, day, occasion, forecast, existing, around=garment, note=note, fresh=True
    )
    # What was on screen steps aside so the requested outfit is the one shown.
    now = dt.datetime.now(dt.UTC)
    for outfit in existing:
        if outfit.dismissed_at is None:
            outfit.dismissed_at = now
    db.commit()
    return outfits[0]


def _complete_with_closet(
    garment_ids: dict[GarmentCategory, uuid.UUID | None], candidates: Candidates
) -> dict[GarmentCategory, uuid.UUID | None]:
    # Fills only what a wearable outfit cannot do without: a base and shoes.
    ids = dict(garment_ids)

    def first(category: GarmentCategory) -> uuid.UUID | None:
        garments = candidates.by_category[category]
        return garments[0].id if garments else None

    if not ids[GarmentCategory.ONE_PIECE]:
        ids[GarmentCategory.TOP] = ids[GarmentCategory.TOP] or first(GarmentCategory.TOP)
        ids[GarmentCategory.BOTTOM] = ids[GarmentCategory.BOTTOM] or first(GarmentCategory.BOTTOM)
        if not (ids[GarmentCategory.TOP] and ids[GarmentCategory.BOTTOM]):
            ids[GarmentCategory.TOP] = ids[GarmentCategory.BOTTOM] = None
            ids[GarmentCategory.ONE_PIECE] = first(GarmentCategory.ONE_PIECE)
    ids[GarmentCategory.SHOES] = ids[GarmentCategory.SHOES] or first(GarmentCategory.SHOES)
    return ids


def use_look(
    db: Session,
    user: User,
    garment_ids: dict[GarmentCategory, uuid.UUID | None],
    explanation: str,
    day: dt.date,
    occasion: Occasion,
    forecast: Forecast | None,
) -> Outfit:
    garments = list(
        db.scalars(
            select(Garment).where(Garment.user_id == user.id, Garment.status == GarmentStatus.READY)
        )
    )
    candidates = select_candidates(garments, occasion, forecast, day)
    ids = _complete_with_closet(garment_ids, candidates)
    if not _is_wearable(OutfitChoice(ids, explanation)):
        raise NotEnoughGarmentsError(candidates.missing)

    existing = _for_day(db, user, day, occasion)
    now = dt.datetime.now(dt.UTC)
    for outfit in existing:
        if outfit.dismissed_at is None:
            outfit.dismissed_at = now
    outfit = Outfit(
        user_id=user.id,
        day=day,
        occasion=occasion,
        position=len(existing),
        explanation=explanation or FALLBACK_EXPLANATION,
        **{f"{category.value}_id": gid for category, gid in ids.items()},
    )
    db.add(outfit)
    db.commit()
    return outfit


def set_style_profile(db: Session, user: User, profile: str | None) -> None:
    user.style_profile = profile
    # Outfits prepared under the old profile step aside, so the change shows on the next look.
    since = dt.datetime.now(dt.UTC).date() - dt.timedelta(days=1)
    pending = db.scalars(
        select(Outfit).where(
            Outfit.user_id == user.id,
            Outfit.day >= since,
            Outfit.worn_at.is_(None),
            Outfit.dismissed_at.is_(None),
            Outfit.planned.is_(False),
        )
    )
    now = dt.datetime.now(dt.UTC)
    for outfit in pending:
        outfit.dismissed_at = now
    db.commit()


def list_worn(db: Session, user: User, limit: int) -> list[Outfit]:
    return list(
        db.scalars(
            select(Outfit)
            .where(Outfit.user_id == user.id, Outfit.worn_at.is_not(None))
            .order_by(Outfit.worn_at.desc())
            .limit(limit)
        )
    )


def get_for_user(db: Session, user: User, outfit_id: uuid.UUID) -> Outfit:
    outfit = db.get(Outfit, outfit_id)
    if outfit is None or outfit.user_id != user.id:
        raise OutfitNotFoundError
    return outfit


def another(db: Session, user: User, outfit: Outfit, forecast: Forecast | None) -> Outfit:
    existing = _for_day(db, user, outfit.day, outfit.occasion)
    ready = [other for other in existing if other.id != outfit.id and _is_available(other)]
    # The current outfit is only dismissed once there is something to replace it.
    if ready:
        replacement = ready[0]
    else:
        anchor = db.get(Garment, outfit.anchor_garment_id) if outfit.anchor_garment_id else None
        replacement = _generate(
            db,
            user,
            outfit.day,
            outfit.occasion,
            forecast,
            existing,
            around=anchor,
            note=outfit.request_note,
        )[0]
    outfit.dismissed_at = dt.datetime.now(dt.UTC)
    taste.record(db, outfit, SignalKind.SKIPPED)
    db.commit()
    return replacement


def swap_garments(
    db: Session, user: User, outfit: Outfit, garment_ids: dict[GarmentCategory, uuid.UUID | None]
) -> Outfit:
    if outfit.worn_at is not None:
        raise InvalidOutfitError
    _check_wearable(db, user, garment_ids)
    combo = _combo(garment_ids)
    if combo == _combo(outfit.garment_ids()):
        return outfit
    # The original steps aside and stays on record, so "Otra" does not bring it right back.
    outfit.dismissed_at = dt.datetime.now(dt.UTC)
    before = _combo(outfit.garment_ids())
    taste.record(db, outfit, SignalKind.SWAPPED_OUT, before - combo)
    taste.record(db, outfit, SignalKind.SWAPPED_IN, combo - before)
    replacement = Outfit(
        user_id=user.id,
        day=outfit.day,
        occasion=outfit.occasion,
        position=outfit.position,
        explanation=PLANNED_EXPLANATION if outfit.planned else SWAPPED_EXPLANATION,
        request_note=outfit.request_note,
        anchor_garment_id=outfit.anchor_garment_id if outfit.anchor_garment_id in combo else None,
        planned=outfit.planned,
        **{f"{category.value}_id": gid for category, gid in garment_ids.items()},
    )
    db.add(replacement)
    db.commit()
    return replacement


def set_feeling(
    db: Session,
    outfit: Outfit,
    feeling: Feeling | None,
    reasons: list[str],
    garment_ids: list[uuid.UUID],
) -> Outfit:
    if feeling is None:
        reasons, garment_ids = [], []
    elif not (
        set(reasons) <= set(taste.REASONS[feeling])
        and set(garment_ids) <= _combo(outfit.garment_ids())
    ):
        raise InvalidFeelingError
    outfit.feeling = feeling
    outfit.feeling_reasons = reasons
    outfit.feeling_garment_ids = [str(garment_id) for garment_id in garment_ids]
    outfit.felt_at = dt.datetime.now(dt.UTC) if feeling else None
    taste.record_feeling(db, outfit)
    db.commit()
    return outfit


def _uses(garment_id: uuid.UUID) -> ColumnElement[bool]:
    return or_(*(getattr(Outfit, f"{c.value}_id") == garment_id for c in GarmentCategory))


def _refresh_wear(db: Session, garment_ids: set[uuid.UUID]) -> None:
    # Count and last date always come from the worn outfits, so undoing a log stays exact.
    db.flush()
    for garment_id in garment_ids:
        garment = db.get(Garment, garment_id)
        if garment is None:
            continue
        wears = [
            outfit.worn_at
            for outfit in db.scalars(
                select(Outfit).where(
                    Outfit.user_id == garment.user_id,
                    Outfit.worn_at.is_not(None),
                    _uses(garment_id),
                )
            )
        ]
        garment.wear_count = len(wears)
        garment.last_worn_at = max(wears, default=None)


def wear(db: Session, outfit: Outfit) -> Outfit:
    if outfit.worn_at is None:
        outfit.worn_at = dt.datetime.now(dt.UTC)
        outfit.planned = False
        taste.record(db, outfit, SignalKind.WORN)
        _refresh_wear(db, set(_combo(outfit.garment_ids())))
        db.commit()
    return outfit


def unwear(db: Session, outfit: Outfit) -> Outfit:
    if outfit.worn_at is not None:
        outfit.worn_at = None
        outfit.planned = outfit.explanation == PLANNED_EXPLANATION
        # An opinion about wearing it does not outlive taking the wear back.
        outfit.feeling, outfit.feeling_reasons, outfit.felt_at = None, [], None
        outfit.feeling_garment_ids = []
        taste.forget(db, outfit, SignalKind.WORN, SignalKind.FELT)
        _refresh_wear(db, set(_combo(outfit.garment_ids())))
        db.commit()
    return outfit


def _check_wearable(
    db: Session, user: User, garment_ids: dict[GarmentCategory, uuid.UUID | None]
) -> None:
    for category, garment_id in garment_ids.items():
        if garment_id is None:
            continue
        garment = db.get(Garment, garment_id)
        if (
            garment is None
            or garment.user_id != user.id
            or garment.status != GarmentStatus.READY
            or garment.category != category
        ):
            raise InvalidOutfitError
    if not _is_wearable(OutfitChoice(garment_ids, "")):
        raise InvalidOutfitError


def create_manual(
    db: Session,
    user: User,
    day: dt.date,
    occasion: Occasion,
    garment_ids: dict[GarmentCategory, uuid.UUID | None],
    worn: bool,
) -> Outfit:
    _check_wearable(db, user, garment_ids)

    existing = _for_day(db, user, day, occasion)
    if not worn:
        # A plan takes the place of whatever the app had prepared for that day.
        now = dt.datetime.now(dt.UTC)
        for outfit in existing:
            if outfit.dismissed_at is None and outfit.worn_at is None:
                outfit.dismissed_at = now
    outfit = Outfit(
        user_id=user.id,
        day=day,
        occasion=occasion,
        position=len(existing),
        explanation="" if worn else PLANNED_EXPLANATION,
        planned=not worn,
        **{f"{category.value}_id": gid for category, gid in garment_ids.items()},
    )
    db.add(outfit)
    db.flush()
    taste.record(db, outfit, SignalKind.HAND_PICKED)
    if worn:
        taste.record(db, outfit, SignalKind.WORN)
        # A day logged afterwards counts at noon of that day, not at the moment it was logged.
        today = dt.datetime.now(dt.UTC).date()
        outfit.worn_at = (
            dt.datetime.now(dt.UTC)
            if day >= today
            else dt.datetime.combine(day, dt.time(12), dt.UTC)
        )
        _refresh_wear(db, set(_combo(garment_ids)))
    db.commit()
    return outfit


def list_calendar(db: Session, user: User, start: dt.date, end: dt.date) -> list[Outfit]:
    return list(
        db.scalars(
            select(Outfit)
            .where(
                Outfit.user_id == user.id,
                Outfit.day >= start,
                Outfit.day <= end,
                or_(
                    Outfit.worn_at.is_not(None),
                    and_(Outfit.planned.is_(True), Outfit.dismissed_at.is_(None)),
                ),
            )
            .order_by(Outfit.day, Outfit.created_at)
        )
    )


def delete(db: Session, outfit: Outfit) -> None:
    garment_ids = set(_combo(outfit.garment_ids()))
    was_worn = outfit.worn_at is not None
    # Removing a record says it should not count, unlike losing it to a deleted garment.
    taste.forget(db, outfit)
    db.delete(outfit)
    if was_worn:
        _refresh_wear(db, garment_ids)
    db.commit()


def _saved_of(db: Session, user_id: uuid.UUID) -> list[SavedOutfit]:
    return list(
        db.scalars(
            select(SavedOutfit)
            .where(SavedOutfit.user_id == user_id)
            .order_by(SavedOutfit.created_at.desc())
        )
    )


def list_saved(db: Session, user: User) -> list[SavedOutfit]:
    return _saved_of(db, user.id)


def find_saved(
    db: Session, user_id: uuid.UUID, garment_ids: dict[GarmentCategory, uuid.UUID | None]
) -> SavedOutfit | None:
    combo = _combo(garment_ids)
    return next((s for s in _saved_of(db, user_id) if _combo(s.garment_ids()) == combo), None)


def save(
    db: Session, user: User, garment_ids: dict[GarmentCategory, uuid.UUID | None]
) -> SavedOutfit:
    _check_wearable(db, user, garment_ids)
    # Saving the same combination twice keeps a single copy.
    existing = find_saved(db, user.id, garment_ids)
    if existing is not None:
        return existing
    saved = SavedOutfit(user_id=user.id, **{f"{c.value}_id": gid for c, gid in garment_ids.items()})
    db.add(saved)
    db.commit()
    return saved


def update_saved(
    db: Session,
    user: User,
    saved: SavedOutfit,
    garment_ids: dict[GarmentCategory, uuid.UUID | None],
) -> SavedOutfit:
    _check_wearable(db, user, garment_ids)
    # Becoming identical to another saved outfit leaves a single copy.
    other = find_saved(db, user.id, garment_ids)
    if other is not None and other.id != saved.id:
        db.delete(saved)
        db.commit()
        return other
    for category, garment_id in garment_ids.items():
        setattr(saved, f"{category.value}_id", garment_id)
    db.commit()
    return saved


def get_saved_for_user(db: Session, user: User, saved_id: uuid.UUID) -> SavedOutfit:
    saved = db.get(SavedOutfit, saved_id)
    if saved is None or saved.user_id != user.id:
        raise OutfitNotFoundError
    return saved


def delete_saved(db: Session, saved: SavedOutfit) -> None:
    db.delete(saved)
    db.commit()


def was_chosen_by_user(outfit: Outfit) -> bool:
    return outfit.planned or outfit.explanation in (SWAPPED_EXPLANATION, SAVED_EXPLANATION, "")


def _empty_slot(outfit: Outfit | SavedOutfit, garment_id: uuid.UUID) -> None:
    for category, slot in outfit.garment_ids().items():
        if slot == garment_id:
            setattr(outfit, f"{category.value}_id", None)


def release_garment(db: Session, garment: Garment) -> None:
    # A saved or upcoming outfit only makes sense whole, so none is ever left half empty.
    kept: set[Combo] = set()
    for saved in _saved_of(db, garment.user_id):
        _empty_slot(saved, garment.id)
        combo = _combo(saved.garment_ids())
        if combo in kept or not _is_wearable(OutfitChoice(saved.garment_ids(), "")):
            db.delete(saved)
        else:
            kept.add(combo)
    upcoming = db.scalars(
        select(Outfit).where(
            Outfit.user_id == garment.user_id,
            Outfit.worn_at.is_(None),
            _uses(garment.id),
        )
    )
    for outfit in upcoming:
        _empty_slot(outfit, garment.id)
        # A suggestion's explanation talks about the garment, so only a plan can outlive it.
        if not (outfit.planned and outfit.is_complete):
            db.delete(outfit)


def forget_garment(db: Session, garment: Garment) -> None:
    release_garment(db, garment)
    # What was worn stays in the history, unless this was all that remained of it.
    worn = db.scalars(
        select(Outfit).where(
            Outfit.user_id == garment.user_id,
            Outfit.worn_at.is_not(None),
            _uses(garment.id),
        )
    )
    for outfit in worn:
        if len(_combo(outfit.garment_ids())) == 1:
            db.delete(outfit)
