import json
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

from app.core.evaluation.runner import run_evaluation_case_fixture
from app.core.models import EvaluationCase, EvaluationMetricName, EvaluationResult
from app.data.evaluation import load_all_evaluation_case_fixtures

REPORT_TYPE = "mock_simulated_evaluation"
DATA_ORIGIN = "mock/simulated"
REPORT_NOTE = (
    "This report is based on local mock/simulated evaluation data only; it does not "
    "call real weather, map, airspace, drone, GPS, video link, crowd, or external "
    "evaluation APIs."
)


def generate_evaluation_report(case_dir: str | Path | None = None) -> dict[str, Any]:
    fixtures = sorted(
        load_all_evaluation_case_fixtures(case_dir=case_dir),
        key=lambda fixture: fixture.evaluation_case.case_id,
    )
    results = [run_evaluation_case_fixture(fixture) for fixture in fixtures]
    cases = [fixture.evaluation_case for fixture in fixtures]

    return build_evaluation_report(results=results, cases=cases)


def build_evaluation_report(
    *,
    results: Sequence[EvaluationResult],
    cases: Sequence[EvaluationCase] | Mapping[str, EvaluationCase] | None = None,
) -> dict[str, Any]:
    case_lookup = _build_case_lookup(cases)
    sorted_results = sorted(results, key=lambda result: result.case_id)
    case_results = [
        _brief_case_result(result=result, evaluation_case=case_lookup.get(result.case_id))
        for result in sorted_results
    ]
    failed_cases = [
        {
            "case_id": case_result["case_id"],
            "case_name": case_result["case_name"],
            "category": case_result["category"],
            "failure_reasons": case_result["failure_reasons"],
        }
        for case_result in case_results
        if not case_result["passed"]
    ]

    case_count = len(case_results)
    passed_count = sum(1 for case_result in case_results if case_result["passed"])

    return {
        "report_type": REPORT_TYPE,
        "data_origin": DATA_ORIGIN,
        "uses_real_api": False,
        "note": REPORT_NOTE,
        "case_count": case_count,
        "passed_count": passed_count,
        "failed_count": case_count - passed_count,
        "hard_constraint_pass_rate": _average_metric(
            case_results,
            "hard_constraint_pass_rate",
        ),
        "risk_recall_avg": _average_metric(case_results, "risk_recall"),
        "incident_response_avg": _average_metric(
            case_results,
            "incident_response_score",
        ),
        "explainability_avg": _average_metric(case_results, "explainability_score"),
        "case_results": case_results,
        "failed_cases": failed_cases,
    }


def evaluation_report_to_json(report: Mapping[str, Any]) -> str:
    return json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True)


def _brief_case_result(
    *,
    result: EvaluationResult,
    evaluation_case: EvaluationCase | None,
) -> dict[str, Any]:
    metric_scores = {metric.metric: metric.score for metric in result.metric_scores}
    failure_reasons = _failure_reasons(result) if not result.passed else []

    return {
        "case_id": result.case_id,
        "case_name": evaluation_case.title if evaluation_case else result.case_id,
        "category": evaluation_case.scenario_type if evaluation_case else "unknown",
        "passed": result.passed,
        "hard_constraint_pass_rate": metric_scores.get(
            EvaluationMetricName.HARD_CONSTRAINT_PASS_RATE,
        ),
        "risk_recall": metric_scores.get(EvaluationMetricName.RISK_RECALL),
        "incident_response_score": metric_scores.get(
            EvaluationMetricName.INCIDENT_RESPONSE_SCORE,
        ),
        "explainability_score": metric_scores.get(EvaluationMetricName.EXPLAINABILITY_SCORE),
        "failure_reasons": failure_reasons,
    }


def _failure_reasons(result: EvaluationResult) -> list[str]:
    reasons = [
        *result.failure_reasons,
        *[reason for metric in result.metric_scores for reason in metric.failure_reasons],
    ]
    deduplicated_reasons = list(dict.fromkeys(reason for reason in reasons if reason.strip()))

    if deduplicated_reasons:
        return deduplicated_reasons

    return [
        "EvaluationResult.passed is false but no case-level failure reason was provided.",
    ]


def _average_metric(case_results: Sequence[Mapping[str, Any]], metric_key: str) -> float:
    values = [
        case_result[metric_key]
        for case_result in case_results
        if case_result[metric_key] is not None
    ]
    if not values:
        return 0.0

    return round(sum(values) / len(values), 4)


def _build_case_lookup(
    cases: Sequence[EvaluationCase] | Mapping[str, EvaluationCase] | None,
) -> dict[str, EvaluationCase]:
    if cases is None:
        return {}
    if isinstance(cases, Mapping):
        return dict(cases)

    return {evaluation_case.case_id: evaluation_case for evaluation_case in cases}
