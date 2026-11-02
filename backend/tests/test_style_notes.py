import uuid

from app.ai import garments as ai_garments
from app.ai.openrouter import AIError
from app.ai.outfits import PROMPT, _schema, describe_garment
from app.garments import style_backfill
from app.garments.service import describe
from app.models import Formality, Garment, GarmentCategory, GarmentStatus, Warmth
from tests.conftest import auth_header


class FakeStorage:
    def read(self, path):
        return b"image"


def add_garment(db, user_id, **fields):
    item = Garment(
        user_id=user_id,
        status=GarmentStatus.READY,
        category=GarmentCategory.TOP,
        name="Camiseta",
        color="beige",
        warmth=Warmth.LIGHT,
        formality=Formality.CASUAL,
        original_path="o.jpg",
        image_path="c.jpg",
        **fields,
    )
    db.add(item)
    db.commit()
    return item


def user_id(client):
    headers = auth_header(client.post("/v1/auth/guest").json())
    return uuid.UUID(client.get("/v1/me", headers=headers).json()["id"])


def test_the_analysis_requires_and_keeps_style_notes(monkeypatch):
    raw = {
        "category": "top",
        "name": "Camiseta beige",
        "color": "beige",
        "warmth": "light",
        "formality": "casual",
        "style_notes": "waffle-knit cotton, relaxed fit, solid",
        "description": "the beige t-shirt",
    }
    monkeypatch.setattr(ai_garments.openrouter, "chat_json", lambda *a, **k: {"items": [raw]})

    analysis = ai_garments.analizar_prenda(b"photo")[0]
    garment = Garment()
    describe(garment, analysis)

    assert "style_notes" in ai_garments.ITEM_SCHEMA["required"]
    assert garment.style_notes == "waffle-knit cotton, relaxed fit, solid"


def test_the_stylist_sees_style_notes_and_is_asked_to_rank():
    garment = Garment(category=GarmentCategory.TOP, style_notes="waffle-knit cotton")

    assert describe_garment("g1", garment)["style_notes"] == "waffle-knit cotton"
    assert "best to worst" in PROMPT


def test_each_slot_only_admits_refs_of_its_own_category():
    closet = {
        "g1": Garment(category=GarmentCategory.TOP),
        "g2": Garment(category=GarmentCategory.SHOES),
    }

    slots = _schema(closet)["properties"]["outfits"]["items"]["properties"]

    assert slots["top"]["enum"] == ["g1", None]
    assert slots["shoes"]["enum"] == ["g2", None]
    assert slots["bottom"]["enum"] == [None]


def test_backfill_uses_the_shape_for_basics_and_the_model_for_photos(client, db, monkeypatch):
    owner = user_id(client)
    basic = add_garment(db, owner, basic_key="tee:beige")
    photo = add_garment(db, owner)
    described = add_garment(db, owner, style_notes="already known")
    calls = []

    def analyse(image):
        calls.append(image)
        return "linen, relaxed"

    monkeypatch.setattr(style_backfill, "analizar_estilo", analyse)

    done, failed = style_backfill.backfill_style_notes(db, FakeStorage())

    assert (done, failed) == (2, 0)
    assert "t-shirt" in basic.style_notes
    assert photo.style_notes == "linen, relaxed"
    assert described.style_notes == "already known"
    assert calls == [b"image"]


def test_backfill_survives_a_model_failure_and_can_be_repeated(client, db, monkeypatch):
    garment = add_garment(db, user_id(client))

    def broken(image):
        raise AIError("down")

    monkeypatch.setattr(style_backfill, "analizar_estilo", broken)

    assert style_backfill.backfill_style_notes(db, FakeStorage()) == (0, 1)
    assert garment.style_notes is None
