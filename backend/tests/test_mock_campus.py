"""验证配套演示数据、影像转换和真实 F02 检测保持一致。"""

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.data.point_clouds.generate_mock_campus import SCENE_PATH, generate_pcd


def test_mock_campus_detection(
    point_cloud_client: TestClient, point_cloud_settings: Settings
) -> None:
    """合成 PCD 可复现，检测包围盒能反算回共享清单的影像范围。"""
    scene = json.loads(SCENE_PATH.read_text())
    shipped = SCENE_PATH.with_suffix(".pcd").read_text()
    assert shipped == generate_pcd()
    (Path(point_cloud_settings.point_cloud_data_dir) / scene["point_cloud_file"]).write_text(
        shipped
    )
    response = point_cloud_client.post(
        "/point-cloud/detect-obstacles",
        json={
            key: scene[key]
            for key in ("point_cloud_file", "height_threshold", "cluster_tolerance", "min_points")
        },
    )
    assert response.status_code == 200
    result = response.json()["result"]
    assert result["source"] == "mock"
    assert len(result["obstacles"]) == len(scene["obstacles"]) == 3
    scale = scene["metres_per_pixel"]
    ox, oy = scene["image_origin_px"]
    for actual, expected in zip(result["obstacles"], scene["obstacles"], strict=True):
        x, y, z = actual["position"]
        width, depth, height = actual["size"]
        pixels = [
            (x - width / 2) / scale + ox,
            oy - (y + depth / 2) / scale,
            (x + width / 2) / scale + ox,
            oy - (y - depth / 2) / scale,
        ]
        assert pixels == pytest.approx(expected["image_bounds_px"], abs=1e-4)
        assert height == pytest.approx(expected["height_m"])
        assert z - height / 2 == pytest.approx(expected["base_m"])
        assert actual["obstacle_type"] == "unknown"
