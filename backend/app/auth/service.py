import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.auth.providers import SocialProfile
from app.auth.tokens import create_access_token, hash_refresh_token, new_refresh_token
from app.config import get_settings
from app.models import (
    AuthIdentity,
    Garment,
    Inspiration,
    Outfit,
    RefreshToken,
    SavedOutfit,
    TasteSignal,
    User,
)
from app.storage import get_storage

# A just-rotated token may be retried once the response got lost on a bad connection.
REUSE_GRACE = timedelta(seconds=60)


class InvalidRefreshTokenError(Exception):
    pass


@dataclass(frozen=True)
class TokenPair:
    access_token: str
    refresh_token: str
    expires_in: int


def create_guest(db: Session) -> User:
    user = User()
    db.add(user)
    db.commit()
    return user


def _merge_guest(db: Session, guest: User, account: User) -> None:
    # What the guest added before signing in moves to the account they already had.
    storage = get_storage()
    for garment in db.scalars(select(Garment).where(Garment.user_id == guest.id)):
        garment.user_id = account.id
        shared_file = garment.image_path == garment.original_path
        garment.original_path = storage.move(garment.original_path, account.id)
        # Basics use one file for both paths, so it is moved only once.
        if shared_file:
            garment.image_path = garment.original_path
        elif garment.image_path:
            garment.image_path = storage.move(garment.image_path, account.id)
    for inspiration in db.scalars(select(Inspiration).where(Inspiration.user_id == guest.id)):
        inspiration.user_id = account.id
        inspiration.photo_path = storage.move(inspiration.photo_path, account.id)
    db.execute(
        update(Outfit)
        .where(Outfit.user_id == guest.id, Outfit.worn_at.is_not(None))
        .values(user_id=account.id)
    )
    db.execute(
        update(SavedOutfit).where(SavedOutfit.user_id == guest.id).values(user_id=account.id)
    )
    db.execute(
        update(TasteSignal).where(TasteSignal.user_id == guest.id).values(user_id=account.id)
    )
    db.flush()
    db.delete(guest)
    db.commit()
    storage.delete_user(guest.id)


def login_with_provider(db: Session, profile: SocialProfile, current_user: User | None) -> User:
    identity = db.scalar(
        select(AuthIdentity).where(
            AuthIdentity.provider == profile.provider,
            AuthIdentity.subject == profile.subject,
        )
    )
    if identity is not None:
        if current_user is not None and current_user.is_guest:
            _merge_guest(db, current_user, identity.user)
        return identity.user

    # A guest keeps their account (and closet) when they sign in for the first time.
    user = current_user if current_user is not None and current_user.is_guest else User()
    user.email = user.email or profile.email
    user.display_name = user.display_name or profile.name
    user.identities.append(
        AuthIdentity(provider=profile.provider, subject=profile.subject, email=profile.email)
    )
    db.add(user)
    db.commit()
    return user


def issue_tokens(db: Session, user: User, family_id: uuid.UUID | None = None) -> TokenPair:
    settings = get_settings()
    raw_token = new_refresh_token()
    db.add(
        RefreshToken(
            user_id=user.id,
            family_id=family_id or uuid.uuid4(),
            token_hash=hash_refresh_token(raw_token),
            expires_at=datetime.now(UTC) + timedelta(days=settings.refresh_token_days),
            # The real moment, not the transaction's: rotation compares tokens by age.
            created_at=datetime.now(UTC),
        )
    )
    db.commit()
    return TokenPair(
        access_token=create_access_token(user.id),
        refresh_token=raw_token,
        expires_in=settings.access_token_minutes * 60,
    )


def _find_refresh_token(db: Session, raw_token: str) -> RefreshToken | None:
    return db.scalar(
        select(RefreshToken).where(RefreshToken.token_hash == hash_refresh_token(raw_token))
    )


def _revoke_family(db: Session, family_id: uuid.UUID) -> None:
    db.execute(
        update(RefreshToken)
        .where(RefreshToken.family_id == family_id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=datetime.now(UTC))
    )
    db.commit()


def _was_succeeded(db: Session, token: RefreshToken) -> bool:
    # A newer token already in use proves the phone got its answer to this one.
    newer_in_use = db.scalar(
        select(RefreshToken.id)
        .where(
            RefreshToken.family_id == token.family_id,
            RefreshToken.created_at > token.created_at,
            RefreshToken.used_at.is_not(None),
        )
        .limit(1)
    )
    return newer_in_use is not None


def rotate_refresh_token(db: Session, raw_token: str) -> tuple[User, TokenPair]:
    now = datetime.now(UTC)
    token = _find_refresh_token(db, raw_token)
    if token is None or token.revoked_at is not None or token.expires_at <= now:
        raise InvalidRefreshTokenError

    user = db.get(User, token.user_id)
    if user is None:
        raise InvalidRefreshTokenError

    if token.used_at is not None and now - token.used_at > REUSE_GRACE:
        # A guest has no login to come back with, so an answer lost on a bad connection must not
        # cost them their closet. Anything else means the token was copied: end the session.
        if not user.is_guest or _was_succeeded(db, token):
            _revoke_family(db, token.family_id)
            raise InvalidRefreshTokenError

    token.used_at = token.used_at or now
    return user, issue_tokens(db, user, family_id=token.family_id)


def logout(db: Session, raw_token: str) -> None:
    token = _find_refresh_token(db, raw_token)
    if token is not None:
        _revoke_family(db, token.family_id)


def delete_account(db: Session, user: User) -> None:
    db.delete(user)
    db.commit()
