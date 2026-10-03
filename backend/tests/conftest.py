"""PCD 和 HTTP 测试使用相同的合成数据及受控目录。"""

import json
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings, get_settings
from app.core.models.candidate_planning import CandidatePlanningRequest
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


@pytest.fixture
def candidate_request() -> CandidatePlanningRequest:
    """F03 共用合成场景：三个任务、五个观察点、一个依赖和一个已完成声明。"""
    nodes = [
        {
            "id": key,
            "action": "inspect",
            "completion_conditions": ["取得影像"],
            "target": {"kind": "object", "label": key, "refs": [key.upper()]},
            "depends_on": ["a"] if key == "c" else [],
        }
        for key in ("a", "b", "c")
    ]
    return CandidatePlanningRequest.model_validate(
        {
            "raw_user_input": json.dumps({"nodes": nodes}),
            "priority_task_ids": ["b"],
            "completed_task_ids": ["a"],
            "scene": {
                "coordinate_frame": "local_cartesian_m",
                "source": "mock",
                "altitude_origin_m": 0,
                "bounds": {"minimum": [0, 0, 0], "maximum": [10, 10, 4]},
                "start": [1, 1, 1],
                "clearance_m": 0.2,
                "cruise_speed_mps": 2,
                "targets": [
                    {"ref": "A", "observation_points": [[2, 1, 1], [2, 2, 1]]},
                    {"ref": "B", "observation_points": [[8, 1, 1], [8, 2, 1]]},
                    {"ref": "C", "observation_points": [[4, 5, 1]]},
                ],
                "obstacle_detection": {
                    "source": "mock",
                    "obstacles": [],
                    "detection_time": "2026-10-03T00:00:00Z",
                    "algorithm": "synthetic_mock",
                },
            },
        }
    )
