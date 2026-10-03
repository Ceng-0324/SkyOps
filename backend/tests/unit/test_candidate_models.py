"""F03 模型使用显式 mock 点云快照与局部坐标。"""

from copy import deepcopy

import pytest
from pydantic import ValidationError

from app.core.models.candidate_planning import CandidatePlanningRequest, PlanningScene


@pytest.fixture
def scene_payload() -> dict:
    """小型有限网格的独立测试输入。"""
    return {
        "coordinate_frame": "local_cartesian_m",
        "source": "mock",
        "bounds": {"minimum": [0, 0, 0], "maximum": [10, 10, 10]},
        "start": [1, 1, 1],
        "targets": [{"ref": "A", "observation_points": [[8, 8, 8]]}],
        "obstacle_detection": {
            "source": "mock",
            "obstacles": [],
            "detection_time": "2026-10-03T00:00:00Z",
            "algorithm": "test",
        },
        "clearance_m": 0.5,
        "cruise_speed_mps": 2,
    }


def test_scene_contract_round_trips(scene_payload: dict) -> None:
    scene = PlanningScene.model_validate(scene_payload)
    assert PlanningScene.model_validate_json(scene.model_dump_json()) == scene
    assert scene.bounds.contains(scene.start)


@pytest.mark.parametrize(
    "patch",
    [
        {"start": [float("nan"), 1, 1]},
        {"start": [11, 1, 1]},
        {"cruise_speed_mps": 0},
        {"clearance_m": -1},
        {"grid_resolution_m": 0.1},
        {"bounds": {"minimum": [0, 0, 0], "maximum": [0, 10, 10]}},
        {"source": "real"},
        {"coordinate_frame": "WGS84"},
        {"targets": [{"ref": "A", "observation_points": [[1, 1, 1], [1, 1, 1]]}]},
        {"targets": [{"ref": "A", "observation_points": [[1, 1, 1]]}] * 2},
    ],
)
def test_invalid_scene_rejected(scene_payload: dict, patch: dict) -> None:
    with pytest.raises(ValidationError):
        PlanningScene.model_validate(scene_payload | patch)


def test_negative_obstacle_extent_and_duplicate_ids_rejected(scene_payload: dict) -> None:
    obstacle = {"id": "o", "position": [2, 2, 2], "size": [-1, 1, 1], "confidence": 1}
    scene_payload["obstacle_detection"]["obstacles"] = [obstacle]
    with pytest.raises(ValidationError, match="sizes"):
        PlanningScene.model_validate(scene_payload)
    obstacle["size"] = [1, 1, 1]
    scene_payload["obstacle_detection"]["obstacles"].append(deepcopy(obstacle))
    with pytest.raises(ValidationError, match="IDs"):
        PlanningScene.model_validate(scene_payload)


def test_request_rejects_unsafe_scenario_path_and_duplicate_task_ids(scene_payload: dict) -> None:
    for patch in [
        {"scenario_id": "../private"},
        {"priority_task_ids": ["a", "a"]},
        {"completed_task_ids": ["a", "a"]},
        {"raw_user_input": " "},
    ]:
        with pytest.raises(ValidationError):
            CandidatePlanningRequest.model_validate(
                {
                    "raw_user_input": "检查A",
                    "scene": scene_payload,
                    **patch,
                }
            )
