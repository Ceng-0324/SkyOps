"""F03 HTTP、F01 任务和 F02 点云快照的完整仿真链路。"""

from copy import deepcopy
from itertools import pairwise

import pytest
from fastapi.testclient import TestClient

from app.core.models.candidate_planning import CandidatePlanningRequest
from app.core.orchestration import mission_planner
from app.core.planning.path_optimizer import (
    SearchBudget,
    obstacle_boxes,
    segment_intersects_box,
)
from app.core.strategy_composer import generator
from app.data.scenarios import load_mission_scenario
from app.main import app

ENDPOINT = "/missions/plan-candidates"


def test_three_real_candidates_with_scores_and_provenance(
    candidate_request: CandidatePlanningRequest,
) -> None:
    with TestClient(app) as client:
        response = client.post(ENDPOINT, json=candidate_request.model_dump(mode="json"))
    assert response.status_code == 200
    result = response.json()
    assert result["status"] == "candidates"
    assert len(result["candidates"]) == 3
    assert {plan["strategy"] for plan in result["candidates"]} == {
        "coverage",
        "focused_observation",
        "supplementary_capture",
    }
    for plan in result["candidates"]:
        assert plan["status"] == "feasible"
        assert plan["score"]["sample_coverage_percent"] == 100
        assert plan["score"]["estimated_duration_seconds"] > 0
        assert plan["path"]["points"][0] == plan["path"]["points"][-1] == [1, 1, 1]
        assert plan["execution_authorized"] is False
    assert result["recommended_strategy"] in {plan["strategy"] for plan in result["candidates"]}
    assert result["source"] == "simulated" and result["execution_authorized"] is False
    assert set(result["rule_sources"].values()) == {"mock"}
    assert (
        result["scene"]["obstacle_detection"]
        == candidate_request.model_dump(mode="json")["scene"]["obstacle_detection"]
    )


@pytest.mark.parametrize(
    "raw", ["检查这里", "无法理解的任务", "检查对象[A]；完成条件：取得影像并运输物资"]
)
def test_incomplete_task_never_produces_partial_paths(
    candidate_request: CandidatePlanningRequest, raw: str
) -> None:
    payload = candidate_request.model_dump(mode="json") | {"raw_user_input": raw}
    with TestClient(app) as client:
        response = client.post(ENDPOINT, json=payload)
    assert response.status_code == 200
    assert response.json()["status"] == "needs_clarification"
    assert response.json()["candidates"] == [] and response.json()["clarifications"]


@pytest.mark.parametrize(
    "change",
    ["missing_geometry", "altitude_reference", "unknown_priority", "inconsistent_completion"],
)
def test_missing_spatial_or_task_context_requires_clarification(
    candidate_request: CandidatePlanningRequest, change: str
) -> None:
    if change == "missing_geometry":
        candidate_request.scene.targets.pop()
    elif change == "altitude_reference":
        candidate_request.scene.altitude_origin_m = None
    elif change == "unknown_priority":
        candidate_request.priority_task_ids = ["missing"]
    else:
        candidate_request.completed_task_ids = ["c"]
    with TestClient(app) as client:
        response = client.post(ENDPOINT, json=candidate_request.model_dump(mode="json"))
    assert response.status_code == 200
    assert response.json()["status"] == "needs_clarification"
    assert response.json()["candidates"] == [] and response.json()["clarifications"]


@pytest.mark.parametrize(
    "raw",
    [
        " ",
        "{invalid",
        '{"nodes":[]}',
        '{"nodes":[{"id":"a","action":"inspect","depends_on":["a"]}]}',
    ],
)
def test_invalid_tasks_return_422(candidate_request: CandidatePlanningRequest, raw: str) -> None:
    with TestClient(app) as client:
        response = client.post(
            ENDPOINT, json=candidate_request.model_dump(mode="json") | {"raw_user_input": raw}
        )
    assert response.status_code == 422


def test_unknown_scenario_is_404_and_path_traversal_is_422(
    candidate_request: CandidatePlanningRequest,
) -> None:
    with TestClient(app) as client:
        for scenario_id, status in [("missing", 404), ("../private", 422)]:
            response = client.post(
                ENDPOINT,
                json=candidate_request.model_dump(mode="json") | {"scenario_id": scenario_id},
            )
            assert response.status_code == status


@pytest.mark.parametrize(
    "section,changes,reason",
    [
        ("environment_state", {"wind_speed_mps": 9}, "wind"),
        ("environment_state", {"gps_confidence": 0.1}, "GPS"),
        ("environment_state", {"crowd_level": "high"}, "Crowd"),
        ("drone_state", {"battery_percent": 10}, "Battery"),
        ("drone_state", {"video_latency_ms": 900}, "Video"),
        ("airspace_constraint", {"is_flyable": False}, "Airspace"),
        ("drone_state", {"available_for_mission": False}, "available"),
    ],
)
def test_rules_block_candidate_search(
    candidate_request: CandidatePlanningRequest,
    monkeypatch: pytest.MonkeyPatch,
    section: str,
    changes: dict,
    reason: str,
) -> None:
    scenario = deepcopy(load_mission_scenario(candidate_request.scenario_id))
    scenario[section].update(changes)
    monkeypatch.setattr(mission_planner, "load_mission_scenario", lambda _: scenario)

    def unexpected_search(*args: object) -> None:
        pytest.fail("Blocked mission reached candidate generation")

    monkeypatch.setattr(mission_planner, "generate_candidate_plans", unexpected_search)
    with TestClient(app) as client:
        response = client.post(ENDPOINT, json=candidate_request.model_dump(mode="json"))
    result = response.json()
    assert result["status"] == "blocked" and result["candidates"] == []
    assert any(reason.casefold() in line.casefold() for line in result["reasons"])


def test_altitude_limit_clips_search_space_without_mutating_request(
    candidate_request: CandidatePlanningRequest,
) -> None:
    candidate_request.scene.altitude_origin_m = 118
    before = candidate_request.model_dump_json()
    result = mission_planner.plan_mission_candidates(candidate_request)
    assert result.status == "candidates" and result.effective_bounds
    assert result.effective_bounds.maximum[2] == 2
    assert result.scene.bounds.maximum[2] == 4
    assert candidate_request.model_dump_json() == before
    assert all(
        result.effective_bounds.contains(point)
        for plan in result.candidates
        if plan.path
        for point in plan.path.points
    )
    candidate_request.scene.altitude_origin_m = 119
    at_limit = mission_planner.plan_mission_candidates(candidate_request)
    assert at_limit.status == "candidates"
    candidate_request.scene.altitude_origin_m = 119.5
    blocked = mission_planner.plan_mission_candidates(candidate_request)
    assert blocked.status == "blocked" and blocked.candidates == []
    assert "sample exceeds" in blocked.reasons[0]
    candidate_request.scene.altitude_origin_m = 120
    blocked = mission_planner.plan_mission_candidates(candidate_request)
    assert blocked.status == "blocked" and blocked.candidates == []


def test_endurance_failure_discards_scores_and_routes(
    candidate_request: CandidatePlanningRequest, monkeypatch: pytest.MonkeyPatch
) -> None:
    scenario = deepcopy(load_mission_scenario(candidate_request.scenario_id))
    scenario["drone_state"]["estimated_endurance_minutes"] = 0
    monkeypatch.setattr(mission_planner, "load_mission_scenario", lambda _: scenario)
    result = mission_planner.plan_mission_candidates(candidate_request)
    assert result.status == "no_feasible_plan"
    assert result.recommended_strategy is None
    assert all(
        plan.status == "infeasible" and plan.path is None and plan.score is None
        for plan in result.candidates
    )


def test_budget_failure_is_not_reported_as_an_empty_success(
    candidate_request: CandidatePlanningRequest, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(generator, "SearchBudget", lambda: SearchBudget(1))
    with TestClient(app) as client:
        response = client.post(ENDPOINT, json=candidate_request.model_dump(mode="json"))
    assert response.json()["status"] == "no_feasible_plan"
    assert all(plan["status"] == "budget_exceeded" for plan in response.json()["candidates"])


def test_real_f02_http_result_can_feed_candidate_planning(
    candidate_request: CandidatePlanningRequest,
) -> None:
    with TestClient(app) as client:
        detection = client.post(
            "/point-cloud/detect-obstacles",
            json={"point_cloud_file": "demo.pcd", "cluster_tolerance": 0.1},
        )
        assert detection.status_code == 200
        payload = candidate_request.model_dump(mode="json")
        scene = payload["scene"]
        scene["obstacle_detection"] = detection.json()["result"]
        scene["bounds"] = {"minimum": [-2, -3, 0], "maximum": [103, 5, 4]}
        scene["start"] = [1, 1, 2]
        scene["grid_resolution_m"] = 2
        scene["targets"] = [
            {"ref": key, "observation_points": [point]}
            for key, point in [("A", [10, 0, 2]), ("B", [101, 0, 2]), ("C", [50, 1, 2])]
        ]
        response = client.post(ENDPOINT, json=payload)
    assert response.status_code == 200
    result = response.json()
    assert result["status"] == "candidates"
    assert result["scene"]["obstacle_detection"] == scene["obstacle_detection"]
    assert len(result["scene"]["obstacle_detection"]["obstacles"]) == 2
    assert all(plan["status"] == "feasible" for plan in result["candidates"])
    parsed_scene = CandidatePlanningRequest.model_validate(payload).scene
    boxes = obstacle_boxes(parsed_scene.obstacle_detection.obstacles, parsed_scene.clearance_m)
    for plan in result["candidates"]:
        points = plan["path"]["points"]
        assert all(parsed_scene.bounds.contains(point) for point in points)
        assert all(
            not segment_intersects_box(start, end, box)
            for start, end in pairwise(points)
            for box in boxes
        )


def test_repeated_requests_are_deterministic_and_preserve_scenario(
    candidate_request: CandidatePlanningRequest,
) -> None:
    original_scenario = deepcopy(load_mission_scenario(candidate_request.scenario_id))
    payload = candidate_request.model_dump(mode="json")
    with TestClient(app) as client:
        first = client.post(ENDPOINT, json=payload)
        second = client.post(ENDPOINT, json=payload)
    assert first.status_code == second.status_code == 200
    assert first.json() == second.json()
    assert load_mission_scenario(candidate_request.scenario_id) == original_scenario


def test_openapi_exposes_new_contract_without_replacing_old_endpoint() -> None:
    with TestClient(app) as client:
        schema = client.get("/openapi.json").json()
        original = client.post(
            "/missions/plan", json={"raw_user_input": "检查对象[A]；完成条件：取得影像"}
        )
    assert ENDPOINT in schema["paths"] and "/missions/plan" in schema["paths"]
    assert original.status_code == 200
    assert original.json()["planning_basis"] == "scenario_template"
    assert "mission_plan" in original.json()
