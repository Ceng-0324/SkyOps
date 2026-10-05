"""在 F03 局部候选上预演事件，复用规则、依赖和有界路径规划。"""

from copy import deepcopy

import networkx as nx
from pydantic import ValidationError

from app.core.models import AirspaceConstraint, DroneState, EnvironmentState
from app.core.models.candidate_planning import (
    CandidatePlan,
    CandidatePlanningRequest,
    CandidatePlanningResult,
    StrategyName,
)
from app.core.models.risk_simulation import (
    ResponseStrategy,
    RiskSimulationRequest,
    RiskSimulationResult,
    SimulationAlternative,
    TaskAddedEvent,
    TaskImpact,
    WindChangeEvent,
)
from app.core.models.task import TaskDefinition, TaskTree
from app.core.orchestration.mission_planner import build_candidate_planning_result
from app.core.rules import evaluate_hard_constraints
from app.core.task_decomposition.dependency import build_dependency_graph
from app.core.task_decomposition.parser import parse_task_input
from app.data.scenarios import load_mission_scenario


class RiskSimulationInputError(ValueError):
    """事件与原任务或场景不一致，调用者需要修正完整请求。"""


def _selected(result: CandidatePlanningResult, strategy: StrategyName) -> CandidatePlan | None:
    return next(
        (candidate for candidate in result.candidates if candidate.strategy == strategy), None
    )


def _pause(task_ids: list[str], reason: str) -> SimulationAlternative:
    return SimulationAlternative(
        strategy="pause_for_review",
        status="requires_review",
        reasons=[reason, "暂停位置、返航路径与等待时间未建模，需要人工复核。"],
        deferred_task_ids=task_ids,
    )


def _eligible(
    strategy: ResponseStrategy, plan: CandidatePlan, baseline: CandidatePlan, reason: str
) -> SimulationAlternative:
    assert plan.path is not None and plan.score is not None
    assert baseline.path is not None and baseline.score is not None
    return SimulationAlternative(
        strategy=strategy,
        status="eligible",
        reasons=[reason],
        projected_plan=plan,
        distance_delta_m=plan.path.distance_m - baseline.path.distance_m,
        duration_delta_seconds=(
            plan.score.estimated_duration_seconds - baseline.score.estimated_duration_seconds
        ),
    )


def _add_task(
    request: CandidatePlanningRequest, tree: TaskTree, event: TaskAddedEvent
) -> CandidatePlanningRequest:
    assert tree.definition is not None
    definition = tree.definition.model_copy(deep=True)
    by_id = {node.id: node for node in definition.nodes}
    if event.task.id in by_id:
        raise RiskSimulationInputError("Added task ID already exists")
    if unknown := set(event.before_task_ids) - by_id.keys():
        raise RiskSimulationInputError(f"Unknown insertion tasks: {sorted(unknown)}")
    for task_id in event.before_task_ids:
        by_id[task_id].depends_on.append(event.task.id)
    definition.nodes.append(event.task)
    references = {geometry.ref for geometry in request.scene.targets}
    if duplicates := references & {geometry.ref for geometry in event.geometry}:
        raise RiskSimulationInputError(
            f"Event cannot replace existing geometry: {sorted(duplicates)}"
        )
    task_refs = set(event.task.target.refs) if event.task.target else set()
    if any(geometry.ref not in task_refs for geometry in event.geometry):
        raise RiskSimulationInputError("Event geometry must belong to the added task")
    try:
        definition = TaskDefinition.model_validate(definition.model_dump())
        payload = request.model_dump()
        payload["raw_user_input"] = definition.model_dump_json()
        payload["scene"]["targets"].extend(geometry.model_dump() for geometry in event.geometry)
        updated = CandidatePlanningRequest.model_validate(payload)
    except ValidationError as exc:
        raise RiskSimulationInputError(str(exc)) from exc
    graph = build_dependency_graph(parse_task_input(updated.raw_user_input))
    # 不能让插入任务倒置既有完成声明，或悄悄撤销完成记录。
    if conflicting := nx.descendants(graph, event.task.id) & set(request.completed_task_ids):
        raise RiskSimulationInputError(
            f"Added task would invalidate declared completion: {sorted(conflicting)}"
        )
    return updated


def _task_impact(
    event: TaskAddedEvent,
    tree: TaskTree,
    original: CandidatePlan,
    proposed: CandidatePlan | None,
) -> TaskImpact:
    graph = build_dependency_graph(tree)
    old_positions = {task_id: index for index, task_id in enumerate(original.task_order)}
    rescheduled = (
        [
            task_id
            for index, task_id in enumerate(proposed.task_order)
            if task_id in old_positions and index != old_positions[task_id]
        ]
        if proposed is not None
        else []
    )
    return TaskImpact(
        direct_task_ids=[event.task.id],
        dependent_task_ids=sorted(nx.descendants(graph, event.task.id)),
        rescheduled_task_ids=rescheduled,
        reasons=[
            "新增任务为直接影响；通过前置依赖传递到后续任务。",
            "rescheduled_task_ids 表示原任务在新候选中的访问序号改变，不代表已计算执行时刻。",
        ],
    )


def simulate_scenario(request: RiskSimulationRequest) -> RiskSimulationResult:
    """重算基线并预演一个事件；保持调用者输入与加载器缓存不变。"""
    scenario = deepcopy(load_mission_scenario(request.planning_request.scenario_id))
    baseline = build_candidate_planning_result(request.planning_request, scenario)
    result = RiskSimulationResult(
        status="baseline_unavailable",
        baseline=baseline,
        selected_strategy=request.selected_strategy,
        event=request.event,
    )
    original = _selected(baseline, request.selected_strategy)
    if original is None or original.status != "feasible":
        result.reasons = [
            "所选策略缺少可行的基线路径；请先澄清输入或重新选择 F03 候选。",
            *baseline.reasons,
            *baseline.clarifications,
            *(original.reasons if original else []),
        ]
        return result
    result.status = "simulated"
    if isinstance(request.event, WindChangeEvent):
        active_ids = list(original.task_order)
        result.impact = TaskImpact(
            direct_task_ids=active_ids,
            reasons=["风速变化作用于全场景，所选候选中的全部待访问任务直接受影响。"],
        )
        pause = _pause(active_ids, "暂停原计划并复核风速与作业条件。")
        if request.event.wind_speed_mps is None:
            result.status = "needs_clarification"
            result.reasons = ["事件没有可用风速，不能以原场景风速代替未知值。"]
            result.alternatives = [
                SimulationAlternative(
                    strategy="continue_original",
                    status="requires_review",
                    reasons=result.reasons,
                    deferred_task_ids=active_ids,
                ),
                pause,
            ]
            return result
        environment = EnvironmentState.model_validate(scenario["environment_state"])
        environment.wind_speed_mps = request.event.wind_speed_mps
        rules = evaluate_hard_constraints(
            environment,
            AirspaceConstraint.model_validate(scenario["airspace_constraint"]),
            DroneState.model_validate(scenario["drone_state"]),
        )
        result.rules_after = rules
        if rules.passed:
            result.recommended_response = "continue_original"
            continuation = _eligible(
                "continue_original",
                original,
                original,
                "假设风速下既有硬约束通过；几何路线与静态时间估算不变，不代表风无影响。",
            )
        else:
            continuation = SimulationAlternative(
                strategy="continue_original",
                status="blocked",
                reasons=[check.reason for check in rules.checks if not check.passed],
                deferred_task_ids=active_ids,
            )
        result.alternatives = [continuation, pause]
        return result

    updated = _add_task(request.planning_request, baseline.task_tree, request.event)
    projected = build_candidate_planning_result(updated, scenario)
    proposed = _selected(projected, request.selected_strategy)
    result.projected = projected
    result.rules_after = projected.rule_evaluation
    result.impact = _task_impact(request.event, projected.task_tree, original, proposed)
    pending = [*original.task_order, request.event.task.id]
    unchanged = SimulationAlternative(
        strategy="continue_original",
        status="blocked",
        reasons=["原方案没有新增任务的采集访问，也未应用新的前置依赖，不能满足变更后的任务。"],
        deferred_task_ids=[request.event.task.id, *result.impact.dependent_task_ids],
    )
    if proposed is not None and proposed.status == "feasible":
        replan = _eligible(
            "replan", proposed, original, "相同规划策略下，新任务已纳入完整往返候选。"
        )
        result.recommended_response = "replan"
    else:
        if projected.status == "needs_clarification":
            result.status = "needs_clarification"
            alternative_status = "requires_review"
        elif projected.status == "blocked":
            alternative_status = "blocked"
        elif proposed is not None and proposed.status == "budget_exceeded":
            alternative_status = "budget_exceeded"
        else:
            alternative_status = "infeasible"
        reasons = [
            *projected.reasons,
            *projected.clarifications,
            *(proposed.reasons if proposed else []),
        ]
        replan = SimulationAlternative(
            strategy="replan",
            status=alternative_status,
            reasons=reasons,
            deferred_task_ids=pending,
        )
        result.reasons = reasons
    result.alternatives = [
        unchanged,
        _pause(pending, "暂停并确认新增任务、空间绑定与依赖关系。"),
        replan,
    ]
    return result
