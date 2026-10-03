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


def test_scoring_budget_failure_discards_already_computed_path(
    candidate_request: CandidatePlanningRequest, monkeypatch: pytest.MonkeyPatch
) -> None:
    # 无障碍时路径可在预算内算完，但评分也必须使用同一预算。
    candidate_request.raw_user_input = "检查对象[A]；完成条件：取得影像"
    candidate_request.priority_task_ids = []
    candidate_request.completed_task_ids = []
    budgets: list[SearchBudget] = []

    def path_only_budget() -> SearchBudget:
        budget = SearchBudget(10)  # 三段路线检查 10 次；没有剩余评分预算。
        budgets.append(budget)
        return budget

    monkeypatch.setattr(generator, "SearchBudget", path_only_budget)
    plans = generate_candidate_plans(
        parse_task_input(candidate_request.raw_user_input), candidate_request
    )
    assert all(budget.remaining == 0 for budget in budgets)
    assert all(
        plan.status == "budget_exceeded" and plan.path is None and plan.score is None
        for plan in plans
    )


@pytest.mark.parametrize("task_count,samples,match", [(33, 1, "32 tasks"), (17, 16, "256 samples")])
def test_expanded_task_workload_is_bounded(
    candidate_request: CandidatePlanningRequest, task_count: int, samples: int, match: str
) -> None:
    node = json.loads(candidate_request.raw_user_input)["nodes"][0]
    candidate_request.raw_user_input = json.dumps(
        {"nodes": [node | {"id": f"task-{i}"} for i in range(task_count)]}
    )
    candidate_request.scene.targets[0].observation_points = [
        (2, 1 + i / 10, 1) for i in range(samples)
    ]
    candidate_request.priority_task_ids = []
    candidate_request.completed_task_ids = []
    with pytest.raises(CandidateInputError, match=match):
        generate_candidate_plans(
            parse_task_input(candidate_request.raw_user_input), candidate_request
        )


def test_object_set_expands_all_references(candidate_request: CandidatePlanningRequest) -> None:
    node = json.loads(candidate_request.raw_user_input)["nodes"][0]
    node["target"] = {"kind": "object_set", "label": "建筑集合", "refs": ["A", "B"]}
    candidate_request.raw_user_input = json.dumps({"nodes": [node]})
    candidate_request.priority_task_ids = []
    candidate_request.completed_task_ids = []
    plans = generate_candidate_plans(
        parse_task_input(candidate_request.raw_user_input), candidate_request
    )
    for plan in plans:
        assert plan.status == "feasible"
        assert {(visit.target_ref, visit.sample_index) for visit in plan.visits} == {
            (ref, index) for ref in ["A", "B"] for index in range(2)
        }


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
