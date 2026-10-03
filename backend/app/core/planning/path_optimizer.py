"""确定性三维 A*；每条边做连续碰撞检查，粗网格失败不声称空间绝对不可达。"""

from dataclasses import dataclass
from heapq import heappop, heappush
from itertools import pairwise, product
from math import ceil, dist, floor, prod

from app.core.models.candidate_planning import (
    MAX_GEOMETRY_CHECKS,
    MAX_GRID_NODES,
    PlanningBounds,
    Position,
    RoutePath,
)
from app.core.models.point_cloud import Obstacle

Box = tuple[Position, Position]
GridIndex = tuple[int, int, int]


class PathNotFoundError(ValueError):
    """当前边界、障碍和网格下未找到路径。"""


class PlanningBudgetExceeded(ValueError):
    """本次规划耗尽几何计算预算。"""


@dataclass
class SearchBudget:
    """跨多段路径与评分共享的显式计算预算。"""

    remaining: int = MAX_GEOMETRY_CHECKS

    def spend(self) -> None:
        """每次边检查、包围盒运算或节点扩展计入预算。"""
        if self.remaining <= 0:
            raise PlanningBudgetExceeded("Planning geometry budget exceeded")
        self.remaining -= 1


def obstacle_boxes(obstacles: list[Obstacle], clearance_m: float) -> list[Box]:
    """以调用者给定的几何间距膨胀已知障碍；不修改飞行安全阈值。"""
    return [
        (
            tuple(
                center - extent / 2 - clearance_m
                for center, extent in zip(obstacle.position, obstacle.size, strict=True)
            ),
            tuple(
                center + extent / 2 + clearance_m
                for center, extent in zip(obstacle.position, obstacle.size, strict=True)
            ),
        )
        for obstacle in obstacles
    ]


def segment_intersects_box(start: Position, end: Position, box: Box) -> bool:
    """闭合线段与闭合 AABB 相交；擦边、零体积障碍与零长度段均按碰撞处理。"""
    enter, leave = 0.0, 1.0
    for origin, target, low, high in zip(start, end, *box, strict=True):
        delta = target - origin
        if delta == 0:
            if origin < low or origin > high:
                return False
            continue
        near, far = sorted(((low - origin) / delta, (high - origin) / delta))
        enter, leave = max(enter, near), min(leave, far)
        if enter > leave:
            return False
    return True


def segment_is_clear(
    start: Position, end: Position, boxes: list[Box], budget: SearchBudget
) -> bool:
    """连续检查整个线段，避免穿过网格节点之间的薄障碍。"""
    budget.spend()
    for box in boxes:
        budget.spend()
        if segment_intersects_box(start, end, box):
            return False
    return True


def _search_leg(
    start: Position,
    end: Position,
    bounds: PlanningBounds,
    resolution: float,
    boxes: list[Box],
    budget: SearchBudget,
) -> list[Position]:
    if not segment_is_clear(start, start, boxes, budget):
        raise PathNotFoundError("Route start or waypoint is inside an expanded obstacle")
    if not segment_is_clear(end, end, boxes, budget):
        raise PathNotFoundError("Route waypoint is inside an expanded obstacle")
    if segment_is_clear(start, end, boxes, budget):
        return [start] if start == end else [start, end]

    last = tuple(
        ceil((high - low) / resolution)
        for low, high in zip(bounds.minimum, bounds.maximum, strict=True)
    )

    def position(index: GridIndex) -> Position:
        return tuple(
            min(high, low + i * resolution)
            for i, low, high in zip(index, bounds.minimum, bounds.maximum, strict=True)
        )

    def connectors(point: Position) -> list[GridIndex]:
        choices = [
            sorted(
                {
                    max(0, min(limit, floor((value - low) / resolution))),
                    max(0, min(limit, ceil((value - low) / resolution))),
                }
            )
            for value, low, limit in zip(point, bounds.minimum, last, strict=True)
        ]
        return [
            index
            for index in product(*choices)
            if segment_is_clear(point, position(index), boxes, budget)
        ]

    goals = set(connectors(end))
    scores: dict[GridIndex, float] = {}
    parents: dict[GridIndex, GridIndex | None] = {}
    queue: list[tuple[float, float, GridIndex]] = []
    for index in connectors(start):
        cost = dist(start, position(index))
        scores[index], parents[index] = cost, None
        heappush(queue, (cost + dist(position(index), end), cost, index))
    if not goals or not queue:
        raise PathNotFoundError("No collision-free endpoint connector at this grid resolution")
    best_goal: GridIndex | None = None
    best_cost = float("inf")
    while queue:
        estimate, cost, current = heappop(queue)
        if estimate >= best_cost:
            break
        if cost != scores[current]:
            continue
        budget.spend()
        point = position(current)
        if current in goals:
            best_cost = cost + dist(point, end)
            best_goal = current
        for axis in range(3):
            for step in (-1, 1):
                adjacent = list(current)
                adjacent[axis] += step
                if not 0 <= adjacent[axis] <= last[axis]:
                    continue
                neighbor = tuple(adjacent)
                next_point = position(neighbor)
                next_cost = cost + dist(point, next_point)
                if next_cost >= scores.get(neighbor, float("inf")):
                    continue
                if not segment_is_clear(point, next_point, boxes, budget):
                    continue
                scores[neighbor], parents[neighbor] = next_cost, current
                heappush(queue, (next_cost + dist(next_point, end), next_cost, neighbor))
    if best_goal is None:
        raise PathNotFoundError("No route found within the planning bounds at this grid resolution")
    reverse: list[Position] = [end]
    cursor: GridIndex | None = best_goal
    while cursor is not None:
        reverse.append(position(cursor))
        cursor = parents[cursor]
    return [start, *reversed(reverse)]


def optimize_path(
    waypoints: list[Position],
    obstacles: list[Obstacle],
    *,
    bounds: PlanningBounds,
    grid_resolution_m: float,
    clearance_m: float,
    budget: SearchBudget | None = None,
) -> RoutePath:
    """连接有序观察点；所有端点原样保留，失败时不返回部分路径。"""
    from math import isfinite

    if not isfinite(grid_resolution_m) or grid_resolution_m <= 0:
        raise ValueError("Grid resolution must be finite and positive")
    if not isfinite(clearance_m) or clearance_m < 0:
        raise ValueError("Clearance must be finite and non-negative")
    if not 1 <= len(waypoints) <= 258 or len(obstacles) > 128:
        raise ValueError("Path input exceeds waypoint or obstacle limit")
    if any(
        len(point) != 3 or not all(isfinite(v) for v in point) or not bounds.contains(point)
        for point in waypoints
    ):
        raise ValueError("Waypoints must be finite 3D positions within planning bounds")
    if any(
        any(not isfinite(v) for v in (*o.position, *o.size)) or min(o.size) < 0 for o in obstacles
    ):
        raise ValueError("Obstacle coordinates and extents must be finite and non-negative")
    if (
        prod(
            ceil((hi - lo) / grid_resolution_m) + 1
            for lo, hi in zip(bounds.minimum, bounds.maximum, strict=True)
        )
        > MAX_GRID_NODES
    ):
        raise ValueError("Planning grid exceeds node limit")
    active_budget = budget if budget is not None else SearchBudget()
    boxes = obstacle_boxes(obstacles, clearance_m)
    if not segment_is_clear(waypoints[0], waypoints[0], boxes, active_budget):
        raise PathNotFoundError("Route start is inside an expanded obstacle")
    points = [waypoints[0]]
    for start, end in pairwise(waypoints):
        leg = _search_leg(start, end, bounds, grid_resolution_m, boxes, active_budget)
        for point in leg:
            if point != points[-1]:
                points.append(point)
    return RoutePath(points=points, distance_m=sum(dist(a, b) for a, b in pairwise(points)))
