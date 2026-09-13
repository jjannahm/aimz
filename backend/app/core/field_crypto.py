"""Encryption for the few columns that must not be readable at rest.

A child's health notes are the most sensitive thing AIMZ holds. RDS already
encrypts its disks; this covers everything above the disk — a snapshot restored
elsewhere, a dump copied to a laptop, a query typed into a console. A value
becomes ``enc:v1:`` followed by AES-256-GCM over a random nonce, bound to its
table and column so a ciphertext cannot be moved into another field and still
open.

The Cloudflare Worker reads and writes the same format
(cloudflare-api/src/field-crypto.ts): a D1 export arrives through
``scripts/import_d1.py`` already sealed, is stored as it is, and opens here with
the same ``DATA_ENCRYPTION_KEY``.
"""

from __future__ import annotations

import base64
import hashlib
import logging
import os
from functools import lru_cache
from typing import Any

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from sqlalchemy import Text
from sqlalchemy.types import TypeDecorator

from app.core.config import settings

PREFIX = "enc:v1:"
logger = logging.getLogger(__name__)


def encryption_configured() -> bool:
    return bool(settings.data_encryption_key) and len(settings.data_encryption_key or "") >= 32


def is_sealed(value: str | None) -> bool:
    return isinstance(value, str) and value.startswith(PREFIX)


@lru_cache(maxsize=4)
def _cipher(secret: str) -> AESGCM:
    return AESGCM(hashlib.sha256(f"aimz-field-encryption:v1:{secret}".encode()).digest())


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def _from_b64url(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def seal_field(column: str, value: str) -> str:
    """The value as it should be stored.

    Already-sealed values pass through, which is what lets the D1 importer copy
    the Worker's ciphertext across unchanged. Without a key the value is stored
    as given: production refuses to start without one (app/core/config.py), so
    plaintext only ever lands in development.
    """
    if not encryption_configured() or is_sealed(value):
        return value
    nonce = os.urandom(12)
    sealed = _cipher(settings.data_encryption_key or "").encrypt(
        nonce, value.encode(), column.encode()
    )
    return PREFIX + _b64url(nonce + sealed)


def open_field(column: str, value: str | None) -> str | None:
    """The value as a person should read it.

    Anything unsealed — a row from before encryption, a redaction marker — comes
    back untouched. A sealed value that will not open comes back still sealed
    rather than failing the whole screen: the reader sees an unreadable field,
    never somebody else's plaintext.
    """
    if value is None or not is_sealed(value) or not encryption_configured():
        return value
    try:
        raw = _from_b64url(value[len(PREFIX):])
        plain = _cipher(settings.data_encryption_key or "").decrypt(
            raw[:12], raw[12:], column.encode()
        )
    except (InvalidTag, ValueError):
        logger.error("sealed field did not open", extra={"column": column})
        return value
    return plain.decode()


class EncryptedText(TypeDecorator[str]):
    """A Text column sealed on the way into the database and opened on the way out."""

    impl = Text
    cache_ok = True

    def __init__(self, column: str, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.column = column

    def process_bind_param(self, value: str | None, dialect: Any) -> str | None:
        return None if value is None else seal_field(self.column, value)

    def process_result_value(self, value: str | None, dialect: Any) -> str | None:
        return open_field(self.column, value)
