from fastapi import FastAPI

from app.api.routes.health import router as health_router
from app.api.routes.mission import router as mission_router
from app.api.routes.point_cloud import router as point_cloud_router
from app.core.config import get_settings


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title=settings.service_name,
        version=settings.api_version,
        description="Task autonomy and risk simulation API for low-altitude operations.",
    )
    app.include_router(health_router)
    app.include_router(mission_router)
    app.include_router(point_cloud_router)
    return app


app = create_app()
