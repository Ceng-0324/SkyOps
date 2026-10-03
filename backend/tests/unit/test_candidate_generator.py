"""三策略的依赖、空间绑定、补采及失败语义。"""

import json

import pytest

from app.core.models.candidate_planning import CandidatePlanningRequest
from app.core.models.point_cloud import Obstacle
from app.core.planning.path_optimizer import SearchBudget
from app.core.strategy_composer import generator
from app.core.strategy_composer.generator import CandidateInputError, generate_candidate_plans
from app.core.task_decomposition.parser import parse_task_input


def test_three_strategies_have_real_order_differences_and_return_home(
    candidate_request: CandidatePlanningRequest,
) -> None:
    tree = parse_task_input(candidate_request.raw_user_input)
    before = candidate_request.model_dump_json()
    plans = generate_candidate_plans(tree, candidate_request)
    assert [plan.task_order for plan in plans] == [["a", "c", "b"], ["b", "a", "c"], ["c", "b"]]
    assert [len(plan.visits) for plan in plans] == [5, 5, 3]
    assert plans[2].assumed_completed_task_ids == ["a"]
    for plan in plans:
        assert plan.status == "feasible" and plan.path and plan.score
        assert plan.path.points[0] == plan.path.points[-1] == candidate_request.scene.start
        assert all(visit.position in plan.path.points for visit in plan.visits)
        assert plan.score.sample_coverage_percent == 100
        assert plan.score.proximity_risk == 0
        assert plan.score.estimated_duration_seconds == pytest.approx(
            plan.path.distance_m / 2 + len(plan.visits) * 5
        )
        assert plan.equivalent_to is None
        assert plan.execution_authorized is False
    assert candidate_request.model_dump_json() == before
    assert generate_candidate_plans(tree, candidate_request) == plans


def test_focus_never_skips_prerequisite(candidate_request: CandidatePlanningRequest) -> None:
    candidate_request.priority_task_ids = ["c"]
    plans = generate_candidate_plans(
        parse_task_input(candidate_request.raw_user_input), candidate_request
    )
    assert plans[1].task_order == ["a", "c", "b"]


@pytest.mark.parametrize(
    "change,match",
    [
        ({"priority_task_ids": ["missing"]}, "Unknown selected"),
        ({"completed_task_ids": ["c"]}, "incomplete prerequisites"),
        ({"raw_user_input": "检查这里"}, "clarification"),
    ],
)
def test_invalid_task_selections_are_explicit(
    candidate_request: CandidatePlanningRequest, change: dict, match: str
) -> None:
    updated = CandidatePlanningRequest.model_validate(candidate_request.model_dump() | change)
    with pytest.raises(CandidateInputError, match=match):
        generate_candidate_plans(parse_task_input(updated.raw_user_input), updated)


def test_missing_reference_is_not_replaced_with_mock_geometry(
    candidate_request: CandidatePlanningRequest,
) -> None:
    candidate_request.scene.targets.pop()
    with pytest.raises(CandidateInputError, match="Missing observation geometry.*c: C"):
        generate_candidate_plans(
            parse_task_input(candidate_request.raw_user_input), candidate_request
        )


def test_infeasible_does_not_retain_partial_path_or_score(
    candidate_request: CandidatePlanningRequest,
) -> None:
    candidate_request.scene.obstacle_detection.obstacles = [
        Obstacle(id="wall", position=(5, 5, 2), size=(1, 10, 4), confidence=0.1)
    ]
    plans = generate_candidate_plans(
        parse_task_input(candidate_request.raw_user_input), candidate_request
    )
    assert all(
        plan.status == "infeasible" and plan.path is None and plan.score is None for plan in plans
    )
    assert all(plan.reasons for plan in plans)


def test_geometry_budget_failure_is_distinct(
    candidate_request: CandidatePlanningRequest, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(generator, "SearchBudget", lambda: SearchBudget(1))
    plans = generate_candidate_plans(
        parse_task_input(candidate_request.raw_user_input), candidate_request
    )
    assert all(
        plan.status == "budget_exceeded" and plan.path is None and plan.score is None
        for plan in plans
    )


def test_equivalent_single_task_routes_are_not_disguised_as_alternatives(
    candidate_request: CandidatePlanningRequest,
) -> None:
    payload = json.loads(candidate_request.raw_user_input)
    payload["nodes"] = payload["nodes"][:1]
    candidate_request.raw_user_input = json.dumps(payload)
    candidate_request.priority_task_ids = []
    candidate_request.completed_task_ids = []
    plans = generate_candidate_plans(
        parse_task_input(candidate_request.raw_user_input), candidate_request
    )
    assert [plan.equivalent_to for plan in plans] == [None, "coverage", "coverage"]


def test_all_declared_complete_needs_no_supplementary_flight(
    candidate_request: CandidatePlanningRequest,
) -> None:
    candidate_request.completed_task_ids = ["a", "b", "c"]
    plans = generate_candidate_plans(
        parse_task_input(candidate_request.raw_user_input), candidate_request
    )
    assert plans[2].status == "no_remaining_tasks"
    assert plans[2].visits == [] and plans[2].path is None and plans[2].score is None
