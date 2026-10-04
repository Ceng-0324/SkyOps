from app.core.models import DataSourceType, IncidentEvent, MissionPlan, RiskLevel
from app.core.orchestration import build_mission_review, build_replan_decision, review_mission
from app.data.scenarios import load_mission_scenario


def make_incident_event(event_type: str, observed_value: str, threshold: str) -> IncidentEvent:
    return IncidentEvent(
        id=f"incident-{event_type}",
        mission_id="mission-shenzhen-nanshan-highrise-demo",
        event_type=event_type,
        observed_value=observed_value,
        threshold=threshold,
        severity=RiskLevel.HIGH,
        source_type=DataSourceType.MOCK,
        description=f"mock {event_type} incident",
    )


def load_demo_plan() -> MissionPlan:
    scenario = load_mission_scenario("shenzhen_nanshan_highrise_demo")
    return MissionPlan.model_validate(scenario["mission_plan"])


def test_review_mission_returns_baseline_mock_review_without_incidents() -> None:
    review = review_mission(
        scenario_id="shenzhen_nanshan_highrise_demo",
        incident_events=[],
    )

    assert review.mission_id == "mission-shenzhen-nanshan-highrise-demo"
    assert review.completion_rate == 82
    assert review.data_quality_score == 90
    assert review.risk_trigger_log == ["No incident was injected in this mock mission review."]
    assert "planned uncovered facade zones outside initial mock coverage" in review.uncovered_areas
    assert any("mock or simulated data" in item for item in review.human_review_checklist)


def test_review_mission_records_incidents_makeup_plan_and_optimizations() -> None:
    review = review_mission(
        scenario_id="shenzhen_nanshan_highrise_demo",
        incident_events=[
            make_incident_event("wind_speed_spike", "9.4 m/s", "8.0 m/s"),
            make_incident_event("gps_confidence_drop", "0.41", "0.65"),
        ],
    )

    assert review.completion_rate == 58
    assert review.data_quality_score == 74
    assert len(review.risk_trigger_log) == 2
    assert any("decision=pause_and_return_to_standby" in item for item in review.risk_trigger_log)
    assert "south facade lower segment" in review.uncovered_areas
    assert "south facade upper segment" in review.uncovered_areas
    assert any("Schedule makeup flight" in item for item in review.makeup_flight_plan)
    assert any("human takeover requirement" in item for item in review.human_review_checklist)
    assert any("calmer wind window" in item for item in review.next_mission_optimizations)
    assert any("GPS-shadowed" in item for item in review.next_mission_optimizations)


def test_build_mission_review_uses_replan_decisions_as_review_evidence() -> None:
    mission_plan = load_demo_plan()
    incident_event = make_incident_event("battery_low", "34%", "35%")
    decision = build_replan_decision(
        incident_event=incident_event,
        mission_plan=mission_plan,
    )

    review = build_mission_review(
        mission_plan=mission_plan,
        incident_events=[incident_event],
        replan_decisions=[decision],
    )

    assert review.completion_rate == 70
    assert any(
        "decision=return_to_home_and_split_makeup_flight" in item
        for item in review.risk_trigger_log
    )
    assert any("larger return battery margin" in item for item in review.next_mission_optimizations)
