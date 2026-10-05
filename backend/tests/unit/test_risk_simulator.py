"""F04 验证真实候选、规则边界、依赖影响与保守失败语义。"""

import json
from copy import deepcopy

import pytest

from app.core.models.candidate_planning import StrategyName
from app.core.models.point_cloud import Obstacle
from app.core.models.risk_simulation import (
    RiskSimulationRequest,
    TaskAddedEvent,
    WindChangeEvent,
)
from app.core.planning.path_optimizer import SearchBudget
from app.core.risk import simulator
from app.core.risk.simulator import RiskSimulationInputError, simulate_scenario
from app.core.rules.engine import load_safety_rule_config
from app.core.strategy_composer import generator
from app.core.task_decomposition.dependency import TaskDependencyError
from app.data.scenarios import load_mission_scenario


@pytest.mark.parametrize("strategy", ["coverage", "focused_observation", "supplementary_capture"])
def test_wind_uses_selected_candidate_not_reference_route(
    simulation_request: RiskSimulationRequest, strategy: StrategyName
) -> None:
    simulation_request.selected_strategy = strategy
    result = simulate_scenario(simulation_request)
    plan = next(plan for plan in result.baseline.candidates if plan.strategy == strategy)
    assert result.status == "simulated"
    assert result.recommended_response == "continue_original"
    assert result.rules_after and result.rules_after.passed
    assert result.impact.direct_task_ids == plan.task_order
    assert result.alternatives[0].projected_plan == plan
    assert result.alternatives[0].distance_delta_m == 0
    assert result.alternatives[0].duration_delta_seconds == 0
    assert result.alternatives[1].duration_delta_seconds is None
    assert result.alternatives[1].projected_plan is None
    assert result.execution_authorized is False and result.requires_human_confirmation is True


@pytest.mark.parametrize("offset,blocked", [(-0.001, False), (0, True), (0.001, True)])
def test_wind_threshold_is_existing_rule_and_equality_blocks(
    simulation_request: RiskSimulationRequest, offset: float, blocked: bool
) -> None:
    assert isinstance(simulation_request.event, WindChangeEvent)
    threshold = load_safety_rule_config().max_wind_speed_mps
    simulation_request.event.wind_speed_mps = threshold + offset
    result = simulate_scenario(simulation_request)
    assert result.rules_after and result.rules_after.passed is not blocked
    continuation = result.alternatives[0]
    assert continuation.status == ("blocked" if blocked else "eligible")
    if blocked:
        assert result.recommended_response == "pause_for_review"
        assert continuation.projected_plan is None
        assert continuation.duration_delta_seconds is None
        wind = next(check for check in result.rules_after.checks if not check.passed)
        assert wind.rule_id == "hard-wind-speed"
        assert f"max_wind_speed_mps={threshold}" in wind.evidence
    assert result.baseline.rule_evaluation.passed


def test_unknown_wind_does_not_fall_back_to_reference_value(
    simulation_request: RiskSimulationRequest,
) -> None:
    assert isinstance(simulation_request.event, WindChangeEvent)
    simulation_request.event.wind_speed_mps = None
    result = simulate_scenario(simulation_request)
    assert result.status == "needs_clarification" and result.rules_after is None
    assert result.recommended_response == "pause_for_review" and result.reasons
    assert all(item.status == "requires_review" for item in result.alternatives)
    assert all(item.projected_plan is None for item in result.alternatives)


def test_new_task_propagates_dependencies_and_compares_actual_routes(
    simulation_request: RiskSimulationRequest, task_added_event: TaskAddedEvent
) -> None:
    simulation_request.event = task_added_event
    simulation_request.planning_request.completed_task_ids = []
    result = simulate_scenario(simulation_request)
    assert result.status == "simulated" and result.recommended_response == "replan"
    assert result.impact.direct_task_ids == ["new"]
    assert result.impact.dependent_task_ids == ["a", "c"]
    assert "b" not in result.impact.dependent_task_ids
    replan = result.alternatives[2]
    original = result.baseline.candidates[0]
    plan = replan.projected_plan
    assert plan and plan.path and plan.score and original.path and original.score
    assert plan.task_order.index("new") < plan.task_order.index("a") < plan.task_order.index("c")
    assert result.impact.rescheduled_task_ids
    assert any(visit.position == (6, 6, 1) and visit.task_id == "new" for visit in plan.visits)
    assert replan.distance_delta_m == pytest.approx(plan.path.distance_m - original.path.distance_m)
    assert replan.duration_delta_seconds == pytest.approx(
        plan.score.estimated_duration_seconds - original.score.estimated_duration_seconds
    )
    assert result.alternatives[0].status == "blocked"
    assert result.alternatives[0].deferred_task_ids == ["new", "a", "c"]
    assert result.projected and len(result.projected.scene.targets) == 4
    assert len(result.baseline.scene.targets) == 3


def test_new_task_can_reuse_geometry_and_preserves_completed_declarations(
    simulation_request: RiskSimulationRequest, task_added_event: TaskAddedEvent
) -> None:
    assert task_added_event.task.target
    task_added_event.task.target.refs = ["A"]
    task_added_event.geometry = []
    task_added_event.before_task_ids = []
    task_added_event.task.depends_on = ["a"]
    simulation_request.event = task_added_event
    simulation_request.selected_strategy = "supplementary_capture"
    result = simulate_scenario(simulation_request)
    plan = result.alternatives[2].projected_plan
    assert plan and plan.status == "feasible"
    assert plan.assumed_completed_task_ids == ["a"] and "a" not in plan.task_order
    assert "new" in plan.task_order
    assert result.impact.dependent_task_ids == []


@pytest.mark.parametrize(
    "change",
    ["duplicate_id", "unknown_insertion", "geometry_overwrite", "unused_geometry", "completed"],
)
def test_invalid_event_cannot_silently_overwrite_original(
    simulation_request: RiskSimulationRequest, task_added_event: TaskAddedEvent, change: str
) -> None:
    simulation_request.event = task_added_event
    if change != "completed":
        simulation_request.planning_request.completed_task_ids = []
    if change == "duplicate_id":
        task_added_event.task.id = "a"
    elif change == "unknown_insertion":
        task_added_event.before_task_ids = ["absent"]
    elif change == "geometry_overwrite":
        task_added_event.geometry[0].ref = "A"
    elif change == "unused_geometry":
        task_added_event.geometry[0].ref = "unused"
    before = simulation_request.model_dump_json()
    with pytest.raises(RiskSimulationInputError):
        simulate_scenario(simulation_request)
    assert simulation_request.model_dump_json() == before


@pytest.mark.parametrize("dependency", ["c", "missing", "new"])
def test_new_dependencies_must_remain_a_valid_dag(
    simulation_request: RiskSimulationRequest, task_added_event: TaskAddedEvent, dependency: str
) -> None:
    simulation_request.planning_request.completed_task_ids = []
    task_added_event.task.depends_on = [dependency]
    simulation_request.event = task_added_event
    with pytest.raises(TaskDependencyError):
        simulate_scenario(simulation_request)


@pytest.mark.parametrize("change", ["geometry", "completion", "target"])
def test_incomplete_new_task_requires_clarification_not_reference_fallback(
    simulation_request: RiskSimulationRequest, task_added_event: TaskAddedEvent, change: str
) -> None:
    simulation_request.planning_request.completed_task_ids = []
    simulation_request.event = task_added_event
    if change == "geometry":
        task_added_event.geometry = []
    elif change == "completion":
        task_added_event.task.completion_conditions = []
    else:
        task_added_event.task.target = None
        task_added_event.geometry = []
    result = simulate_scenario(simulation_request)
    assert result.status == "needs_clarification"
    assert result.recommended_response == "pause_for_review"
    assert result.alternatives[2].status == "requires_review"
    assert result.alternatives[2].projected_plan is None
    assert result.impact.dependent_task_ids == ["a", "c"]


def test_new_target_inside_obstacle_has_no_projected_route(
    simulation_request: RiskSimulationRequest, task_added_event: TaskAddedEvent
) -> None:
    simulation_request.planning_request.completed_task_ids = []
    simulation_request.event = task_added_event
    simulation_request.planning_request.scene.obstacle_detection.obstacles = [
        Obstacle(id="box", position=(6, 6, 1), size=(1, 1, 1), confidence=0.9)
    ]
    result = simulate_scenario(simulation_request)
    assert result.status == "simulated" and result.baseline.status == "candidates"
    assert result.recommended_response == "pause_for_review"
    assert result.alternatives[2].status == "infeasible"
    assert result.alternatives[2].projected_plan is None
    assert result.alternatives[2].duration_delta_seconds is None


def test_projected_budget_failure_is_not_an_empty_success(
    simulation_request: RiskSimulationRequest,
    task_added_event: TaskAddedEvent,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    simulation_request.planning_request.completed_task_ids = []
    simulation_request.event = task_added_event
    calls = 0

    def budget() -> SearchBudget:
        nonlocal calls
        calls += 1
        return SearchBudget(1_000_000 if calls <= 3 else 1)

    monkeypatch.setattr(generator, "SearchBudget", budget)
    result = simulate_scenario(simulation_request)
    assert result.alternatives[2].status == "budget_exceeded"
    assert result.alternatives[2].projected_plan is None
    assert result.recommended_response == "pause_for_review"


@pytest.mark.parametrize("constraint", ["altitude", "endurance", "task_limit"])
def test_new_work_cannot_bypass_f03_constraints(
    simulation_request: RiskSimulationRequest,
    task_added_event: TaskAddedEvent,
    monkeypatch: pytest.MonkeyPatch,
    constraint: str,
) -> None:
    planning = simulation_request.planning_request
    planning.completed_task_ids = []
    simulation_request.event = task_added_event
    scenario = deepcopy(load_mission_scenario(planning.scenario_id))
    if constraint == "altitude":
        planning.scene.altitude_origin_m = 118
        task_added_event.geometry[0].observation_points = [(6, 6, 3)]
        expected = "blocked"
    elif constraint == "endurance":
        scenario["drone_state"]["estimated_endurance_minutes"] = 1
        task_added_event.geometry[0].observation_points = [(6 + i / 10, 6, 1) for i in range(16)]
        expected = "infeasible"
    else:
        node = json.loads(planning.raw_user_input)["nodes"][0]
        planning.raw_user_input = json.dumps({"nodes": [node | {"id": f"t{i}"} for i in range(32)]})
        planning.priority_task_ids = []
        task_added_event.before_task_ids = []
        expected = "requires_review"
    monkeypatch.setattr(simulator, "load_mission_scenario", lambda _: scenario)
    result = simulate_scenario(simulation_request)
    assert result.baseline.status == "candidates"
    assert result.recommended_response == "pause_for_review"
    assert result.alternatives[2].status == expected
    assert result.alternatives[2].projected_plan is None
    assert result.alternatives[2].distance_delta_m is None


@pytest.mark.parametrize("change", ["clarification", "no_remaining", "unavailable", "blocked"])
def test_unusable_selected_baseline_does_not_simulate_another_candidate(
    simulation_request: RiskSimulationRequest, monkeypatch: pytest.MonkeyPatch, change: str
) -> None:
    scenario = deepcopy(load_mission_scenario(simulation_request.planning_request.scenario_id))
    if change == "clarification":
        simulation_request.planning_request.raw_user_input = "检查这里"
    elif change == "no_remaining":
        simulation_request.planning_request.completed_task_ids = ["a", "b", "c"]
        simulation_request.selected_strategy = "supplementary_capture"
    elif change == "unavailable":
        scenario["drone_state"]["available_for_mission"] = False
    else:
        scenario["environment_state"]["gps_confidence"] = 0.1
    monkeypatch.setattr(simulator, "load_mission_scenario", lambda _: scenario)
    result = simulate_scenario(simulation_request)
    assert result.status == "baseline_unavailable"
    assert result.alternatives == [] and result.projected is None
    assert result.rules_after is None and result.recommended_response == "pause_for_review"


@pytest.mark.parametrize("event_type", ["wind", "task"])
def test_simulation_is_repeatable_and_preserves_request_and_cached_scenario(
    simulation_request: RiskSimulationRequest,
    task_added_event: TaskAddedEvent,
    monkeypatch: pytest.MonkeyPatch,
    event_type: str,
) -> None:
    if event_type == "task":
        simulation_request.event = task_added_event
        simulation_request.planning_request.completed_task_ids = []
    scenario = load_mission_scenario(simulation_request.planning_request.scenario_id)
    snapshot = deepcopy(scenario)
    before = simulation_request.model_dump_json()
    count = 0

    def load(_: str) -> dict:
        nonlocal count
        count += 1
        return scenario

    monkeypatch.setattr(simulator, "load_mission_scenario", load)
    first = simulate_scenario(simulation_request)
    assert count == 1
    assert first == simulate_scenario(simulation_request)
    assert scenario == snapshot and simulation_request.model_dump_json() == before
