import datetime as dt
from dataclasses import dataclass

from app.models import Formality, Garment, GarmentCategory, Occasion, Warmth
from app.outfits.weather import Forecast

MAX_PER_SLOT = 8

# Days a garment rests after being worn before it is suggested again.
REST_DAYS: dict[GarmentCategory, int] = {
    GarmentCategory.TOP: 3,
    GarmentCategory.ONE_PIECE: 3,
    GarmentCategory.BOTTOM: 1,
    GarmentCategory.OUTERWEAR: 0,
    GarmentCategory.SHOES: 0,
    GarmentCategory.ACCESSORY: 0,
}

FORMALITY_BY_OCCASION: dict[Occasion, set[Formality]] = {
    Occasion.CASUAL: {Formality.CASUAL},
    Occasion.NIGHT_OUT: {Formality.CASUAL, Formality.SMART},
    Occasion.WORK: {Formality.SMART, Formality.FORMAL},
    Occasion.FORMAL: {Formality.FORMAL, Formality.SMART},
    Occasion.SPORT: {Formality.SPORT},
}

# What comes closest when the closet has nothing for the occasion, so gym clothes stay out of a
# work day and dress shoes out of a workout for as long as anything else is available.
NEAREST_FORMALITY: dict[Occasion, set[Formality]] = {
    Occasion.CASUAL: {Formality.SMART},
    Occasion.NIGHT_OUT: {Formality.FORMAL},
    Occasion.WORK: {Formality.CASUAL},
    Occasion.FORMAL: {Formality.CASUAL},
    Occasion.SPORT: {Formality.CASUAL},
}

HOT_FROM_C = 25
COLD_BELOW_C = 15
LAYER_BELOW_C = 17

# Categories whose warmth has to match the day's temperature.
WEATHER_SENSITIVE = {GarmentCategory.TOP, GarmentCategory.BOTTOM, GarmentCategory.ONE_PIECE}
OPTIONAL = {GarmentCategory.OUTERWEAR, GarmentCategory.ACCESSORY}


@dataclass(frozen=True)
class Candidates:
    by_category: dict[GarmentCategory, list[Garment]]
    wants_outerwear: bool

    @property
    def missing(self) -> list[GarmentCategory]:
        has = {category for category, garments in self.by_category.items() if garments}
        missing = []
        if GarmentCategory.ONE_PIECE not in has:
            missing += [c for c in (GarmentCategory.TOP, GarmentCategory.BOTTOM) if c not in has]
        if GarmentCategory.SHOES not in has:
            missing.append(GarmentCategory.SHOES)
        return missing

    def built_around(self, garment: Garment) -> "Candidates":
        # The chosen garment becomes the only option for its slot.
        by_category = {**self.by_category, garment.category: [garment]}
        if garment.category == GarmentCategory.ONE_PIECE:
            by_category[GarmentCategory.TOP] = by_category[GarmentCategory.BOTTOM] = []
        elif garment.category in (GarmentCategory.TOP, GarmentCategory.BOTTOM):
            by_category[GarmentCategory.ONE_PIECE] = []
        wants_outerwear = self.wants_outerwear or garment.category == GarmentCategory.OUTERWEAR
        return Candidates(by_category=by_category, wants_outerwear=wants_outerwear)


def _suitable_warmth(forecast: Forecast | None) -> set[Warmth]:
    if forecast is None:
        return set(Warmth)
    if forecast.max_c >= HOT_FROM_C:
        return {Warmth.LIGHT, Warmth.MEDIUM}
    if forecast.max_c < COLD_BELOW_C:
        return {Warmth.MEDIUM, Warmth.WARM}
    return set(Warmth)


def _is_rested(garment: Garment, day: dt.date) -> bool:
    rest_days = REST_DAYS[garment.category]
    if garment.last_worn_at is None or rest_days == 0:
        return True
    return (day - garment.last_worn_at.date()).days > rest_days


def _least_recently_worn(garments: list[Garment]) -> list[Garment]:
    # Never-worn garments go first, so the whole closet gets rotated.
    never_worn = dt.datetime.min.replace(tzinfo=dt.UTC)
    return sorted(garments, key=lambda garment: garment.last_worn_at or never_worn)


def select_candidates(
    garments: list[Garment], occasion: Occasion, forecast: Forecast | None, day: dt.date
) -> Candidates:
    warmth = _suitable_warmth(forecast)
    formality = FORMALITY_BY_OCCASION[occasion]

    def fits_weather(garment: Garment) -> bool:
        return garment.category not in WEATHER_SENSITIVE or garment.warmth in warmth

    def fits_occasion(garment: Garment) -> bool:
        return garment.formality in formality

    def nearly_fits_occasion(garment: Garment) -> bool:
        return garment.formality in NEAREST_FORMALITY[occasion]

    def rested(garment: Garment) -> bool:
        return _is_rested(garment, day)

    # When a small closet leaves a slot empty, rules are dropped in this order; the occasion last.
    relaxations = [
        (fits_weather, rested, fits_occasion),
        (fits_weather, fits_occasion),
        (fits_occasion,),
        (fits_weather, nearly_fits_occasion),
        (nearly_fits_occasion,),
        (fits_weather,),
        (),
    ]
    # An optional piece that breaks the occasion is worse than no piece at all.
    optional_relaxations = [rules for rules in relaxations if fits_occasion in rules]

    by_category: dict[GarmentCategory, list[Garment]] = {}
    for category in GarmentCategory:
        in_category = [garment for garment in garments if garment.category == category]
        chosen: list[Garment] = []
        for rules in optional_relaxations if category in OPTIONAL else relaxations:
            chosen = [g for g in in_category if all(rule(g) for rule in rules)]
            if chosen:
                break
        by_category[category] = _least_recently_worn(chosen)[:MAX_PER_SLOT]

    wants_outerwear = forecast is not None and (forecast.min_c < LAYER_BELOW_C or forecast.rain)
    return Candidates(by_category=by_category, wants_outerwear=wants_outerwear)
