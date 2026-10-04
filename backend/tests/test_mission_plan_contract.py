from fastapi.testclient import TestClient

from app.main import app


def test_create_mission_plan_returns_mock_contract() -> None:
    client = TestClient(app)

    response = client.post(
        "/missions/plan",
        json={
            "raw_user_input": "明天上午巡检南山区一栋180米高办公楼外立面，尽量减少对行人的影响。",
            "scenario_id": "shenzhen_nanshan_highrise_demo",
        },
    )

    assert response.status_code == 200
    payload = response.json()

    assert payload["mission_task"]["source_type"] == "mock"
    assert payload["environment_state"]["source_type"] == "mock"
    assert payload["airspace_constraint"]["source_type"] == "mock"
    assert payload["drone_state"]["source_type"] == "mock"
    assert payload["mission_task"]["scenario_type"] == "building_facade_inspection"
    assert payload["mission_plan"]["expected_coverage_percent"] == 82
    assert payload["mission_plan"]["safety_thresholds"]["min_battery_percent"] == 35
    assert len(payload["risks"]) >= 2
    assert any(risk["requires_human_confirmation"] for risk in payload["risks"])
    assert "Hard constraint evaluation passed: true." in payload["human_explanation"]["facts"]
    assert "Wind speed is below threshold." in payload["human_explanation"]["inferences"]
    assert "Airspace approval" in payload["human_explanation"]["human_confirmation_required"]


def test_create_mission_plan_rejects_empty_task() -> None:
    client = TestClient(app)

    response = client.post(
        "/missions/plan",
        json={
            "raw_user_input": "",
            "scenario_id": "shenzhen_nanshan_highrise_demo",
        },
    )

    assert response.status_code == 422


def test_create_mission_plan_returns_404_for_unknown_scenario() -> None:
    client = TestClient(app)

    response = client.post(
        "/missions/plan",
        json={
            "raw_user_input": "明天上午巡检南山区一栋180米高办公楼外立面。",
            "scenario_id": "unknown_scenario",
        },
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Mission scenario not found: unknown_scenario"


def test_create_replan_decision_returns_mock_contract() -> None:
    client = TestClient(app)

    response = client.post(
        "/missions/replan",
        json={
            "scenario_id": "shenzhen_nanshan_highrise_demo",
            "incident_event": {
                "id": "incident-wind-001",
                "mission_id": "mission-shenzhen-nanshan-highrise-demo",
                "event_type": "wind_speed_spike",
                "observed_value": "9.4 m/s",
                "threshold": "8.0 m/s",
                "severity": "high",
                "source_type": "mock",
                "description": "Simulated sudden wind increase near the upper facade.",
            },
        },
    )

    assert response.status_code == 200
    payload = response.json()
    decision = payload["replan_decision"]

    assert decision["incident_id"] == "incident-wind-001"
    assert decision["decision"] == "pause_and_return_to_standby"
    assert decision["makeup_flight_required"] is True
    assert decision["human_takeover_required"] is True
    assert "preserve collected imagery and telemetry" in decision["actions"]
    assert all(
        alternative.startswith("rejected:") for alternative in decision["alternatives_considered"]
    )


def test_create_replan_decision_returns_404_for_unknown_scenario() -> None:
    client = TestClient(app)

    response = client.post(
        "/missions/replan",
        json={
            "scenario_id": "unknown_scenario",
            "incident_event": {
                "id": "incident-wind-001",
                "mission_id": "mission-shenzhen-nanshan-highrise-demo",
                "event_type": "wind_speed_spike",
                "observed_value": "9.4 m/s",
                "threshold": "8.0 m/s",
                "severity": "high",
                "source_type": "mock",
                "description": "Simulated sudden wind increase near the upper facade.",
            },
        },
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Mission scenario not found: unknown_scenario"


def test_create_mission_review_returns_mock_contract() -> None:
    client = TestClient(app)

    response = client.post(
        "/missions/review",
        json={
            "scenario_id": "shenzhen_nanshan_highrise_demo",
            "incident_events": [
                {
                    "id": "incident-gps-001",
                    "mission_id": "mission-shenzhen-nanshan-highrise-demo",
                    "event_type": "gps_confidence_drop",
                    "observed_value": "0.41",
                    "threshold": "0.65",
                    "severity": "high",
                    "source_type": "mock",
                    "description": "Simulated GPS confidence drop near the facade.",
                }
            ],
        },
    )

    assert response.status_code == 200
    payload = response.json()
    review = payload["mission_review"]

    assert review["mission_id"] == "mission-shenzhen-nanshan-highrise-demo"
    assert review["completion_rate"] == 70
    assert review["data_quality_score"] == 82
    assert any("gps_confidence_drop" in item for item in review["risk_trigger_log"])
    assert "south facade lower segment" in review["uncovered_areas"]
    assert any("Schedule makeup flight" in item for item in review["makeup_flight_plan"])
    assert any("human takeover requirement" in item for item in review["human_review_checklist"])


def test_create_mission_review_returns_404_for_unknown_scenario() -> None:
    client = TestClient(app)

    response = client.post(
        "/missions/review",
        json={
            "scenario_id": "unknown_scenario",
            "incident_events": [],
        },
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Mission scenario not found: unknown_scenario"
