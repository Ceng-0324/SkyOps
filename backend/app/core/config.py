from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

DEFAULT_POINT_CLOUD_MAX_BYTES = 16 * 1024 * 1024
DEFAULT_POINT_CLOUD_MAX_POINTS = 100_000


class Settings(BaseSettings):
    service_name: str = "skyops-agent"
    api_version: str = "0.1.0"
    app_mode: Literal["mock", "development", "test", "production"] = "mock"
    point_cloud_data_dir: Path = Path(__file__).resolve().parents[1] / "data" / "point_clouds"
    point_cloud_max_bytes: int = Field(default=DEFAULT_POINT_CLOUD_MAX_BYTES, gt=0)
    point_cloud_max_points: int = Field(default=DEFAULT_POINT_CLOUD_MAX_POINTS, gt=0)

    model_config = SettingsConfigDict(
        env_file=".env",
        env_prefix="SKYOPS_",
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()
