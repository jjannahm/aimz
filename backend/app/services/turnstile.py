from __future__ import annotations

import httpx

from app.core.config import settings
from app.core.errors import api_error

VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"


async def verify_newcomer_token(token: str, remote_ip: str | None) -> None:
    if not settings.turnstile_secret:
        if settings.environment in {"staging", "production"}:
            raise api_error(
                503, "turnstile_unavailable", "Application verification is unavailable."
            )
        if token == "development-bypass":
            return
        raise api_error(422, "turnstile_failed", "Complete the security check and try again.")
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post(
                VERIFY_URL,
                data={
                    "secret": settings.turnstile_secret,
                    "response": token,
                    **({"remoteip": remote_ip} if remote_ip else {}),
                },
            )
        result = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise api_error(
            503, "turnstile_unavailable", "Application verification is unavailable."
        ) from exc
    if (
        not result.get("success")
        or result.get("action") != "newcomer_application"
        or result.get("hostname") not in settings.turnstile_hostnames
    ):
        raise api_error(422, "turnstile_failed", "Complete the security check and try again.")
