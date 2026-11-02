import time
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import update

from app.auth.service import REUSE_GRACE
from app.config import get_settings
from app.models import RefreshToken
from tests.conftest import auth_header


def test_guest_gets_a_working_session(client):
    session = client.post("/v1/auth/guest")
    assert session.status_code == 201

    me = client.get("/v1/me", headers=auth_header(session.json()))
    assert me.status_code == 200
    assert me.json()["is_guest"] is True
    assert me.json()["id"] == session.json()["user"]["id"]


def test_me_rejects_missing_and_invalid_tokens(client):
    session = client.post("/v1/auth/guest").json()

    assert client.get("/v1/me").status_code == 401
    assert client.get("/v1/me", headers={"Authorization": "Bearer nope"}).status_code == 401
    # A refresh token must never work as an access token.
    refresh_as_access = {"Authorization": f"Bearer {session['refresh_token']}"}
    assert client.get("/v1/me", headers=refresh_as_access).status_code == 401


@pytest.mark.parametrize("provider", ["google", "apple"])
def test_social_login_creates_the_user_once(client, make_id_token, provider):
    first = client.post(f"/v1/auth/{provider}", json={"id_token": make_id_token(provider)})
    second = client.post(f"/v1/auth/{provider}", json={"id_token": make_id_token(provider)})

    assert first.status_code == 200
    assert first.json()["user"]["is_guest"] is False
    assert first.json()["user"]["email"] == "user-1@example.com"
    assert second.json()["user"]["id"] == first.json()["user"]["id"]


def test_same_subject_on_another_provider_is_a_different_user(client, make_id_token):
    google = client.post("/v1/auth/google", json={"id_token": make_id_token("google")})
    apple = client.post("/v1/auth/apple", json={"id_token": make_id_token("apple")})

    assert google.json()["user"]["id"] != apple.json()["user"]["id"]


def test_guest_keeps_the_account_when_signing_in(client, make_id_token):
    guest = client.post("/v1/auth/guest").json()

    signed_in = client.post(
        "/v1/auth/google", json={"id_token": make_id_token()}, headers=auth_header(guest)
    )

    assert signed_in.json()["user"]["id"] == guest["user"]["id"]
    assert signed_in.json()["user"]["is_guest"] is False


def test_guest_signing_in_to_an_existing_account_gets_that_account(client, make_id_token):
    existing = client.post("/v1/auth/google", json={"id_token": make_id_token()}).json()
    guest = client.post("/v1/auth/guest").json()

    signed_in = client.post(
        "/v1/auth/google", json={"id_token": make_id_token()}, headers=auth_header(guest)
    )

    assert signed_in.json()["user"]["id"] == existing["user"]["id"]


@pytest.mark.parametrize(
    "overrides",
    [
        {"aud": "someone-elses-app"},
        {"iss": "https://evil.example.com"},
        {"exp": int(time.time()) - 60},
    ],
)
def test_social_login_rejects_bad_id_tokens(client, make_id_token, overrides):
    response = client.post("/v1/auth/google", json={"id_token": make_id_token(**overrides)})

    assert response.status_code == 401
    assert response.json()["detail"] == "invalid_id_token"


def test_unknown_provider_is_rejected(client):
    assert client.post("/v1/auth/facebook", json={"id_token": "x"}).status_code == 422


def test_refresh_rotates_the_token(client):
    session = client.post("/v1/auth/guest").json()

    refreshed = client.post("/v1/auth/refresh", json={"refresh_token": session["refresh_token"]})

    assert refreshed.status_code == 200
    assert refreshed.json()["refresh_token"] != session["refresh_token"]
    assert client.get("/v1/me", headers=auth_header(refreshed.json())).status_code == 200


def test_refresh_retry_within_the_grace_window_still_works(client):
    session = client.post("/v1/auth/guest").json()
    body = {"refresh_token": session["refresh_token"]}

    assert client.post("/v1/auth/refresh", json=body).status_code == 200
    assert client.post("/v1/auth/refresh", json=body).status_code == 200


def test_reusing_an_old_refresh_token_ends_the_session(client, db):
    session = client.post("/v1/auth/guest").json()
    old = {"refresh_token": session["refresh_token"]}
    current = client.post("/v1/auth/refresh", json=old).json()
    # The phone got its answer: it went on to use the new token.
    current = client.post(
        "/v1/auth/refresh", json={"refresh_token": current["refresh_token"]}
    ).json()

    long_ago = datetime.now(UTC) - REUSE_GRACE - timedelta(seconds=1)
    db.execute(
        update(RefreshToken).where(RefreshToken.used_at.is_not(None)).values(used_at=long_ago)
    )

    assert client.post("/v1/auth/refresh", json=old).status_code == 401
    still_valid = {"refresh_token": current["refresh_token"]}
    assert client.post("/v1/auth/refresh", json=still_valid).status_code == 401


def test_guest_keeps_their_closet_when_a_refresh_answer_was_lost(client, db):
    session = client.post("/v1/auth/guest").json()
    old = {"refresh_token": session["refresh_token"]}
    # The server rotated, but the answer never reached the phone.
    assert client.post("/v1/auth/refresh", json=old).status_code == 200

    long_ago = datetime.now(UTC) - REUSE_GRACE - timedelta(seconds=1)
    db.execute(
        update(RefreshToken).where(RefreshToken.used_at.is_not(None)).values(used_at=long_ago)
    )

    retried = client.post("/v1/auth/refresh", json=old)

    assert retried.status_code == 200
    assert retried.json()["user"]["id"] == session["user"]["id"]


def test_a_signed_in_user_loses_the_session_on_any_old_token(client, db, make_id_token):
    session = client.post("/v1/auth/google", json={"id_token": make_id_token()}).json()
    old = {"refresh_token": session["refresh_token"]}
    assert client.post("/v1/auth/refresh", json=old).status_code == 200

    long_ago = datetime.now(UTC) - REUSE_GRACE - timedelta(seconds=1)
    db.execute(
        update(RefreshToken).where(RefreshToken.used_at.is_not(None)).values(used_at=long_ago)
    )

    assert client.post("/v1/auth/refresh", json=old).status_code == 401


def test_expired_and_unknown_refresh_tokens_are_rejected(client, db):
    session = client.post("/v1/auth/guest").json()
    db.execute(update(RefreshToken).values(expires_at=datetime.now(UTC) - timedelta(seconds=1)))

    expired = client.post("/v1/auth/refresh", json={"refresh_token": session["refresh_token"]})
    unknown = client.post("/v1/auth/refresh", json={"refresh_token": "never-issued"})

    assert expired.status_code == 401
    assert unknown.status_code == 401


def test_logout_revokes_the_session(client):
    session = client.post("/v1/auth/guest").json()
    body = {"refresh_token": session["refresh_token"]}

    assert client.post("/v1/auth/logout", json=body).status_code == 204
    assert client.post("/v1/auth/refresh", json=body).status_code == 401


def test_deleting_the_account_removes_everything(client, db, make_id_token):
    session = client.post("/v1/auth/google", json={"id_token": make_id_token()}).json()

    assert client.delete("/v1/me", headers=auth_header(session)).status_code == 204

    assert client.get("/v1/me", headers=auth_header(session)).status_code == 401
    body = {"refresh_token": session["refresh_token"]}
    assert client.post("/v1/auth/refresh", json=body).status_code == 401
    assert db.query(RefreshToken).count() == 0


def test_guest_accounts_are_limited_per_address(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "guest_accounts_per_hour", 2)
    assert client.post("/v1/auth/guest").status_code == 201
    assert client.post("/v1/auth/guest").status_code == 201

    response = client.post("/v1/auth/guest")

    assert response.status_code == 429
    assert response.json()["detail"] == "too_many_guest_accounts"
