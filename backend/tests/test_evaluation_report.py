import json

from app.core.evaluation import (
    DATA_ORIGIN,
    REPORT_TYPE,
    build_evaluation_report,
    evaluation_report_to_json,
    generate_evaluation_report,
)
from app.core.models import (
    EvaluationMetricName,
    EvaluationResult,
    EvaluationScores,
    MetricScore,
)
from app.data.evaluation import load_all_evaluation_case_fixtures, load_evaluation_case_fixture

EXPECTED_REPORT_KEYS = [
    "report_type",
    "data_origin",
    "uses_real_api",
    "note",
    "case_count",
    "passed_count",
    "failed_count",
    "hard_constraint_pass_rate",
    "risk_recall_avg",
    "incident_response_avg",
    "explainability_avg",
    "case_results",
    "failed_cases",
]

EXPECTED_CASE_RESULT_KEYS = [
    "case_id",
    "case_name",
    "category",
    "passed",
    "hard_constraint_pass_rate",
    "risk_recall",
    "incident_response_score",
    "explainability_score",
    "failure_reasons",
]


def make_metric(
    metric: EvaluationMetricName,
    score: float,
    *,
    passed: bool = True,
    failure_reasons: list[str] | None = None,
) -> MetricScore:
    return MetricScore(
        metric=metric,
        score=score,
        passed=passed,
        matched_items=[metric.value] if passed else [],
        missing_items=[] if passed else [metric.value],
        failure_reasons=failure_reasons or [],
    )


def make_result(
    *,
    case_id: str,
    passed: bool,
    metric_scores: list[MetricScore],
    failure_reasons: list[str] | None = None,
) -> EvaluationResult:
    return EvaluationResult(
        case_id=case_id,
        passed=passed,
        scores=EvaluationScores(),
        metric_scores=metric_scores,
        failure_reasons=failure_reasons or [],
    )


def complete_metrics(
    *,
    hard: float,
    risk: float,
    incident: float,
    explainability: float,
    hard_passed: bool = True,
    hard_failure_reasons: list[str] | None = None,
) -> list[MetricScore]:
    return [
        make_metric(
            EvaluationMetricName.HARD_CONSTRAINT_PASS_RATE,
            hard,
            passed=hard_passed,
            failure_reasons=hard_failure_reasons,
        ),
        make_metric(EvaluationMetricName.RISK_RECALL, risk),
        make_metric(EvaluationMetricName.INCIDENT_RESPONSE_SCORE, incident),
        make_metric(EvaluationMetricName.EXPLAINABILITY_SCORE, explainability),
    ]


def test_p1_m_040_report_aggregates_passing_and_failing_case_results() -> None:
    passing_case = load_evaluation_case_fixture("eval-smoke-highrise-nominal").evaluation_case
    failing_case = load_evaluation_case_fixture(
        "eval-compliance-no-fly-zone-blocked",
    ).evaluation_case
    failure_reason = "Hard constraint violation: route entered no-fly zone."
    report = build_evaluation_report(
        results=[
            make_result(
                case_id=passing_case.case_id,
                passed=True,
                metric_scores=complete_metrics(
                    hard=1,
                    risk=1,
                    incident=1,
                    explainability=1,
                ),
            ),
            make_result(
                case_id=failing_case.case_id,
                passed=False,
                metric_scores=complete_metrics(
                    hard=0.5,
                    risk=0.25,
                    incident=0.75,
                    explainability=0.5,
                    hard_passed=False,
                    hard_failure_reasons=[failure_reason],
                ),
                failure_reasons=[failure_reason],
            ),
        ],
        cases=[passing_case, failing_case],
    )

    assert list(report.keys()) == EXPECTED_REPORT_KEYS
    assert report["report_type"] == REPORT_TYPE
    assert report["data_origin"] == DATA_ORIGIN
    assert report["uses_real_api"] is False
    assert "mock/simulated evaluation data" in report["note"]
    assert report["case_count"] == 2
    assert report["passed_count"] == 1
    assert report["failed_count"] == 1
    assert report["hard_constraint_pass_rate"] == 0.75
    assert report["risk_recall_avg"] == 0.625
    assert report["incident_response_avg"] == 0.875
    assert report["explainability_avg"] == 0.75
    assert len(report["case_results"]) == 2
    assert all(
        list(case_result.keys()) == EXPECTED_CASE_RESULT_KEYS
        for case_result in report["case_results"]
    )
    assert {case_result["case_id"] for case_result in report["case_results"]} == {
        passing_case.case_id,
        failing_case.case_id,
    }
    assert report["failed_cases"] == [
        {
            "case_id": failing_case.case_id,
            "case_name": failing_case.title,
            "category": failing_case.scenario_type,
            "failure_reasons": [failure_reason],
        }
    ]


def test_p1_m_040_report_excludes_missing_optional_metrics_from_averages() -> None:
    smoke_case = load_evaluation_case_fixture("eval-smoke-highrise-nominal").evaluation_case
    wind_case = load_evaluation_case_fixture(
        "eval-smoke-facade-wind-near-threshold",
    ).evaluation_case
    report = build_evaluation_report(
        results=[
            make_result(
                case_id=smoke_case.case_id,
                passed=True,
                metric_scores=[
                    make_metric(EvaluationMetricName.HARD_CONSTRAINT_PASS_RATE, 1),
                ],
            ),
            make_result(
                case_id=wind_case.case_id,
                passed=True,
                metric_scores=[
                    make_metric(EvaluationMetricName.HARD_CONSTRAINT_PASS_RATE, 0.8),
                    make_metric(EvaluationMetricName.RISK_RECALL, 0.4),
                ],
            ),
        ],
        cases=[smoke_case, wind_case],
    )

    case_results_by_id = {
        case_result["case_id"]: case_result for case_result in report["case_results"]
    }

    assert report["hard_constraint_pass_rate"] == 0.9
    assert report["risk_recall_avg"] == 0.4
    assert report["incident_response_avg"] == 0.0
    assert report["explainability_avg"] == 0.0
    assert case_results_by_id[smoke_case.case_id]["risk_recall"] is None
    assert case_results_by_id[smoke_case.case_id]["incident_response_score"] is None
    assert case_results_by_id[wind_case.case_id]["risk_recall"] == 0.4
    assert report["failed_cases"] == []


def test_p1_m_040_generate_report_runs_all_loaded_cases_and_serializes_json() -> None:
    fixtures = load_all_evaluation_case_fixtures()

    report = generate_evaluation_report()
    serialized_report = evaluation_report_to_json(report)

    assert list(report.keys()) == EXPECTED_REPORT_KEYS
    assert report["case_count"] == len(fixtures)
    assert report["passed_count"] + report["failed_count"] == report["case_count"]
    assert len(report["case_results"]) == len(fixtures)
    assert {fixture.evaluation_case.case_id for fixture in fixtures} == {
        case_result["case_id"] for case_result in report["case_results"]
    }
    assert report["report_type"] == "mock_simulated_evaluation"
    assert report["data_origin"] == "mock/simulated"
    assert report["uses_real_api"] is False
    assert json.loads(serialized_report) == report
