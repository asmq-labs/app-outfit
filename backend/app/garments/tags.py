# A closed vocabulary, so tags can be compared across garments and people, unlike free text.
FACETS: dict[str, tuple[str, ...]] = {
    "type": (
        "tshirt",
        "tank",
        "shirt",
        "blouse",
        "sweater",
        "hoodie",
        "jacket",
        "coat",
        "blazer",
        "jeans",
        "trousers",
        "leggings",
        "shorts",
        "skirt",
        "dress",
        "jumpsuit",
        "sneakers",
        "boots",
        "heels",
        "flats",
        "sandals",
        "dress_shoes",
        "bag",
        "hat",
        "scarf",
    ),
    "fabric": (
        "cotton",
        "denim",
        "linen",
        "wool",
        "knit",
        "silk",
        "leather",
        "suede",
        "corduroy",
        "fleece",
        "synthetic",
        "mesh",
    ),
    "fit": ("slim", "regular", "relaxed", "oversized", "cropped", "wide_leg", "flared"),
    "pattern": ("solid", "striped", "checked", "floral", "graphic", "textured", "color_block"),
    "feel": ("soft", "stretchy", "structured", "lightweight", "heavy"),
    "style": ("minimal", "classic", "street", "sporty", "romantic", "edgy", "preppy", "bohemian"),
}
ALL_TAGS = [f"{facet}:{value}" for facet, values in FACETS.items() for value in values]
MAX_TAGS = 8

TAGS_RULE = (
    "tags: 3 to 8 from the allowed list that clearly apply, at most one per facet except style "
    "and feel. Only what the garment really shows; leave out anything uncertain."
)


def clean_tags(raw: list[str]) -> list[str]:
    # The schema asks for known tags; only this guarantees them.
    known = set(ALL_TAGS)
    return list(dict.fromkeys(tag for tag in raw if tag in known))[:MAX_TAGS]


# What the basics are, known without asking anyone since they are the same for everybody.
BASIC_TAGS: dict[str, list[str]] = {
    "tee": ["type:tshirt", "fabric:cotton", "fit:regular", "pattern:solid", "style:minimal"],
    "shirt": ["type:shirt", "fabric:cotton", "fit:regular", "pattern:solid", "style:classic"],
    "jeans": ["type:jeans", "fabric:denim", "fit:regular", "pattern:solid", "style:classic"],
    "trousers": ["type:trousers", "fit:regular", "pattern:solid", "style:classic"],
    "shorts": ["type:shorts", "fabric:cotton", "fit:regular", "pattern:solid", "style:minimal"],
    "skirt": ["type:skirt", "pattern:solid", "style:classic"],
    "dress": ["type:dress", "pattern:solid", "style:classic"],
    "sweater": ["type:sweater", "fabric:knit", "fit:regular", "pattern:solid", "feel:soft"],
    "hoodie": ["type:hoodie", "fabric:fleece", "fit:relaxed", "pattern:solid", "feel:soft"],
    "jacket": ["type:jacket", "fabric:synthetic", "fit:regular", "pattern:solid", "style:sporty"],
    "blazer": ["type:blazer", "fit:regular", "pattern:solid", "feel:structured", "style:classic"],
    "coat": ["type:coat", "fabric:wool", "pattern:solid", "feel:heavy", "style:classic"],
    "sneakers": ["type:sneakers", "fabric:leather", "pattern:solid", "style:minimal"],
    "dress_shoes": ["type:dress_shoes", "fabric:leather", "pattern:solid", "style:classic"],
    "bag": ["type:bag", "fabric:leather", "pattern:solid", "style:classic"],
}
