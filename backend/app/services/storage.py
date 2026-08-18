from __future__ import annotations

from functools import lru_cache
from typing import Any

import boto3

from app.core.config import settings
from app.core.errors import api_error

ALLOWED_MEDIA_TYPES = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}


@lru_cache
def get_s3_client() -> Any:
    return boto3.client(
        "s3",
        endpoint_url=settings.s3_endpoint_url,
        region_name=settings.s3_region,
        aws_access_key_id=settings.s3_access_key_id,
        aws_secret_access_key=settings.s3_secret_access_key,
    )


def ensure_storage_configured() -> None:
    if not settings.s3_bucket or not settings.s3_access_key_id or not settings.s3_secret_access_key:
        raise api_error(503, "storage_unavailable", "Media storage is not configured.")


def create_presigned_upload(object_key: str, content_type: str) -> dict[str, Any]:
    ensure_storage_configured()
    if content_type not in ALLOWED_MEDIA_TYPES:
        raise api_error(422, "invalid_media_type", "Use a JPEG, PNG, or WebP image.")
    return get_s3_client().generate_presigned_post(
        Bucket=settings.s3_bucket,
        Key=object_key,
        Fields={"Content-Type": content_type},
        Conditions=[
            {"Content-Type": content_type},
            ["content-length-range", 1, settings.media_max_bytes],
        ],
        ExpiresIn=settings.s3_presign_seconds,
    )


def create_signed_read_url(object_key: str | None) -> str | None:
    if not object_key:
        return None
    ensure_storage_configured()
    return get_s3_client().generate_presigned_url(
        "get_object",
        Params={"Bucket": settings.s3_bucket, "Key": object_key},
        ExpiresIn=settings.s3_presign_seconds,
    )
