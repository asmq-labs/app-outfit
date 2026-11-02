# ruff: noqa: E501
import io
import uuid
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageOps
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.ai.garments import crear_basico
from app.garments.images import normalize_catalog_image
from app.models import Formality, Garment, GarmentCategory, GarmentStatus, User, Warmth
from app.storage import Storage

TOP, BOTTOM, ONE_PIECE = GarmentCategory.TOP, GarmentCategory.BOTTOM, GarmentCategory.ONE_PIECE
OUTER, SHOES, ACCESSORY = (
    GarmentCategory.OUTERWEAR,
    GarmentCategory.SHOES,
    GarmentCategory.ACCESSORY,
)
LIGHT, MEDIUM, WARM = Warmth.LIGHT, Warmth.MEDIUM, Warmth.WARM
CASUAL, SMART, FORMAL = Formality.CASUAL, Formality.SMART, Formality.FORMAL

# One light grey image per shape, generated once and kept in the repo; colors are painted in code.
BASE_DIR = Path(__file__).parent / "basic_images"


@dataclass(frozen=True)
class Color:
    key: str
    # Adjective forms: masculine, feminine, masculine plural, feminine plural.
    forms: tuple[str, str, str, str]
    swatch: str
    # Tones the grey base maps to: its highlights become `light`, its shadows `dark`.
    light: str
    dark: str


def _color(key: str, forms: str, swatch: str, light: str, dark: str) -> Color:
    words = forms.split("/")
    return Color(key, tuple(words) if len(words) == 4 else (words[0],) * 4, swatch, light, dark)


COLORS = {
    color.key: color
    for color in [
        _color("white", "blanco/blanca/blancos/blancas", "#f5f5f3", "#ffffff", "#c9c9c4"),
        _color("black", "negro/negra/negros/negras", "#1c1c1c", "#4a4a4a", "#0a0a0a"),
        _color("grey", "gris/gris/grises/grises", "#9a9a9a", "#c4c4c4", "#3e3e3e"),
        _color("navy", "azul marino", "#22304f", "#3b4d75", "#0e1526"),
        _color("blue", "azul/azul/azules/azules", "#3d6aa8", "#6d94c8", "#1a2f52"),
        _color("light_blue", "celeste/celeste/celestes/celestes", "#a9c8e8", "#d4e5f5", "#5f7f9f"),
        _color("beige", "beige", "#d8c7a8", "#efe3cc", "#8a7759"),
        _color("brown", "café", "#6b4a32", "#97704f", "#2e1e12"),
        _color("olive", "verde oliva", "#5e6b3d", "#87955e", "#262c16"),
        _color("red", "rojo/roja/rojos/rojas", "#a8262d", "#d24a50", "#4a0c10"),
        _color("pink", "rosado/rosada/rosados/rosadas", "#e5a9b4", "#f7d3da", "#9c5a66"),
        _color("camel", "camel", "#b98a5a", "#d9ad7f", "#5c3f22"),
    ]
}


@dataclass(frozen=True)
class Shape:
    key: str
    name: str
    # Grammatical form of the name, to pick the matching color adjective: m, f, mp or fp.
    gender: str
    category: GarmentCategory
    warmth: Warmth
    formality: Formality
    # English description for the image model; always generated in light grey.
    description: str
    colors: tuple[str, ...]


# One shape per line reads as a table; the formatter would split each into ten lines.
# fmt: off
SHAPES = [
    Shape("tee", "Camiseta", "f", TOP, LIGHT, CASUAL, "a plain crew-neck short-sleeve cotton t-shirt", ("white", "black", "grey", "navy", "beige", "olive", "red", "pink")),
    Shape("shirt", "Camisa", "f", TOP, LIGHT, SMART, "a plain long-sleeve button-down cotton shirt", ("white", "light_blue", "black", "beige", "pink")),
    Shape("jeans", "Jean", "m", BOTTOM, MEDIUM, CASUAL, "straight-leg denim jeans", ("blue", "light_blue", "black", "grey")),
    Shape("trousers", "Pantalón", "m", BOTTOM, MEDIUM, SMART, "plain tailored chino trousers", ("beige", "black", "navy", "grey", "olive", "brown")),
    Shape("shorts", "Short", "m", BOTTOM, LIGHT, CASUAL, "plain cotton shorts", ("beige", "navy", "black", "blue", "olive")),
    Shape("skirt", "Falda", "f", BOTTOM, LIGHT, SMART, "a plain knee-length A-line skirt", ("black", "beige", "navy", "grey", "brown")),
    Shape("dress", "Vestido", "m", ONE_PIECE, LIGHT, SMART, "a plain knee-length short-sleeve dress", ("black", "navy", "red", "beige", "olive")),
    Shape("sweater", "Suéter", "m", OUTER, MEDIUM, CASUAL, "a plain crew-neck knit sweater", ("grey", "black", "navy", "beige", "white", "brown")),
    Shape("hoodie", "Sudadera con capucha", "f", OUTER, MEDIUM, CASUAL, "a plain pullover hoodie", ("grey", "black", "navy", "white")),
    Shape("jacket", "Chaqueta", "f", OUTER, MEDIUM, CASUAL, "a plain hooded zip-up rain jacket", ("black", "navy", "olive", "beige")),
    Shape("blazer", "Blazer", "m", OUTER, MEDIUM, FORMAL, "a plain single-breasted blazer", ("black", "navy", "grey", "beige")),
    Shape("coat", "Abrigo", "m", OUTER, WARM, SMART, "a plain long wool coat", ("camel", "black", "grey", "navy")),
    Shape("sneakers", "Zapatillas", "fp", SHOES, LIGHT, CASUAL, "a pair of plain leather low-top sneakers", ("white", "black", "grey")),
    Shape("dress_shoes", "Zapatos de vestir", "mp", SHOES, MEDIUM, FORMAL, "a pair of plain leather lace-up dress shoes", ("black", "brown")),
    Shape("bag", "Bolso", "m", ACCESSORY, MEDIUM, SMART, "a plain structured leather crossbody bag with its strap tucked out of sight behind the bag", ("black", "brown", "beige")),
]
# fmt: on
SHAPES_BY_KEY = {shape.key: shape for shape in SHAPES}
GENDER_INDEX = {"m": 0, "f": 1, "mp": 2, "fp": 3}


class UnknownBasicError(Exception):
    pass


def basic_key(shape: Shape, color: Color) -> str:
    return f"{shape.key}:{color.key}"


def parse_key(key: str) -> tuple[Shape, Color]:
    shape_key, _, color_key = key.partition(":")
    shape = SHAPES_BY_KEY.get(shape_key)
    if shape is None or color_key not in shape.colors:
        raise UnknownBasicError
    return shape, COLORS[color_key]


def garment_name(shape: Shape, color: Color) -> str:
    return f"{shape.name} {color.forms[GENDER_INDEX[shape.gender]]}"


def base_path(shape: Shape) -> Path:
    return BASE_DIR / f"{shape.key}.jpg"


def available() -> list[Shape]:
    # Only shapes whose base image exists can be offered.
    return [shape for shape in SHAPES if base_path(shape).is_file()]


# Near-white areas this big (in the small working copy) are background showing through, like
# the inside of a bag handle; smaller ones are highlights on the fabric.
HOLE_MIN_PIXELS = 40
MASK_SIDE = 256


def _enclosed_holes(gray: Image.Image) -> Image.Image:
    small = gray.resize((MASK_SIDE, MASK_SIDE))
    pixels = small.load()
    holes = Image.new("L", small.size, 0)
    seen: set[tuple[int, int]] = set()
    for start in ((x, y) for y in range(MASK_SIDE) for x in range(MASK_SIDE)):
        if start in seen or pixels[start] < 248:
            continue
        region, stack = [], [start]
        seen.add(start)
        while stack:
            x, y = stack.pop()
            region.append((x, y))
            for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                if 0 <= nx < MASK_SIDE and 0 <= ny < MASK_SIDE and (nx, ny) not in seen:
                    if pixels[nx, ny] >= 248:
                        seen.add((nx, ny))
                        stack.append((nx, ny))
        if len(region) >= HOLE_MIN_PIXELS:
            for point in region:
                holes.putpixel(point, 255)
    return holes.resize(gray.size)


def _background_mask(gray: Image.Image) -> Image.Image:
    # The background is the near-white area touching the edges plus big enclosed near-white holes.
    marked = gray.copy()
    width, height = marked.size
    for corner in [(0, 0), (width - 1, 0), (0, height - 1), (width - 1, height - 1)]:
        if marked.getpixel(corner) > 240:
            ImageDraw.floodfill(marked, corner, 1, thresh=14)
    edge = marked.point(lambda value: 255 if value == 1 else 0)
    near_white = gray.point(lambda value: 255 if value >= 238 else 0)
    holes = ImageChops.multiply(_enclosed_holes(gray), near_white)
    return ImageChops.invert(ImageChops.lighter(edge, holes))


def garment_mask(shape: Shape) -> Image.Image:
    # The silhouette is the same in every color, so it is worked out once and kept next to the base.
    path = BASE_DIR / f"{shape.key}_mask.png"
    if not path.is_file():
        _background_mask(ImageOps.grayscale(Image.open(base_path(shape)))).convert("1").save(path)
    return Image.open(path).convert("L")


def recolor(base: bytes, color: Color, mask: Image.Image) -> bytes:
    gray = ImageOps.grayscale(Image.open(io.BytesIO(base)))
    painted = ImageOps.colorize(ImageOps.autocontrast(gray, cutoff=1), color.dark, color.light)
    result = Image.new("RGB", gray.size, "white")
    result.paste(painted, (0, 0), mask)
    buffer = io.BytesIO()
    result.save(buffer, "JPEG", quality=90)
    return buffer.getvalue()


def image_path(storage: Storage, shape: Shape, color: Color) -> str:
    # Each color is painted the first time it is asked for, then served from disk.
    path = f"_basics/{shape.key}_{color.key}.jpg"
    if not storage.exists(path):
        storage.save_shared(
            path, recolor(base_path(shape).read_bytes(), color, garment_mask(shape))
        )
    return path


def owned_keys(db: Session, user: User) -> set[str]:
    query = select(Garment.basic_key).where(
        Garment.user_id == user.id, Garment.basic_key.is_not(None)
    )
    return set(db.scalars(query))


def add_to_closet(db: Session, storage: Storage, user: User, keys: list[str]) -> list[Garment]:
    offered = set(available())
    picks = [parse_key(key) for key in dict.fromkeys(keys)]
    if any(shape not in offered for shape, _ in picks):
        raise UnknownBasicError
    garments = []
    for shape, color in picks:
        garment_id = uuid.uuid4()
        # The user gets a copy, so deleting the garment never touches the shared image.
        image = storage.read(image_path(storage, shape, color))
        path = storage.save(user.id, f"{garment_id}_catalog.jpg", image)
        garment = Garment(
            id=garment_id,
            user_id=user.id,
            status=GarmentStatus.READY,
            basic_key=basic_key(shape, color),
            category=shape.category,
            name=garment_name(shape, color),
            color=color.forms[0],
            warmth=shape.warmth,
            formality=shape.formality,
            style_notes=shape.description,
            original_path=path,
            image_path=path,
        )
        db.add(garment)
        garments.append(garment)
    db.commit()
    return garments


def generate_missing() -> None:
    BASE_DIR.mkdir(exist_ok=True)
    for shape in SHAPES:
        if base_path(shape).is_file():
            continue
        print(f"generating {shape.key}")
        description = f"{shape.description}, in a plain light grey color"
        base_path(shape).write_bytes(normalize_catalog_image(crear_basico(description)))
        garment_mask(shape)


if __name__ == "__main__":
    # Paid: one image model call per missing shape (about $0.02 each).
    generate_missing()
