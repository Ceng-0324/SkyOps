"""原生依赖缺失时的启动和服务降级回归。"""

import subprocess
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.core.point_cloud import loader
from app.main import app


def test_application_starts_without_open3d() -> None:
    """全新解释器禁止导入 Open3D 时，健康检查仍然可用。"""
    script = """
import builtins
original_import = builtins.__import__
def guarded_import(name, *args, **kwargs):
    if name.split(".")[0] == "open3d":
        raise ImportError("synthetic missing libEGL.so.1")
    return original_import(name, *args, **kwargs)
builtins.__import__ = guarded_import
from fastapi.testclient import TestClient
from app.main import app
assert TestClient(app).get("/health").status_code == 200
"""
    subprocess.run([sys.executable, "-c", script], check=True, timeout=30)


@pytest.mark.parametrize("error_type", [ImportError, OSError])
def test_missing_native_runtime_returns_503(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, error_type: type[Exception]
) -> None:
    """加载失败必须显式报告不可用，不返回成功空结果。"""
    path = tmp_path / "scene.pcd"
    path.write_text("synthetic fixture", encoding="utf-8")

    def unavailable(name: str) -> None:
        raise error_type("synthetic missing libEGL.so.1")

    monkeypatch.setattr(loader, "import_module", unavailable)
    response = TestClient(app).post(
        "/point-cloud/detect-obstacles", json={"point_cloud_file": str(path)}
    )
    assert response.status_code == 503
    assert response.json() == {"detail": "Point cloud runtime is unavailable"}
