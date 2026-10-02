"""PCD 和 HTTP 测试使用相同的合成数据及受控目录。"""

from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings, get_settings
from app.main import app


@pytest.fixture
def pcd_file(tmp_path: Path) -> Path:
    """复制明确标注 mock 的真实 ASCII PCD 格式样本。"""
    example = Path(__file__).resolve().parents[1] / "app/data/point_clouds/demo.pcd"
    path = tmp_path / "scene.pcd"
    path.write_bytes(example.read_bytes())
    return path


@pytest.fixture
def point_cloud_settings(tmp_path: Path) -> Settings:
    """将 API 文件权限范围限制到每个测试独立的临时目录。"""
    return Settings(point_cloud_data_dir=tmp_path)


@pytest.fixture
def point_cloud_client(point_cloud_settings: Settings) -> Iterator[TestClient]:
    """注入测试配置，结束后恢复应用依赖。"""

    def settings_override() -> Settings:
        return point_cloud_settings

    app.dependency_overrides[get_settings] = settings_override
    try:
        with TestClient(app) as client:
            yield client
    finally:
        del app.dependency_overrides[get_settings]
