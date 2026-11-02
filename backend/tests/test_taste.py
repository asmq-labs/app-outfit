import uuid

from sqlalchemy import select

from app.ai.garments import ITEM_SCHEMA, analizar_prenda
from app.ai.outfits import _wishes, describe_garment
from app.garments import basics
from app.garments.tags import ALL_TAGS, BASIC_TAGS, clean_tags
from app.models import Garment, GarmentCategory, SignalKind, TasteSignal, User
from app.outfits import taste
from tests.conftest import auth_header
from tests.test_outfits import asks, closet, feel, ids_with, manual, request, stylist, today, user  # noqa: F401


def signals(db, kind=None):
    query = select(TasteSignal)
    if kind:
        query = query.where(TasteSignal.kind == kind)
    return list(db.scalars(query))


def test_wearing_logs_a_signal_and_undoing_erases_it(client, db, user, closet, stylist):
    shown = today(client, user).json()

    client.post(f"/v1/outfits/{shown['id']}/wear", headers=user)
    assert len(signals(db, SignalKind.WORN)) == 3

    client.post(f"/v1/outfits/{shown['id']}/unwear", headers=user)
    assert signals(db, SignalKind.WORN) == []


def test_changing_an_opinion_replaces_its_signals(client, db, user, closet, stylist):
    shown = today(client, user).json()

    feel(client, user, shown, "good", ["comfortable"])
    feel(client, user, shown, "bad", ["too_hot"])

    assert {s.value for s in signals(db, SignalKind.FELT)} == {"too_hot"}

    feel(client, user, shown, None)
    assert signals(db, SignalKind.FELT) == []


def test_a_combination_reason_stays_off_the_pieces_but_on_record(client, db, user, closet, stylist):
    shown = today(client, user).json()

    feel(client, user, shown, "bad", ["bad_match"])

    felt = signals(db, SignalKind.FELT)
    assert {s.value for s in felt if s.garment_id is None} == {"bad_match"}
    assert {s.value for s in felt if s.garment_id is not None} == {taste.DISLIKED}


def test_swapping_logs_what_left_and_what_came_in(client, db, user, closet, stylist):
    shown = today(client, user).json()
    old = shown["garments"]["bottom"]["id"]
    new = next(str(g.id) for g in closet[2:4] if str(g.id) != old)

    client.put(
        f"/v1/outfits/{shown['id']}/garments",
        json={"garments": ids_with(shown, bottom=new)},
        headers=user,
    )

    assert [str(s.garment_id) for s in signals(db, SignalKind.SWAPPED_OUT)] == [old]
    assert [str(s.garment_id) for s in signals(db, SignalKind.SWAPPED_IN)] == [new]


def test_otra_and_building_by_hand_are_logged(client, db, user, closet, stylist):
    shown = today(client, user).json()
    client.post(f"/v1/outfits/{shown['id']}/another", headers=user)
    manual(client, user, closet, worn=False)

    assert len(signals(db, SignalKind.SKIPPED)) == 3
    assert len(signals(db, SignalKind.HAND_PICKED)) == 3


def test_removing_a_record_erases_its_signals_but_a_deleted_garment_keeps_them(
    client, db, user, closet, stylist
):
    logged = manual(client, user, closet, worn=True).json()
    client.delete(f"/v1/outfits/{logged['id']}", headers=user)
    assert signals(db) == []

    shown = today(client, user).json()
    top_id = shown["garments"]["top"]["id"]
    feel(client, user, shown, "bad", ["uncomfortable"], [top_id])
    client.delete(f"/v1/garments/{top_id}", headers=user)

    remaining = signals(db, SignalKind.FELT)
    assert [(s.value, s.garment_id, s.outfit_id) for s in remaining] == [
        ("uncomfortable", None, None)
    ]


def test_history_reaches_the_stylist_with_every_kind_of_sign(client, user, closet, asks):
    shown = today(client, user).json()
    top_id = uuid.UUID(shown["garments"]["top"]["id"])
    feel(client, user, shown, "good", ["comfortable"], [str(top_id)])
    manual(client, user, closet, worn=False, day=shown["day"], occasion="work")

    request(client, user)

    history = asks[-1]["history"]
    assert history[top_id]["comfortable"] == 1
    assert history[closet[2].id]["chosen by them"] == 1


def tagged(user_id, category, *tags):
    return Garment(
        id=uuid.uuid4(),
        user_id=user_id,
        category=category,
        name="x",
        original_path="x.jpg",
        tags=list(tags),
    )


def test_a_tag_is_learned_only_when_several_garments_agree(db):
    person = User()
    db.add(person)
    db.flush()
    soft_a = tagged(person.id, GarmentCategory.TOP, "feel:soft", "fabric:knit")
    soft_b = tagged(person.id, GarmentCategory.BOTTOM, "feel:soft")
    other = tagged(person.id, GarmentCategory.SHOES, "fabric:leather")
    db.add_all([soft_a, soft_b, other])
    db.flush()
    for garment in (soft_a, soft_b, other):
        db.add(
            TasteSignal(
                user_id=person.id, garment_id=garment.id, kind=SignalKind.FELT, value="comfortable"
            )
        )
    db.add(
        TasteSignal(user_id=person.id, garment_id=soft_a.id, kind=SignalKind.FELT, value="colors")
    )
    db.flush()

    learned = taste.learned_tags(db, person, [soft_a, soft_b, other])

    assert learned == {"comfortable": ["feel:soft"]}


def test_what_one_person_learned_does_not_reach_another(db):
    first, second = User(), User()
    db.add_all([first, second])
    db.flush()
    a, b = (
        tagged(first.id, GarmentCategory.TOP, "feel:soft"),
        tagged(first.id, GarmentCategory.BOTTOM, "feel:soft"),
    )
    db.add_all([a, b])
    db.flush()
    for garment in (a, b):
        db.add(
            TasteSignal(
                user_id=first.id, garment_id=garment.id, kind=SignalKind.FELT, value="comfortable"
            )
        )
    db.flush()

    assert taste.learned_tags(db, first, [a, b]) == {"comfortable": ["feel:soft"]}
    assert taste.learned_tags(db, second, [a, b]) == {}
    assert taste.garment_history(db, second) == {}


def test_learned_tags_appear_in_the_prompt_and_tags_only_then():
    garment = Garment(category=GarmentCategory.TOP, tags=["feel:soft"])

    assert "tags" not in describe_garment("g1", garment)
    assert describe_garment("g1", garment, None, True)["tags"] == ["feel:soft"]
    assert '"comfortable": ["feel:soft"]' in _wishes(
        None, None, None, {"comfortable": ["feel:soft"]}
    )


def test_unknown_tags_are_dropped_and_repeats_removed():
    assert clean_tags(["feel:soft", "made:up", "feel:soft"]) == ["feel:soft"]


def test_every_basic_has_tags_from_the_vocabulary():
    assert set(BASIC_TAGS) == {shape.key for shape in basics.SHAPES}
    for tags in BASIC_TAGS.values():
        assert set(tags) <= set(ALL_TAGS)


def test_a_new_basic_comes_with_its_tags(client, user):
    created = client.post("/v1/basics", json={"keys": ["tee:white"]}, headers=user).json()

    assert created[0]["tags"] == BASIC_TAGS["tee"]


def test_the_analysis_asks_for_tags_and_keeps_only_known_ones(monkeypatch):
    raw = {
        "category": "top",
        "name": "Camiseta",
        "color": "gris",
        "warmth": "light",
        "formality": "casual",
        "style_notes": "cotton",
        "tags": ["type:tshirt", "invented:tag"],
        "description": "the tee",
    }
    monkeypatch.setattr("app.ai.openrouter.chat_json", lambda *a, **k: {"items": [raw]})

    assert "tags" in ITEM_SCHEMA["required"]
    assert analizar_prenda(b"photo")[0].tags == ("type:tshirt",)


def test_signing_in_keeps_what_the_guest_taught_the_app(client, db, make_id_token, monkeypatch):
    existing = client.post("/v1/auth/google", json={"id_token": make_id_token()}).json()
    guest = client.post("/v1/auth/guest").json()
    guest_id = uuid.UUID(guest["user"]["id"])
    db.add(TasteSignal(user_id=guest_id, kind=SignalKind.FELT, value="colors"))
    db.commit()

    client.post("/v1/auth/google", json={"id_token": make_id_token()}, headers=auth_header(guest))

    assert [str(s.user_id) for s in signals(db, SignalKind.FELT)] == [existing["user"]["id"]]
