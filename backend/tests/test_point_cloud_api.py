"""真实 PCD → loader → detector → HTTP 的回归验收。"""

import os
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.core.point_cloud import detector

ENDPOINT = "/point-cloud/detect-obstacles"


@pytest.mark.parametrize("absolute", [False, True])
def test_detects_real_pcd_and_preserves_source(
    pcd_file: Path, point_cloud_client: TestClient, absolute: bool
) -> None:
    """相对/绝对根内路径都返回两个独立障碍和 mock 标记。"""
    response = point_cloud_client.post(
        ENDPOINT,
        json={
            "point_cloud_file": str(pcd_file) if absolute else pcd_file.name,
            "cluster_tolerance": 0.1,
        },
    )
    assert response.status_code == 200
    result = response.json()["result"]
    assert result["source"] == "mock"
    assert result["algorithm"] == "height_threshold_euclidean"
    assert len(result["obstacles"]) == 2
    assert [o["size"][0] for o in result["obstacles"]] == pytest.approx([0.09, 0.09], abs=1e-5)
    assert result["detection_time"].endswith("Z")


def test_valid_empty_scene_retains_provenance(
    pcd_file: Path, point_cloud_client: TestClient
) -> None:
    """合法数据低于高度阈值才返回成功空场景。"""
    response = point_cloud_client.post(
        ENDPOINT,
        json={
            "point_cloud_file": pcd_file.name,
            "height_threshold": 2,
        },
    )
    assert response.status_code == 200
    assert response.json()["result"]["obstacles"] == []
    assert response.json()["result"]["source"] == "mock"


@pytest.mark.parametrize("encoding", ["ascii", "binary", "binary_compressed"])
@pytest.mark.parametrize("value", [np.nan, np.inf, -np.inf])
def test_invalid_coordinates_never_return_empty_success(
    pcd_file: Path, point_cloud_client: TestClient, encoding: str, value: float
) -> None:
    """有效障碍点混入一个坏点时，三种 PCD 编码都显式拒绝。"""
    import open3d as o3d

    cloud = o3d.io.read_point_cloud(str(pcd_file))
    cloud.points = o3d.utility.Vector3dVector(np.vstack((np.asarray(cloud.points), [value, 0, 2])))
    assert o3d.io.write_point_cloud(
        str(pcd_file),
        cloud,
        write_ascii=encoding == "ascii",
        compressed=encoding == "binary_compressed",
    )
    response = point_cloud_client.post(ENDPOINT, json={"point_cloud_file": pcd_file.name})
    assert response.status_code == 400
    assert "result" not in response.json()


def test_missing_file(point_cloud_client: TestClient) -> None:
    """不存在返回 404。"""
    response = point_cloud_client.post(ENDPOINT, json={"point_cloud_file": "missing.pcd"})
    assert response.status_code == 404


@pytest.mark.parametrize("name", ["../outside.pcd", "/outside.pcd"])
def test_outside_path_returns_403(point_cloud_client: TestClient, name: str) -> None:
    """越界路径无需接触真实外部文件即可拒绝。"""
    assert point_cloud_client.post(ENDPOINT, json={"point_cloud_file": name}).status_code == 403


def test_external_symlink_is_rejected(
    tmp_path: Path, pcd_file: Path, point_cloud_client: TestClient, point_cloud_settings: Settings
) -> None:
    """API 也必须校验符号链接的实际位置。"""
    allowed = tmp_path / "allowed"
    allowed.mkdir()
    (allowed / "link.pcd").symlink_to(pcd_file)
    point_cloud_settings.point_cloud_data_dir = allowed
    assert (
        point_cloud_client.post(ENDPOINT, json={"point_cloud_file": "link.pcd"}).status_code == 403
    )


@pytest.mark.parametrize("limit", ["point_cloud_max_bytes", "point_cloud_max_points"])
def test_oversized_input_returns_413(
    pcd_file: Path, point_cloud_client: TestClient, point_cloud_settings: Settings, limit: str
) -> None:
    """配置的资源限制在 API 中生效。"""
    setattr(point_cloud_settings, limit, 10)
    response = point_cloud_client.post(ENDPOINT, json={"point_cloud_file": pcd_file.name})
    assert response.status_code == 413


@pytest.mark.parametrize(
    "field,value",
    [
        ("height_threshold", "NaN"),
        ("height_threshold", "Infinity"),
        ("cluster_tolerance", "NaN"),
        ("cluster_tolerance", "Infinity"),
        ("cluster_tolerance", 0),
        ("height_threshold", -1),
        ("min_points", 0),
        ("min_points", True),
        ("min_points", 1.5),
        ("point_cloud_file", ""),
    ],
)
def test_invalid_parameters_return_422(
    point_cloud_client: TestClient, field: str, value: str | int | float | bool
) -> None:
    """请求参数不能通过 NaN/Inf 或隐式类型转换绕过校验。"""
    response = point_cloud_client.post(
        ENDPOINT, json={"point_cloud_file": "scene.pcd", field: value}
    )
    assert response.status_code == 422


@pytest.mark.parametrize("kind", ["empty", "truncated", "directory", "wrong_extension"])
def test_invalid_files_return_400(
    pcd_file: Path, point_cloud_client: TestClient, kind: str
) -> None:
    """无效数据不会被统一伪装成文件不存在。"""
    if kind == "empty":
        pcd_file.write_bytes(b"")
    elif kind == "truncated":
        pcd_file.write_text(pcd_file.read_text().rsplit("\n", 2)[0] + "\n")
    elif kind == "directory":
        pcd_file = pcd_file.parent / "directory.pcd"
        pcd_file.mkdir()
    else:
        pcd_file = pcd_file.with_suffix(".ply")
        pcd_file.write_text("synthetic invalid format")
    assert (
        point_cloud_client.post(ENDPOINT, json={"point_cloud_file": pcd_file.name}).status_code
        == 400
    )


def test_fifo_is_rejected_without_a_writer(tmp_path: Path) -> None:
    """子进程有超时保护，即使回归为阻塞读取也不挂住整套测试。"""
    path = tmp_path / "blocked.pcd"
    os.mkfifo(path)
    script = """
import sys
from fastapi.testclient import TestClient
from app.core.config import Settings, get_settings
from app.main import app
app.dependency_overrides[get_settings] = lambda: Settings(point_cloud_data_dir=sys.argv[1])
response = TestClient(app).post(
    "/point-cloud/detect-obstacles", json={"point_cloud_file":"blocked.pcd"}
)
assert response.status_code == 400, response.text
"""
    subprocess.run([sys.executable, "-c", script, str(tmp_path)], check=True, timeout=10)


def test_algorithm_exception_returns_explicit_500(
    pcd_file: Path, point_cloud_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """全链路算法故障必须返回错误，不泄露内部异常细节。"""

    def unavailable(points: np.ndarray) -> None:
        raise RuntimeError("synthetic internal failure")

    monkeypatch.setattr(detector, "cKDTree", unavailable)
    response = point_cloud_client.post(ENDPOINT, json={"point_cloud_file": pcd_file.name})
    assert response.status_code == 500
    assert response.json() == {"detail": "Point cloud detection failed"}


def test_computational_budget_is_reported(
    pcd_file: Path, point_cloud_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """运算资源不足时显式失败，不返回部分检测结果。"""
    monkeypatch.setattr(detector, "MAX_NEIGHBOR_LINKS", 1)
    response = point_cloud_client.post(ENDPOINT, json={"point_cloud_file": pcd_file.name})
    assert response.status_code == 400
    assert "budget exceeded" in response.json()["detail"]
