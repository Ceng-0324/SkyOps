"""策略只改变任务访问顺序和补采集合，不删除前置依赖。"""

from math import dist
from typing import Protocol

import networkx as nx

from app.core.models.candidate_planning import ObservationVisit, Position, StrategyName


class VisitStrategy(Protocol):
    """一个策略定义候选的任务选择和排序偏好。"""

    name: StrategyName
    skip_completed: bool

    def task_key(
        self,
        task_id: str,
        visits: list[ObservationVisit],
        current: Position,
        priority_ranks: dict[str, int],
    ) -> tuple:
        """为当前已就绪的任务提供确定性排序键。"""
        ...

    def order_visits(
        self, visits: list[ObservationVisit], current: Position
    ) -> list[ObservationVisit]:
        """排列一个任务内部的全部观察样本。"""
        ...


class CoverageStrategy:
    """按空间坐标扫描全部任务和全部样本，包括已声明完成任务的复查。"""

    name: StrategyName = "coverage"
    skip_completed = False

    def task_key(
        self,
        task_id: str,
        visits: list[ObservationVisit],
        current: Position,
        priority_ranks: dict[str, int],
    ) -> tuple:
        """对依赖就绪任务按最小观察点坐标排列。"""
        return min(visit.position for visit in visits), task_id

    def order_visits(
        self, visits: list[ObservationVisit], current: Position
    ) -> list[ObservationVisit]:
        """按 x/y/z、引用和样本序号扫描。"""
        return sorted(
            visits, key=lambda visit: (visit.position, visit.target_ref, visit.sample_index)
        )


def _nearest_visits(visits: list[ObservationVisit], current: Position) -> list[ObservationVisit]:
    remaining = list(visits)
    ordered = []
    while remaining:
        visit = min(
            remaining,
            key=lambda item: (dist(current, item.position), item.target_ref, item.sample_index),
        )
        remaining.remove(visit)
        ordered.append(visit)
        current = visit.position
    return ordered


class FocusedObservationStrategy:
    """显式重点任务及其前置链优先，其余就绪任务按最近观察点访问。"""

    name: StrategyName = "focused_observation"
    skip_completed = False

    def task_key(
        self,
        task_id: str,
        visits: list[ObservationVisit],
        current: Position,
        priority_ranks: dict[str, int],
    ) -> tuple:
        """优先级不会越过未完成的前置任务。"""
        return (
            priority_ranks.get(task_id, len(priority_ranks)),
            min(dist(current, visit.position) for visit in visits),
            task_id,
        )

    def order_visits(
        self, visits: list[ObservationVisit], current: Position
    ) -> list[ObservationVisit]:
        """重点任务内按最近样本继续访问。"""
        return _nearest_visits(visits, current)


class SupplementaryCaptureStrategy:
    """仅访问尚未声明完成的任务，按最近就绪任务进行补采。"""

    name: StrategyName = "supplementary_capture"
    skip_completed = True

    def task_key(
        self,
        task_id: str,
        visits: list[ObservationVisit],
        current: Position,
        priority_ranks: dict[str, int],
    ) -> tuple:
        """在依赖约束下使用几何最近邻，不宣称全局最优。"""
        return min(dist(current, visit.position) for visit in visits), task_id

    def order_visits(
        self, visits: list[ObservationVisit], current: Position
    ) -> list[ObservationVisit]:
        """补采任务内按最近样本继续访问。"""
        return _nearest_visits(visits, current)


def schedule_visits(
    strategy: VisitStrategy,
    graph: nx.DiGraph,
    task_visits: dict[str, list[ObservationVisit]],
    start: Position,
    priority_ids: list[str],
    completed_ids: list[str],
) -> tuple[list[str], list[ObservationVisit]]:
    """逐次取依赖就绪任务；输入图必须由 F01 完成 DAG 校验。"""
    ranks: dict[str, int] = {}
    for rank, task_id in enumerate(priority_ids):
        for predecessor in {task_id, *nx.ancestors(graph, task_id)}:
            ranks[predecessor] = min(ranks.get(predecessor, rank), rank)
    done = set(completed_ids) if strategy.skip_completed else set()
    pending = set(graph.nodes) - done
    order: list[str] = []
    visits: list[ObservationVisit] = []
    current = start
    while pending:
        ready = [task_id for task_id in pending if set(graph.predecessors(task_id)) <= done]
        task_id = min(
            ready, key=lambda key: strategy.task_key(key, task_visits[key], current, ranks)
        )
        ordered = strategy.order_visits(task_visits[task_id], current)
        order.append(task_id)
        visits.extend(ordered)
        current = ordered[-1].position
        pending.remove(task_id)
        done.add(task_id)
    return order, visits
