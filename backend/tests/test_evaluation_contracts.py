import pytest
from pydantic import ValidationError

from app.core.evaluation import (
    EVALUATION_SCORING_POLICY,
    REQUIRED_METRIC_OUTPUT_FIELDS,
    EvaluationMetricContract,
    EvaluationMetricRole,
    EvaluationScoringPolicy,
    get_metric_contract,
    list_metric_contracts,
)
from app.core.models import EvaluationMetricName
from app.core.models.evaluation import EvaluationScores, MetricScore


def test_metric_contracts_cover_all_phase_3_metrics() -> None:
    contracts = list_metric_contracts()

    assert {contract.metric for contract in contracts} == set(EvaluationMetricName)
    assert [contract.priority_order for contract in contracts] == sorted(
        contract.priority_order for contract in contracts
    )


def test_metric_contracts_use_shared_scorer_output_shape() -> None:
    metric_score_fields = set(MetricScore.model_fields)

    assert set(REQUIRED_METRIC_OUTPUT_FIELDS) <= metric_score_fields
    assert all(
        contract.required_output_fields == REQUIRED_METRIC_OUTPUT_FIELDS
        for contract in list_metric_contracts()
    )


def test_evaluation_scores_exposes_one_score_per_metric() -> None:
    score_fields = set(EvaluationScores.model_fields)

    assert score_fields == {metric.value for metric in EvaluationMetricName}


def test_hard_constraint_pass_rate_is_blocking_safety_gate() -> None:
    hard_constraint_contract = get_metric_contract(EvaluationMetricName.HARD_CONSTRAINT_PASS_RATE)
    plan_efficiency_contract = get_metric_contract(EvaluationMetricName.PLAN_EFFICIENCY)

    assert hard_constraint_contract.role == EvaluationMetricRole.BLOCKING_SAFETY_GATE
    assert hard_constraint_contract.blocks_overall_pass is True
    assert hard_constraint_contract.can_be_offset_by_plan_efficiency is False
    assert hard_constraint_contract.priority_order < plan_efficiency_contract.priority_order


def test_scoring_policy_rejects_efficiency_offset_for_hard_constraint_failure() -> None:
    with pytest.raises(ValidationError, match="cannot be offset by plan efficiency"):
        EvaluationMetricContract(
            metric=EvaluationMetricName.HARD_CONSTRAINT_PASS_RATE,
            display_name="Unsafe hard constraint contract",
            description="Invalid contract used only to verify the safety gate validator.",
            scoring_focus="hard_constraints",
            priority_order=1,
            role=EvaluationMetricRole.BLOCKING_SAFETY_GATE,
            blocks_overall_pass=True,
            can_be_offset_by_plan_efficiency=True,
        )


def test_scoring_policy_disallows_llm_judge_for_phase_3_contracts() -> None:
    assert EVALUATION_SCORING_POLICY.llm_judge_allowed is False
    assert "must never compensate" in EVALUATION_SCORING_POLICY.safety_priority_statement


def test_scoring_policy_requires_unique_metric_contracts() -> None:
    hard_constraint_contract = get_metric_contract(EvaluationMetricName.HARD_CONSTRAINT_PASS_RATE)

    with pytest.raises(ValidationError, match="must be unique"):
        EvaluationScoringPolicy(
            metric_contracts=(hard_constraint_contract, hard_constraint_contract),
            hard_constraint_metric=EvaluationMetricName.HARD_CONSTRAINT_PASS_RATE,
            efficiency_metric=EvaluationMetricName.PLAN_EFFICIENCY,
            safety_priority_statement="duplicate metrics should fail",
        )
