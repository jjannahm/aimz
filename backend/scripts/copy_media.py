"""Copy media objects from Cloudflare R2 into the AWS S3 media bucket.

Stage 3 of the AWS migration, alongside ``import_d1``. The database holds only
the object *keys* (``teams.logo_key``, ``players.photo_key``); the bytes live in
R2. This copies exactly the keys the database references — not a blind bucket
mirror — so orphaned or superseded uploads are left behind rather than dragged
across.

R2 is S3-compatible, so both ends are boto3 S3 clients; only the endpoint and
credentials differ. The target reuses the app's own S3 settings, so run this
where the backend is configured (the container in production). The source R2
credentials come from the environment:

    R2_ENDPOINT_URL=https://<account>.r2.cloudflarestorage.com   (or R2_ACCOUNT_ID)
    R2_ACCESS_KEY_ID=...
    R2_SECRET_ACCESS_KEY=...
    R2_BUCKET=aimz-staging-media

Each object is copied only if the target does not already have it, so the copy
is safe to re-run and resumes after a partial run. Usage:

    python -m scripts.copy_media
    python -m scripts.copy_media --dry-run      # list what would be copied
    python -m scripts.copy_media --overwrite    # re-copy even if present
"""

from __future__ import annotations

import argparse
import asyncio
import os
from dataclasses import dataclass

import boto3
from botocore.exceptions import ClientError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import create_async_engine

from app.core.config import normalize_database_url, settings
from app.db.models import Player, Team


@dataclass
class _Tally:
    copied: int = 0
    skipped: int = 0
    missing: int = 0


async def _referenced_keys() -> list[str]:
    """Every distinct, non-null media key the database points at."""
    engine = create_async_engine(
        normalize_database_url(_require_database_url()), pool_pre_ping=True
    )
    try:
        async with engine.connect() as connection:
            logos = (
                await connection.scalars(
                    select(Team.logo_key).where(Team.logo_key.is_not(None)).distinct()
                )
            ).all()
            photos = (
                await connection.scalars(
                    select(Player.photo_key).where(Player.photo_key.is_not(None)).distinct()
                )
            ).all()
    finally:
        await engine.dispose()
    return sorted({*logos, *photos})


def _source_client() -> tuple[object, str]:
    account = os.getenv("R2_ACCOUNT_ID")
    endpoint = os.getenv("R2_ENDPOINT_URL") or (
        f"https://{account}.r2.cloudflarestorage.com" if account else None
    )
    bucket = os.getenv("R2_BUCKET")
    key_id = os.getenv("R2_ACCESS_KEY_ID")
    secret = os.getenv("R2_SECRET_ACCESS_KEY")
    if not (endpoint and bucket and key_id and secret):
        raise SystemExit(
            "Set R2_ENDPOINT_URL (or R2_ACCOUNT_ID), R2_BUCKET, R2_ACCESS_KEY_ID "
            "and R2_SECRET_ACCESS_KEY for the source."
        )
    client = boto3.client(
        "s3",
        endpoint_url=endpoint,
        region_name="auto",
        aws_access_key_id=key_id,
        aws_secret_access_key=secret,
    )
    return client, bucket


def _target_client() -> tuple[object, str]:
    if not settings.s3_bucket:
        raise SystemExit("The target S3 bucket is not configured (settings.s3_bucket).")
    client = boto3.client(
        "s3",
        endpoint_url=settings.s3_endpoint_url,
        region_name=settings.s3_region,
        aws_access_key_id=settings.s3_access_key_id,
        aws_secret_access_key=settings.s3_secret_access_key,
    )
    return client, settings.s3_bucket


def _already_there(client: object, bucket: str, key: str) -> bool:
    try:
        client.head_object(Bucket=bucket, Key=key)
        return True
    except ClientError as error:
        if error.response["Error"]["Code"] in {"404", "NoSuchKey", "NotFound"}:
            return False
        raise


def _copy_objects(keys: list[str], dry_run: bool, overwrite: bool) -> _Tally:
    source, source_bucket = _source_client()
    target, target_bucket = _target_client()
    tally = _Tally()
    for key in keys:
        if not overwrite and _already_there(target, target_bucket, key):
            tally.skipped += 1
            continue
        try:
            obj = source.get_object(Bucket=source_bucket, Key=key)
        except ClientError as error:
            if error.response["Error"]["Code"] in {"404", "NoSuchKey", "NotFound"}:
                # A key the database names but R2 no longer holds — reported, not
                # fatal, so one lost upload does not stop the rest.
                print(f"  MISSING in R2: {key}")
                tally.missing += 1
                continue
            raise
        if dry_run:
            print(f"  would copy: {key}")
            tally.copied += 1
            continue
        extra = {"ContentType": obj["ContentType"]} if obj.get("ContentType") else {}
        target.put_object(Bucket=target_bucket, Key=key, Body=obj["Body"].read(), **extra)
        print(f"  copied: {key}")
        tally.copied += 1
    return tally


def _require_database_url() -> str:
    url = os.getenv("DATABASE_URL")
    if not url:
        raise SystemExit("Set DATABASE_URL to read the referenced media keys.")
    return url


def main() -> None:
    parser = argparse.ArgumentParser(description="Copy R2 media into the S3 media bucket.")
    parser.add_argument(
        "--dry-run", action="store_true", help="List what would be copied, copy nothing."
    )
    parser.add_argument(
        "--overwrite", action="store_true", help="Copy even if the object is already in S3."
    )
    args = parser.parse_args()
    keys = asyncio.run(_referenced_keys())
    print(f"{len(keys)} media keys referenced by the database")
    tally = _copy_objects(keys, args.dry_run, args.overwrite)
    print(
        f"done: copied={tally.copied} skipped(present)={tally.skipped} "
        f"missing(in R2)={tally.missing}"
    )
    if tally.missing:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
