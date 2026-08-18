import uuid

from fastapi import APIRouter

from app.api.deps import AdminUser, SessionDep
from app.core.config import settings
from app.core.errors import api_error
from app.db.models import Player, Team
from app.schemas import PresignRequest, PresignResponse
from app.services.storage import ALLOWED_MEDIA_TYPES, create_presigned_upload

router = APIRouter()


@router.post("/uploads/presign", response_model=PresignResponse)
async def presign_upload(
    payload: PresignRequest, _: AdminUser, session: SessionDep
) -> PresignResponse:
    if not settings.media_enabled:
        raise api_error(503, "media_disabled", "Photo uploads are disabled in this environment.")
    model = Team if payload.entity == "team" else Player
    if await session.get(model, payload.entity_id) is None:
        raise api_error(404, "entity_not_found", "Upload target not found.")
    extension = ALLOWED_MEDIA_TYPES[payload.content_type]
    object_key = f"{payload.entity}s/{payload.entity_id}/{uuid.uuid4()}.{extension}"
    presigned = create_presigned_upload(object_key, payload.content_type)
    return PresignResponse(
        upload_url=presigned["url"],
        fields=presigned["fields"],
        object_key=object_key,
        expires_in=settings.s3_presign_seconds,
    )
