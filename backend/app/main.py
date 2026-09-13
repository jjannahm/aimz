from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.api.v1.router import api_router
from app.core.config import settings
from app.db.session import engine

# Room for every JSON body the app sends. Images go straight to S3 on a
# presigned POST, so nothing large ever needs to pass through the API.
MAX_BODY_BYTES = 1_048_576

# Every response the API gives is JSON or a calendar file, never a page: nothing
# here should run script, be framed, be sniffed into another type, or send a
# referrer. HSTS is ignored by browsers over plain HTTP, so it is always safe to
# send, and behind CloudFront every browser request is HTTPS.
SECURITY_HEADERS = {
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
    "Cross-Origin-Resource-Policy": "same-origin",
}
API_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"


class SecurityMiddleware:
    """Security headers on every response, and a ceiling on request bodies.

    Written against ASGI directly rather than as ``@app.middleware("http")`` so
    the body can be counted as it streams: a request with no Content-Length, or
    one that lies about it, is still cut off at the ceiling rather than read
    into memory whole.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        # The interactive docs load their own script and styles, and exist only
        # outside production; everything else is locked down.
        path: str = scope.get("path", "")
        docs = path.startswith(("/docs", "/openapi.json"))

        declared = dict(scope.get("headers") or []).get(b"content-length")
        if declared is not None and declared.isdigit() and int(declared) > MAX_BODY_BYTES:
            await self._too_large(scope, receive, send)
            return

        received = 0
        started = False

        async def limited_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > MAX_BODY_BYTES:
                    raise _BodyTooLarge
            return message

        async def secured_send(message: Message) -> None:
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
                headers = list(message.get("headers", []))
                present = {name.lower() for name, _ in headers}
                extra = dict(SECURITY_HEADERS)
                if not docs:
                    extra["Content-Security-Policy"] = API_CSP
                for name, value in extra.items():
                    if name.lower().encode() not in present:
                        headers.append((name.encode(), value.encode()))
                message = {**message, "headers": headers}
            await send(message)

        try:
            await self.app(scope, limited_receive, secured_send)
        except _BodyTooLarge:
            if not started:
                await self._too_large(scope, receive, send)

    async def _too_large(self, scope: Scope, receive: Receive, send: Send) -> None:
        response = JSONResponse(
            status_code=413,
            content={"detail": _BodyTooLarge().detail},
            headers={**SECURITY_HEADERS, "Content-Security-Policy": API_CSP},
        )
        await response(scope, receive, send)


class _BodyTooLarge(HTTPException):
    # An HTTPException, because FastAPI turns anything else raised while it reads
    # a body into a generic 400; this one it passes through to the 413 handler.
    def __init__(self) -> None:
        super().__init__(
            status_code=413,
            detail={"code": "payload_too_large", "message": "That request is too large."},
        )


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    yield
    await engine.dispose()


production = settings.environment == "production"
app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    docs_url=None if production else "/docs",
    redoc_url=None,
    # The schema is a map of every route and field; production has no use for
    # handing it to strangers.
    openapi_url=None if production else "/openapi.json",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[str(origin).rstrip("/") for origin in settings.backend_cors_origins],
    # Sessions travel as bearer tokens, never cookies, so no cross-origin
    # request needs credentials, and allowing them would only widen what a
    # listed origin could do.
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "If-None-Match"],
    expose_headers=["ETag", "Retry-After"],
)
app.add_middleware(SecurityMiddleware)

app.include_router(api_router, prefix=settings.api_v1_prefix)


@app.exception_handler(HTTPException)
async def http_exception_handler(_: Request, exc: HTTPException) -> JSONResponse:
    detail = exc.detail
    if not isinstance(detail, dict) or "code" not in detail:
        detail = {"code": "request_error", "message": str(detail)}
    return JSONResponse(
        status_code=exc.status_code, content={"detail": detail}, headers=exc.headers
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
    fields = [
        {"field": ".".join(str(part) for part in error["loc"][1:]), "message": error["msg"]}
        for error in exc.errors()
    ]
    return JSONResponse(
        status_code=422,
        content={
            "detail": {
                "code": "validation_error",
                "message": "Check the highlighted fields.",
                "field_errors": fields,
            }
        },
    )


@app.get("/health", tags=["system"], include_in_schema=False)
async def root_health() -> dict[str, str]:
    return {"status": "ok", "service": "aimz-api"}
