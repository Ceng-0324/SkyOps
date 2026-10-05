"""F04 API 的前后对比、来源边界及无效事件隔离。"""

from copy import deepcopy

import pytest
from fastapi.testclient import TestClient

from app.core.models.risk_simulation import RiskSimulationRequest, TaskAddedEvent
from app.main import app

ENDPOINT = "/missions/simulate-risk"


def test_f03_request_can_feed_risk_api_without_client_generated_path(
    simulation_request: RiskSimulationRequest,
) -> None:
    with TestClient(app) as client:
        original = client.post(
            "/missions/plan-candidates",
            json=simulation_request.planning_request.model_dump(mode="json"),
        )
        response = client.post(ENDPOINT, json=simulation_request.model_dump(mode="json"))
    assert original.status_code == response.status_code == 200
    result = response.json()
    assert result["baseline"] == original.json()
    assert result["event"]["source"] == "simulated"
    assert result["event"]["timestamp"] == "2026-10-05T12:00:00Z"
    assert result["source"] == "simulated" and result["execution_authorized"] is False
    assert result["requires_human_confirmation"] is True
    assert result["alternatives"][0]["projected_plan"] == original.json()["candidates"][0]
    assert all(item["execution_authorized"] is False for item in result["alternatives"])


def test_api_new_task_returns_geometry_and_dependency_effects(
    simulation_request: RiskSimulationRequest,
    task_added_event: TaskAddedEvent,
) -> None:
    simulation_request.planning_request.completed_task_ids = []
    simulation_request.event = task_added_event
    with TestClient(app) as client:
        response = client.post(ENDPOINT, json=simulation_request.model_dump(mode="json"))
    assert response.status_code == 200
    result = response.json()
    assert result["recommended_response"] == "replan"
    assert result["impact"]["dependent_task_ids"] == ["a", "c"]
    assert result["projected"]["scene"]["targets"][-1] == {
        "ref": "D",
        "observation_points": [[6.0, 6.0, 1.0]],
    }
    assert result["alternatives"][2]["duration_delta_seconds"] is not None


@pytest.mark.parametrize(
    "changes",
    [
        {"source": "real"},
        {"timestamp": "2026-10-05T12:00:00"},
        {"timestamp": "not-a-date"},
        {"type": "unrecognized_event"},
        {"wind_speed_mps": -1},
        {"wind_speed_mps": "NaN"},
        {"wind_speed_mps": "Infinity"},
        {"wind_speed_mps": "-Infinity"},
        {"threshold": 100},
        {"execution_authorized": True},
        {"id": "../event"},
        {"id": "x" * 65},
    ],
)
def test_invalid_event_is_422(simulation_request: RiskSimulationRequest, changes: dict) -> None:
    payload = simulation_request.model_dump(mode="json")
    payload["event"].update(changes)
    with TestClient(app) as client:
        response = client.post(ENDPOINT, json=payload)
    assert response.status_code == 422


@pytest.mark.parametrize("field", ["source", "timestamp", "wind_speed_mps"])
def test_event_fields_cannot_be_silently_defaulted(
    simulation_request: RiskSimulationRequest,
    field: str,
) -> None:
    payload = simulation_request.model_dump(mode="json")
    del payload["event"][field]
    with TestClient(app) as client:
        response = client.post(ENDPOINT, json=payload)
    assert response.status_code == 422


@pytest.mark.parametrize("wind,status", [(None, "needs_clarification"), (8, "simulated")])
def test_http_success_does_not_imply_continue_is_allowed(
    simulation_request: RiskSimulationRequest,
    wind: float | None,
    status: str,
) -> None:
    payload = simulation_request.model_dump(mode="json")
    payload["event"]["wind_speed_mps"] = wind
    with TestClient(app) as client:
        response = client.post(ENDPOINT, json=payload)
    assert response.status_code == 200
    result = response.json()
    assert result["status"] == status and result["recommended_response"] == "pause_for_review"
    assert result["alternatives"][0]["projected_plan"] is None


@pytest.mark.parametrize("scenario,status", [("missing", 404), ("../private", 422)])
def test_scenario_errors_are_mapped(
    simulation_request: RiskSimulationRequest,
    scenario: str,
    status: int,
) -> None:
    payload = simulation_request.model_dump(mode="json")
    payload["planning_request"]["scenario_id"] = scenario
    with TestClient(app) as client:
        response = client.post(ENDPOINT, json=payload)
    assert response.status_code == status


@pytest.mark.parametrize("raw", [" ", "{invalid", '{"nodes":[]}'])
def test_invalid_baseline_dsl_returns_422(
    simulation_request: RiskSimulationRequest,
    raw: str,
) -> None:
    payload = simulation_request.model_dump(mode="json")
    payload["planning_request"]["raw_user_input"] = raw
    with TestClient(app) as client:
        response = client.post(ENDPOINT, json=payload)
    assert response.status_code == 422


@pytest.mark.parametrize(
    "change",
    [
        "cycle",
        "duplicate",
        "outside",
        "oversized",
        "unknown_parent",
        "duplicate_before",
        "completed",
    ],
)
def test_invalid_task_event_returns_422_and_does_not_pollute_next_request(
    simulation_request: RiskSimulationRequest,
    task_added_event: TaskAddedEvent,
    change: str,
) -> None:
    simulation_request.event = task_added_event
    simulation_request.planning_request.completed_task_ids = []
    original = simulation_request.model_dump(mode="json")
    payload = deepcopy(original)
    event = payload["event"]
    if change == "cycle":
        event["task"]["depends_on"] = ["c"]
    elif change == "duplicate":
        event["task"]["id"] = "a"
    elif change == "outside":
        event["geometry"][0]["observation_points"] = [[100, 100, 1]]
    elif change == "oversized":
        event["geometry"][0]["observation_points"] = [[6, 6, 1]] * 17
    elif change == "unknown_parent":
        event["task"]["parent_id"] = "missing"
    elif change == "duplicate_before":
        event["before_task_ids"] = ["a", "a"]
    else:
        payload["planning_request"]["completed_task_ids"] = ["a"]
    with TestClient(app) as client:
        invalid = client.post(ENDPOINT, json=payload)
        valid = client.post(ENDPOINT, json=original)
    assert invalid.status_code == 422
    assert valid.status_code == 200 and valid.json()["recommended_response"] == "replan"


def test_openapi_discriminates_event_variants_and_retains_reference_endpoints() -> None:
    with TestClient(app) as client:
        schema = client.get("/openapi.json").json()
        reference = client.post("/missions/review", json={"incident_events": []})
    assert ENDPOINT in schema["paths"]
    assert "/missions/plan-candidates" in schema["paths"] and "/missions/replan" in schema["paths"]
    event = schema["components"]["schemas"]["RiskSimulationRequest"]["properties"]["event"]
    assert event["discriminator"]["propertyName"] == "type"
    assert set(event["discriminator"]["mapping"]) == {"wind_change", "task_added"}
    assert reference.status_code == 200 and "mission_review" in reference.json()
