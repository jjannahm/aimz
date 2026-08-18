from fastapi import APIRouter

from app.api.v1.routes import admin, auth, domain, health, match_ops, media, results, users

api_router = APIRouter()
api_router.include_router(health.router, prefix="/health", tags=["system"])
api_router.include_router(auth.router, prefix="/auth", tags=["authentication"])
api_router.include_router(users.router, prefix="/users", tags=["account"])
api_router.include_router(admin.router, prefix="/admin", tags=["administration"])
api_router.include_router(domain.router, tags=["sports data"])
api_router.include_router(match_ops.router, prefix="/matches", tags=["match operations"])
api_router.include_router(results.router, tags=["results"])
api_router.include_router(media.router, prefix="/media", tags=["media"])
