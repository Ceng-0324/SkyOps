import socket

import pytest

from app.core.evaluation import (
    DETERMINISTIC_EVALUATION_GENERATED_AT,
    build_evaluation_report,
    run_all_evaluation_cases,
    run_evaluation_case,
    score_explainability,
    score_hard_constraints,
    score_incident_response,
    score_plan_efficiency,
    score_risk_recall,
)
from app.core.models import (
    DataSourceType,
    EvaluationMetricName,
    ExpectedRisk,
    Explanation,
    ReplanDecision,
    RiskItem,
    RiskLevel,
)
from app.data.evaluation import (
    load_all_evaluation_case_fixtures,
    load_evaluation_case_fixture,
)

ALLOWED_EVALUATION_SOURCES = {DataSourceType.MOCK, DataSourceType.SIMULATED}
FORBIDDEN_DATASET_MARKERS = (
    '"source_type":"real"',
    "http://",
    "https://",
    "defect recognition accuracy",
    "visual defect detection",
    "crack detection accuracy",
    "image recognition model",
)
VAGUE_FAILURE_REASONS = {"failed", "bad result", "invalid"}


def make_risk(
    *,
    id: str,
    category: str,
    trigger_condition: str,
    risk_level: RiskLevel = RiskLevel.HIGH,
) -> RiskItem:
    return RiskItem(
        id=id,
        category=category,
        description=f"Mock regression risk for {category}.",
        severity=risk_level,
        probability=RiskLevel.MEDIUM,
        risk_level=risk_level,
        trigger_condition=trigger_condition,
        mitigation="Use conservative mock mitigation.",
        evidence=[f"source=regression-test:{id}"],
        requires_human_confirmation=risk_level in {RiskLevel.HIGH, RiskLevel.CRITICAL},
    )


def make_complete_explanation() -> Explanation:
    return Explanation(
        facts=["Mock facts include environment, airspace, drone, and incident inputs."],
        inferences=["Mock inference explains why conservative replanning is required."],
        recommended_actions=["Pause or return before continuing unsafe work."],
        human_confirmation_required=["Human review is required before resuming the mission."],
    )


def metric_score(result, metric: EvaluationMetricName) -> float:
    return next(score.score for score in result.metric_scores if score.metric == metric)


def test_regression_loader_loads_all_cases_with_schema_and_mock_sources() -> None:
    fixtures = load_all_evaluation_case_fixtures()

    assert fixtures
    assert len(fixtures) >= 30

    for fixture in fixtures:
        case = fixture.evaluation_case

        assert case.case_id
        assert case.title
        assert case.raw_user_input
        assert case.expected_hard_constraints
        assert case.source_type in ALLOWED_EVALUATION_SOURCES
        assert case.environment_state.source_type in ALLOWED_EVALUATION_SOURCES
        assert case.airspace_constraint.source_type in ALLOWED_EVALUATION_SOURCES
        assert case.drone_state.source_type in ALLOWED_EVALUATION_SOURCES
        assert fixture.baseline_mission_plan is not None

        for incident_event in case.incident_events:
            assert incident_event.source_type in ALLOWED_EVALUATION_SOURCES


def test_regression_loader_returns_deterministic_results_without_external_data() -> None:
    first_fixtures = load_all_evaluation_case_fixtures()
    second_fixtures = load_all_evaluation_case_fixtures()
    first_case_ids = [fixture.evaluation_case.case_id for fixture in first_fixtures]
    second_case_ids = [fixture.evaluation_case.case_id for fixture in second_fixtures]
    serialized_dataset = " ".join(fixture.model_dump_json().lower() for fixture in first_fixtures)

    assert first_case_ids == second_case_ids
    assert len(first_case_ids) == len(set(first_case_ids))
    assert not any(marker in serialized_dataset for marker in FORBIDDEN_DATASET_MARKERS)


def test_regression_hard_constraint_scorer_reports_no_fly_zone_violation() -> None:
    fixture = load_evaluation_case_fixture("eval-compliance-no-fly-zone-blocked")
    assert fixture.baseline_mission_plan is not None

    score, results, metric = score_hard_constraints(
        fixture.evaluation_case,
        fixture.baseline_mission_plan,
    )
    failed_by_id = {result.id: result for result in results if not result.passed}
    efficiency_score, efficiency_metric = score_plan_efficiency(
        evaluation_case=fixture.evaluation_case,
        mission_plan=fixture.baseline_mission_plan,
        hard_constraints_passed=False,
    )

    assert score < 1
    assert metric.passed is False
    assert "hard-airspace-flyable" in failed_by_id
    assert "Airspace is not flyable" in failed_by_id["hard-airspace-flyable"].reason
    assert any("hard-airspace-flyable" in reason for reason in metric.failure_reasons)
    assert efficiency_score <= 0.2
    assert efficiency_metric.passed is False
    assert any("cannot offset" in reason for reason in efficiency_metric.failure_reasons)


def test_regression_hard_constraint_scorer_reports_battery_reserve_failure() -> None:
    fixture = load_evaluation_case_fixture("eval-device-insufficient-battery")
    assert fixture.baseline_mission_plan is not None

    score, results, metric = score_hard_constraints(
        fixture.evaluation_case,
        fixture.baseline_mission_plan,
    )
    failed_by_id = {result.id: result for result in results if not result.passed}

    assert score < 1
    assert metric.passed is False
    assert "hard-battery-margin" in failed_by_id
    assert "Battery margin is below" in failed_by_id["hard-battery-margin"].reason
    battery_evidence = failed_by_id["hard-battery-margin"].evidence
    assert any("battery_percent=24" in item for item in battery_evidence)
    assert any("required_battery=35" in item for item in battery_evidence)


def test_regression_risk_recall_scorer_reports_missing_expected_risk() -> None:
    fixture = load_evaluation_case_fixture("eval-smoke-highrise-nominal")
    evaluation_case = fixture.evaluation_case.model_copy(
        update={
            "expected_risks": [
                ExpectedRisk(
                    id="gps_confidence_low",
                    category="navigation",
                    trigger_condition="gps_confidence < 0.65",
                    minimum_risk_level=RiskLevel.HIGH,
                )
            ]
        }
    )

    first_score, first_results, first_metric = score_risk_recall(evaluation_case, [])
    second_score, second_results, second_metric = score_risk_recall(evaluation_case, [])

    assert first_score == second_score == 0
    assert first_results == second_results
    assert first_metric == second_metric
    assert first_metric.passed is False
    assert first_metric.missing_items == ["gps_confidence_low"]
    assert (
        "missing expected risk navigation:gps_confidence < 0.65" in first_metric.failure_reasons[0]
    )


def test_regression_incident_response_scorer_reports_missing_return_to_home() -> None:
    fixture = load_evaluation_case_fixture("eval-incident-battery-below-rth-threshold")
    incident = fixture.evaluation_case.incident_events[0]
    incomplete_decision = ReplanDecision(
        incident_id=incident.id,
        decision="pause_only",
        actions=["pause mission"],
        affected_segments=["south perimeter active segment"],
        makeup_flight_required=False,
        human_takeover_required=False,
        reason="Mock incomplete decision for regression testing.",
        alternatives_considered=[],
    )

    score, results, metric = score_incident_response(
        fixture.evaluation_case,
        [incomplete_decision],
    )

    assert score == 0
    assert metric.passed is False
    assert results[0].passed is False
    assert "return_to_home" in results[0].reason
    assert "makeup flight plan" in results[0].reason
    assert "human takeover or human review" in results[0].reason


def test_regression_incident_response_scorer_reports_unsafe_continue_action() -> None:
    fixture = load_evaluation_case_fixture("eval-incident-wind-speed-spike")
    incident = fixture.evaluation_case.incident_events[0]
    unsafe_decision = ReplanDecision(
        incident_id=incident.id,
        decision="continue_original_route",
        actions=["continue original route", "finish the current segment before return"],
        affected_segments=["upper facade active segment"],
        makeup_flight_required=False,
        human_takeover_required=False,
        reason="Unsafe mock decision used only for regression testing.",
        alternatives_considered=[],
    )

    score, results, metric = score_incident_response(
        fixture.evaluation_case,
        [unsafe_decision],
    )

    assert score == 0
    assert metric.passed is False
    assert results[0].passed is False
    assert "unsafe_continue" in results[0].reason


def test_regression_explainability_scorer_reports_missing_reason_and_evidence() -> None:
    fixture = load_evaluation_case_fixture("eval-incident-wind-speed-spike")
    assert fixture.baseline_mission_plan is not None
    incident = fixture.evaluation_case.incident_events[0]
    unexplained_return_decision = ReplanDecision(
        incident_id=incident.id,
        decision="return_to_home",
        actions=["return to home"],
        affected_segments=["upper facade active segment"],
        makeup_flight_required=False,
        human_takeover_required=True,
        reason="",
        alternatives_considered=[],
    )

    score, results, metric = score_explainability(
        mission_plan=fixture.baseline_mission_plan,
        human_explanation=Explanation(),
        replan_decisions=[unexplained_return_decision],
    )
    failed_by_id = {result.id: result for result in results if not result.passed}

    assert score < 1
    assert metric.passed is False
    assert "explanation-facts" in failed_by_id
    assert (
        "human_explanation.facts is missing or empty." == failed_by_id["explanation-facts"].reason
    )
    assert f"explanation-return-{incident.id}" in failed_by_id
    assert "must include a reason" in failed_by_id[f"explanation-return-{incident.id}"].reason


def test_regression_runner_report_aggregates_counts_scores_and_failure_reasons() -> None:
    fixtures = load_all_evaluation_case_fixtures()
    cases = [fixture.evaluation_case for fixture in fixtures]
    results = run_all_evaluation_cases()

    report = build_evaluation_report(results=results, cases=cases)
    failed_cases_by_id = {
        failed_case["case_id"]: failed_case for failed_case in report["failed_cases"]
    }

    assert report["case_count"] == len(results)
    assert report["passed_count"] == sum(result.passed for result in results)
    assert report["failed_count"] == sum(not result.passed for result in results)
    assert report["hard_constraint_pass_rate"] == round(
        sum(
            metric_score(result, EvaluationMetricName.HARD_CONSTRAINT_PASS_RATE)
            for result in results
        )
        / len(results),
        4,
    )
    assert report["risk_recall_avg"] == round(
        sum(metric_score(result, EvaluationMetricName.RISK_RECALL) for result in results)
        / len(results),
        4,
    )
    assert report["incident_response_avg"] == round(
        sum(
            metric_score(result, EvaluationMetricName.INCIDENT_RESPONSE_SCORE) for result in results
        )
        / len(results),
        4,
    )
    assert report["explainability_avg"] == round(
        sum(metric_score(result, EvaluationMetricName.EXPLAINABILITY_SCORE) for result in results)
        / len(results),
        4,
    )
    assert "eval-compliance-no-fly-zone-blocked" in failed_cases_by_id
    assert any(
        "hard-airspace-flyable" in reason
        for reason in failed_cases_by_id["eval-compliance-no-fly-zone-blocked"]["failure_reasons"]
    )
    assert all(
        reason.lower() not in VAGUE_FAILURE_REASONS
        for failed_case in report["failed_cases"]
        for reason in failed_case["failure_reasons"]
    )


def test_regression_runner_output_is_deterministic_and_uses_fixed_timestamps() -> None:
    first_results = run_all_evaluation_cases()
    second_results = run_all_evaluation_cases()

    assert first_results == second_results
    assert all(
        result.generated_at == DETERMINISTIC_EVALUATION_GENERATED_AT for result in first_results
    )


def test_regression_runner_does_not_require_network_calls(monkeypatch: pytest.MonkeyPatch) -> None:
    def fail_on_socket(*args, **kwargs):
        raise AssertionError("Evaluation regression tests must not open network sockets.")

    monkeypatch.setattr(socket, "socket", fail_on_socket)

    result = run_evaluation_case("eval-smoke-highrise-nominal")

    assert result.case_id == "eval-smoke-highrise-nominal"
    assert result.source_type in ALLOWED_EVALUATION_SOURCES
