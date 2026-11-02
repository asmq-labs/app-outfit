import uuid

import pytest

from app import jobs
from app.ai.inspirations import LookMatch, MissingPiece
from app.config import get_settings
from app.inspirations import processing
from app.models import Formality, GarmentCategory
from tests.conftest import auth_header
from tests.test_garments import image_bytes
from tests.test_outfits import TODAY, garment


@pytest.fixture
def user(client) -> dict[str, str]:
    return auth_header(client.post("/v1/auth/guest").json())


@pytest.fixture
def closet(client, db, user):
    user_id = uuid.UUID(client.get("/v1/me", headers=user).json()["id"])
    items = {
        "top": garment(GarmentCategory.TOP),
        "bottom": garment(GarmentCategory.BOTTOM),
        "shoes": garment(GarmentCategory.SHOES),
        "formal_shoes": garment(GarmentCategory.SHOES, formality=Formality.FORMAL),
    }
    for item in items.values():
        item.user_id = user_id
    db.add_all(items.values())
    db.commit()
    return items


def match(**slots) -> LookMatch:
    ids = dict.fromkeys(GarmentCategory)
    ids.update({GarmentCategory(name): item.id for name, item in slots.items()})
    return LookMatch(
        is_look=True,
        garment_ids=ids,
        missing=[MissingPiece(GarmentCategory.OUTERWEAR, "Abrigo largo camel")],
        explanation="Tu versión mantiene los tonos neutros del look.",
    )


@pytest.fixture
def stylist(monkeypatch):
    found = {}
    monkeypatch.setattr(processing, "extraer_estilo", lambda photo, closet: found["match"])
    return found


def upload(client, headers):
    files = {"photo": ("look.jpg", image_bytes(), "image/jpeg")}
    return client.post("/v1/inspirations", files=files, headers=headers)


def test_a_look_is_matched_with_the_closet(client, db, user, closet, stylist):
    stylist["match"] = match(top=closet["top"], bottom=closet["bottom"])
    created = upload(client, user)
    assert created.status_code == 202
    assert created.json()["status"] == "processing"

    jobs.run_next_job(db)

    look = client.get(f"/v1/inspirations/{created.json()['id']}", headers=user).json()
    assert look["status"] == "ready"
    assert look["garments"]["top"]["id"] == str(closet["top"].id)
    assert look["garments"]["shoes"] is None
    assert look["missing"] == [{"category": "outerwear", "name": "Abrigo largo camel"}]
    image = client.get(f"/v1/inspirations/{created.json()['id']}/image", headers=user)
    assert image.status_code == 200


def test_a_photo_without_a_look_fails(client, db, user, closet, stylist):
    stylist["match"] = LookMatch(False, dict.fromkeys(GarmentCategory), [], "")
    created = upload(client, user).json()

    jobs.run_next_job(db)

    look = client.get(f"/v1/inspirations/{created['id']}", headers=user).json()
    assert look["status"] == "failed"
    assert look["failure_reason"] == "not_a_look"


def test_using_a_look_makes_it_today_and_fills_what_it_lacks(client, db, user, closet, stylist):
    stylist["match"] = match(top=closet["top"], bottom=closet["bottom"])
    created = upload(client, user).json()
    jobs.run_next_job(db)

    outfit = client.post(
        f"/v1/inspirations/{created['id']}/use?day={TODAY}&occasion=formal", headers=user
    )

    assert outfit.status_code == 200
    assert outfit.json()["garments"]["top"]["id"] == str(closet["top"].id)
    assert outfit.json()["garments"]["shoes"]["id"] == str(closet["formal_shoes"].id)
    today = client.get(f"/v1/outfits/today?day={TODAY}&occasion=formal", headers=user)
    assert today.json()["id"] == outfit.json()["id"]


def test_a_look_still_processing_cannot_be_used(client, user, closet):
    created = upload(client, user).json()

    response = client.post(
        f"/v1/inspirations/{created['id']}/use?day={TODAY}&occasion=casual", headers=user
    )

    assert response.status_code == 409


def test_looks_are_private_and_can_be_deleted(client, db, user, closet, stylist):
    stylist["match"] = match(top=closet["top"])
    created = upload(client, user).json()
    stranger = auth_header(client.post("/v1/auth/guest").json())
    url = f"/v1/inspirations/{created['id']}"

    assert client.get(url, headers=stranger).status_code == 404
    assert client.get("/v1/inspirations", headers=stranger).json() == []
    assert client.delete(url, headers=user).status_code == 204
    assert client.get(url, headers=user).status_code == 404


def test_looks_stop_at_the_daily_limit(client, user, monkeypatch):
    monkeypatch.setattr(get_settings(), "inspirations_per_day", 1)
    assert upload(client, user).status_code == 202

    assert upload(client, user).status_code == 429


def test_a_deleted_garment_becomes_what_the_look_is_missing(client, db, user, closet, stylist):
    stylist["match"] = match(top=closet["top"], bottom=closet["bottom"])
    created = upload(client, user).json()
    jobs.run_next_job(db)
    name = closet["top"].name

    client.delete(f"/v1/garments/{closet['top'].id}", headers=user)

    look = client.get(f"/v1/inspirations/{created['id']}", headers=user).json()
    assert look["garments"]["top"] is None
    assert {"category": "top", "name": name} in look["missing"]
