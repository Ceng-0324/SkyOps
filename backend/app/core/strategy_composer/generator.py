"""从 F01 任务和 F02 障碍快照生成有失败语义的三策略候选。"""

import networkx as nx

from app.core.models.candidate_planning import (
    CandidatePlan,
    CandidatePlanningRequest,
    ObservationVisit,
)
from app.core.models.task import TaskTree
from app.core.planning.path_optimizer import (
    PathNotFoundError,
    PlanningBudgetExceeded,
    SearchBudget,
    optimize_path,
)
from app.core.strategy_composer.scorer import score_plan
from app.core.strategy_composer.strategies import (
    CoverageStrategy,
    FocusedObservationStrategy,
    SupplementaryCaptureStrategy,
    schedule_visits,
)
from app.core.task_decomposition.dependency import build_dependency_graph


class CandidateInputError(ValueError):
    """无法从给定任务/空间绑定生成候选，需要调用者补充或修正输入。"""


def prepare_task_visits(
    tree: TaskTree,
    request: CandidatePlanningRequest,
) -> tuple[nx.DiGraph, dict[str, list[ObservationVisit]]]:
    """绑定全部任务引用，验证完成声明的依赖闭包与访问次数上限。"""
    graph = build_dependency_graph(tree)
    if tree.status != "parsed" or tree.definition is None:
        raise CandidateInputError("Task understanding requires clarification before path planning")
    if len(graph) > 32:
        raise CandidateInputError("Candidate planning supports at most 32 tasks")
    for task_id in [*request.priority_task_ids, *request.completed_task_ids]:
        if task_id not in graph:
            raise CandidateInputError(f"Unknown selected task: {task_id}")
    completed = set(request.completed_task_ids)
    for task_id in sorted(completed):
        missing = nx.ancestors(graph, task_id) - completed
        if missing:
            raise CandidateInputError(
                f"Completed task {task_id} has incomplete prerequisites: {sorted(missing)}"
            )
    targets = {target.ref: target for target in request.scene.targets}
    visits: dict[str, list[ObservationVisit]] = {}
    for node in tree.definition.nodes:
        assert node.target is not None  # parsed 契约保证存在目标及至少一个引用。
        visits[node.id] = []
        for ref in node.target.refs:
            if ref not in targets:
                raise CandidateInputError(f"Missing observation geometry for task {node.id}: {ref}")
            visits[node.id].extend(
                ObservationVisit(
                    task_id=node.id, target_ref=ref, sample_index=index, position=point
                )
                for index, point in enumerate(targets[ref].observation_points)
            )
    if sum(map(len, visits.values())) > 256:
        raise CandidateInputError("Expanded task visits exceed 256 samples")
    return graph, visits


def generate_candidate_plans(
    tree: TaskTree, request: CandidatePlanningRequest
) -> list[CandidatePlan]:
    """三种策略独立使用相同的有限预算；失败候选不返回部分路径。"""
    graph, task_visits = prepare_task_visits(tree, request)
    total_samples = sum(map(len, task_visits.values()))
    candidates: list[CandidatePlan] = []
    scene = request.scene
    for strategy in (
        CoverageStrategy(),
        FocusedObservationStrategy(),
        SupplementaryCaptureStrategy(),
    ):
        order, visits = schedule_visits(
            strategy,
            graph,
            task_visits,
            scene.start,
            request.priority_task_ids,
            request.completed_task_ids,
        )
        credited = sorted(request.completed_task_ids) if strategy.skip_completed else []
        candidate = CandidatePlan(
            strategy=strategy.name,
            status="infeasible",
            task_order=order,
            visits=visits,
            assumed_completed_task_ids=credited,
        )
        if not visits:
            candidate.status = "no_remaining_tasks"
            candidate.reasons = [
                "All tasks were declared complete; no supplementary flight is proposed"
            ]
        else:
            budget = SearchBudget()
            try:
                path = optimize_path(
                    [scene.start, *(visit.position for visit in visits), scene.start],
                    scene.obstacle_detection.obstacles,
                    bounds=scene.bounds,
                    grid_resolution_m=scene.grid_resolution_m,
                    clearance_m=scene.clearance_m,
                    budget=budget,
                )
                score = score_plan(
                    path,
                    scene,
                    visited_samples=len(visits),
                    credited_samples=sum(len(task_visits[task_id]) for task_id in credited),
                    total_samples=total_samples,
                    budget=budget,
                )
                candidate.path, candidate.score, candidate.status = path, score, "feasible"
            except PlanningBudgetExceeded as exc:
                candidate.status, candidate.reasons = "budget_exceeded", [str(exc)]
            except PathNotFoundError as exc:
                candidate.reasons = [str(exc)]
        for previous in candidates:
            if (
                candidate.status == "feasible"
                and previous.status == "feasible"
                and candidate.visits == previous.visits
                and candidate.path == previous.path
                and candidate.assumed_completed_task_ids == previous.assumed_completed_task_ids
            ):
                candidate.equivalent_to = previous.strategy
                break
        candidates.append(candidate)
    return candidates
