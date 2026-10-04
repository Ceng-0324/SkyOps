from app.core.models import DataSourceType, IncidentEvent, MissionPlan, RiskLevel
from app.core.orchestration import build_replan_decision, replan_mission
from app.data.scenarios import load_mission_scenario


def make_incident_event(
    *,
    event_type: str,
    severity: RiskLevel = RiskLevel.HIGH,
) -> IncidentEvent:
    return IncidentEvent(
        id=f"incident-{event_type}",
        mission_id="mission-shenzhen-nanshan-highrise-demo",
        event_type=event_type,
        observed_value="mock observed value",
        threshold="mock threshold",
        severity=severity,
        source_type=DataSourceType.MOCK,
        description=f"mock {event_type} incident",
    )


def load_demo_plan() -> MissionPlan:
    scenario = load_mission_scenario("shenzhen_nanshan_highrise_demo")
    return MissionPlan.model_validate(scenario["mission_plan"])


def test_replan_mission_returns_conservative_decision_for_wind_spike() -> None:
    decision = replan_mission(
        scenario_id="shenzhen_nanshan_highrise_demo",
        incident_event=make_incident_event(event_type="wind_speed_spike"),
    )

    assert decision.decision == "pause_and_return_to_standby"
    assert decision.makeup_flight_required is True
    assert decision.human_takeover_required is True
    assert "preserve collected imagery and telemetry" in decision.actions
    assert all(
        alternative.startswith("rejected:") for alternative in decision.alternatives_considered
    )


def test_replanner_switches_route_for_gps_confidence_drop() -> None:
    decision = build_replan_decision(
        incident_event=make_incident_event(event_type="gps_confidence_drop"),
        mission_plan=load_demo_plan(),
    )

    assert decision.decision == "switch_to_conservative_standoff_route"
    assert "increase standoff distance" in decision.actions
    assert decision.makeup_flight_required is True
    assert decision.human_takeover_required is True


def test_replanner_aborts_for_temporary_airspace_restriction() -> None:
    decision = build_replan_decision(
        incident_event=make_incident_event(event_type="temporary_airspace_restriction"),
        mission_plan=load_demo_plan(),
    )

    assert decision.decision == "abort_and_request_compliance_review"
    assert "request compliance review before makeup flight" in decision.actions
    assert decision.human_takeover_required is True


def test_replanner_uses_safe_default_for_unknown_incident_type() -> None:
    decision = build_replan_decision(
        incident_event=make_incident_event(event_type="unknown_signal_loss"),
        mission_plan=load_demo_plan(),
    )

    assert decision.decision == "pause_for_manual_review"
    assert decision.makeup_flight_required is True
    assert decision.human_takeover_required is True
    assert "request human review of unknown incident" in decision.actions
