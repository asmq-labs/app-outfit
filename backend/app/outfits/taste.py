import collections
import uuid

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.models import Feeling, Garment, Outfit, SavedOutfit, SignalKind, TasteSignal, User

# What each reason means, in the words the model reads. The phone shows its own labels.
REASONS: dict[Feeling, dict[str, str]] = {
    Feeling.GOOD: {
        "comfortable": "comfortable",
        "looks_good": "they liked how they looked",
        "confident": "made them feel confident",
        "right_occasion": "right for the occasion",
        "right_weather": "right for the weather",
        "colors": "they liked the colors",
    },
    Feeling.BAD: {
        "uncomfortable": "uncomfortable",
        "not_my_style": "not their style",
        "bad_match": "the pieces did not go together",
        "wrong_occasion": "wrong for the occasion",
        "too_hot": "too hot",
        "too_cold": "too cold",
        "bad_fit": "something did not fit them well",
    },
}
WORDS = {key: word for reasons in REASONS.values() for key, word in reasons.items()}
LIKED, DISLIKED = "liked", "disliked"
WORDS |= {LIKED: LIKED, DISLIKED: DISLIKED}

# About how pieces work together, so they say nothing of a piece unless the person pointed at it.
ABOUT_THE_COMBINATION = {"bad_match", "colors", "right_occasion", "wrong_occasion"}
# How a piece feels on this person: what can carry over to similar pieces.
ABOUT_THE_PERSON = {
    "comfortable",
    "uncomfortable",
    "looks_good",
    "confident",
    "not_my_style",
    "bad_fit",
    "too_hot",
    "too_cold",
}
# A tag becomes a learned preference only once several different garments agree on it.
MIN_GARMENTS_FOR_A_TAG = 2
TAGS_PER_FEELING = 5


def _garments_of(outfit: Outfit) -> set[uuid.UUID]:
    return {garment_id for garment_id in outfit.garment_ids().values() if garment_id}


def record(
    db: Session, outfit: Outfit, kind: SignalKind, garment_ids: set[uuid.UUID] | None = None
) -> None:
    for garment_id in _garments_of(outfit) if garment_ids is None else garment_ids:
        db.add(
            TasteSignal(
                user_id=outfit.user_id,
                outfit_id=outfit.id,
                garment_id=garment_id,
                kind=kind,
                occasion=outfit.occasion,
            )
        )


def forget(db: Session, outfit: Outfit, *kinds: SignalKind) -> None:
    # A wear undone or an opinion taken back was never true, so it does not stay on record.
    query = delete(TasteSignal).where(TasteSignal.outfit_id == outfit.id)
    if kinds:
        query = query.where(TasteSignal.kind.in_(kinds))
    db.execute(query)


def record_feeling(db: Session, outfit: Outfit) -> None:
    forget(db, outfit, SignalKind.FELT)
    if outfit.feeling is None:
        return
    pointed = {uuid.UUID(garment_id) for garment_id in outfit.feeling_garment_ids}

    def add(garment_id: uuid.UUID | None, value: str) -> None:
        db.add(
            TasteSignal(
                user_id=outfit.user_id,
                outfit_id=outfit.id,
                garment_id=garment_id,
                kind=SignalKind.FELT,
                value=value,
                occasion=outfit.occasion,
            )
        )

    reasons = outfit.feeling_reasons or [LIKED if outfit.feeling == Feeling.GOOD else DISLIKED]
    # With no reason of its own, a thumb still says something about each piece.
    only_combination = all(reason in ABOUT_THE_COMBINATION for reason in reasons)
    for reason in reasons:
        if pointed:
            for garment_id in pointed:
                add(garment_id, reason)
        elif reason in ABOUT_THE_COMBINATION:
            add(None, reason)
        else:
            for garment_id in _garments_of(outfit):
                add(garment_id, reason)
    if only_combination and not pointed:
        for garment_id in _garments_of(outfit):
            add(garment_id, LIKED if outfit.feeling == Feeling.GOOD else DISLIKED)


def _felt_counts(db: Session, user: User) -> dict[uuid.UUID, dict[str, int]]:
    rows = db.execute(
        select(TasteSignal.garment_id, TasteSignal.value, func.count())
        .where(
            TasteSignal.user_id == user.id,
            TasteSignal.kind == SignalKind.FELT,
            TasteSignal.garment_id.is_not(None),
        )
        .group_by(TasteSignal.garment_id, TasteSignal.value)
    )
    counts: dict[uuid.UUID, dict[str, int]] = collections.defaultdict(dict)
    for garment_id, value, count in rows:
        counts[garment_id][value] = count
    return counts


def garment_history(db: Session, user: User) -> dict[uuid.UUID, dict[str, int]]:
    # Comfort is personal: each garment carries how it has felt to this one person.
    history: dict[uuid.UUID, collections.Counter[str]] = collections.defaultdict(
        collections.Counter
    )
    for garment_id, felt in _felt_counts(db, user).items():
        for value, count in felt.items():
            history[garment_id][WORDS.get(value, value)] += count

    actions = {
        SignalKind.SWAPPED_OUT: "swapped out by them",
        SignalKind.SWAPPED_IN: "chosen by them",
        SignalKind.HAND_PICKED: "chosen by them",
    }
    rows = db.execute(
        select(TasteSignal.garment_id, TasteSignal.kind, func.count())
        .where(
            TasteSignal.user_id == user.id,
            TasteSignal.kind.in_(actions),
            TasteSignal.garment_id.is_not(None),
        )
        .group_by(TasteSignal.garment_id, TasteSignal.kind)
    )
    for garment_id, kind, count in rows:
        history[garment_id][actions[kind]] += count

    saved_outfits = db.scalars(select(SavedOutfit).where(SavedOutfit.user_id == user.id))
    for saved in saved_outfits:
        for garment_id in saved.garment_ids().values():
            if garment_id:
                history[garment_id]["kept in a saved outfit"] += 1
    return {garment_id: dict(counts) for garment_id, counts in history.items()}


def learned_tags(db: Session, user: User, garments: list[Garment]) -> dict[str, list[str]]:
    # What several garments have in common reaches pieces the person has never rated.
    tags_of = {garment.id: garment.tags for garment in garments}
    agreeing: dict[str, dict[str, set[uuid.UUID]]] = collections.defaultdict(
        lambda: collections.defaultdict(set)
    )
    for garment_id, felt in _felt_counts(db, user).items():
        for value in felt:
            if value in ABOUT_THE_PERSON:
                for tag in tags_of.get(garment_id, []):
                    agreeing[WORDS[value]][tag].add(garment_id)

    learned = {}
    for word, by_tag in agreeing.items():
        strong = [
            (len(ids), tag) for tag, ids in by_tag.items() if len(ids) >= MIN_GARMENTS_FOR_A_TAG
        ]
        if strong:
            learned[word] = [tag for _, tag in sorted(strong, reverse=True)[:TAGS_PER_FEELING]]
    return learned
