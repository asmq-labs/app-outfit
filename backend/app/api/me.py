from fastapi import APIRouter, status

from app.api.schemas import StyleProfileIn, UserOut
from app.auth import service
from app.auth.deps import CurrentUser, DbSession
from app.outfits import service as outfit_service
from app.storage import get_storage

router = APIRouter(prefix="/me", tags=["me"])


@router.get("")
def read_me(user: CurrentUser) -> UserOut:
    return UserOut.model_validate(user)


@router.put("/style-profile")
def update_style_profile(body: StyleProfileIn, user: CurrentUser, db: DbSession) -> UserOut:
    outfit_service.set_style_profile(db, user, body.style_profile.strip() or None)
    return UserOut.model_validate(user)


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
def delete_me(user: CurrentUser, db: DbSession) -> None:
    user_id = user.id
    service.delete_account(db, user)
    get_storage().delete_user(user_id)
