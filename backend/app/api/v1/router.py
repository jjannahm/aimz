from fastapi import APIRouter

from app.api.v1.routes import (
    admin,
    announcements,
    assignments,
    auth,
    calendar,
    domain,
    health,
    knockout,
    match_ops,
    media,
    results,
    roster,
    training,
    users,
)

api_router = APIRouter()
api_router.include_router(health.router, prefix="/health", tags=["system"])
api_router.include_router(auth.router, prefix="/auth", tags=["authentication"])
api_router.include_router(users.router, prefix="/users", tags=["account"])
api_router.include_router(admin.router, prefix="/admin", tags=["administration"])
api_router.include_router(domain.router, tags=["sports data"])
api_router.include_router(announcements.router, tags=["announcements"])
api_router.include_router(roster.router, tags=["roster"])
api_router.include_router(training.router, tags=["training"])
api_router.include_router(assignments.router, tags=["assignments"])
api_router.include_router(calendar.router, tags=["calendar"])
api_router.include_router(knockout.router, tags=["knockout"])
api_router.include_router(match_ops.router, prefix="/matches", tags=["match operations"])
api_router.include_router(results.router, tags=["results"])
api_router.include_router(media.router, prefix="/media", tags=["media"])
