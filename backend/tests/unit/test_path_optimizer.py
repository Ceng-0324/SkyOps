"""独立几何断言验证局部仿真 A*，包括网格之间的薄障碍。"""

from itertools import pairwise
from math import dist

import pytest

from app.core.models.candidate_planning import PlanningBounds
from app.core.models.point_cloud import Obstacle
from app.core.planning.path_optimizer import (
    PathNotFoundError,
    PlanningBudgetExceeded,
    SearchBudget,
    optimize_path,
    segment_intersects_box,
)

BOUNDS = PlanningBounds(minimum=(0, 0, 0), maximum=(6, 6, 4))


def test_direct_path_preserves_off_grid_waypoints_and_return() -> None:
    waypoints = [(0.2, 0.2, 1.1), (5.7, 5.4, 2.3), (0.2, 0.2, 1.1)]
    path = optimize_path(waypoints, [], bounds=BOUNDS, grid_resolution_m=1, clearance_m=0)
    assert path.points == waypoints
    assert path.distance_m == pytest.approx(2 * dist(waypoints[0], waypoints[1]))


def test_detour_checks_entire_segment_not_only_nodes() -> None:
    # 薄墙位于 x=2.5；整数网格节点本身都不在墙内。
    wall = Obstacle(id="thin", position=(2.5, 2, 2), size=(0.02, 3, 4), confidence=1)
    path = optimize_path(
        [(1, 2, 1), (5, 2, 1)], [wall], bounds=BOUNDS, grid_resolution_m=1, clearance_m=0.1
    )
    assert path.distance_m > 4
    assert path.points[0] == (1, 2, 1) and path.points[-1] == (5, 2, 1)
    assert all(BOUNDS.contains(point) for point in path.points)
    # 独立计算每段穿过墙两侧平面时的 y，不能从膨胀墙内部穿过。
    for a, b in pairwise(path.points):
        for plane in (2.39, 2.61):
            if a[0] != b[0] and min(a[0], b[0]) <= plane <= max(a[0], b[0]):
                t = (plane - a[0]) / (b[0] - a[0])
                y = a[1] + t * (b[1] - a[1])
                assert y < 0.4 or y > 3.6


def test_wall_across_domain_is_explicitly_infeasible() -> None:
    wall = Obstacle(id="wall", position=(3, 3, 2), size=(1, 6, 4), confidence=1)
    with pytest.raises(PathNotFoundError, match="No route"):
        optimize_path(
            [(1, 2, 1), (5, 2, 1)], [wall], bounds=BOUNDS, grid_resolution_m=1, clearance_m=0
        )


@pytest.mark.parametrize(
    "a,b,expected",
    [
        ((0, 0, 0), (3, 3, 3), True),
        ((0, 1, 1), (3, 1, 1), True),
        ((0, 0, 0), (3, 0, 0), False),
        ((1.5, 1.5, 1.5), (1.5, 1.5, 1.5), True),
        ((0, 0, 0), (0, 0, 0), False),
        ((3, 3, 3), (0, 0, 0), True),
    ],
)
def test_closed_box_slab_intersection(a: tuple, b: tuple, expected: bool) -> None:
    assert segment_intersects_box(a, b, ((1, 1, 1), (2, 2, 2))) is expected


def test_zero_volume_obstacle_touch_is_blocked() -> None:
    obstacle = Obstacle(id="point", position=(1, 1, 1), size=(0, 0, 0), confidence=0)
    with pytest.raises(PathNotFoundError):
        optimize_path([(1, 1, 1)], [obstacle], bounds=BOUNDS, grid_resolution_m=1, clearance_m=0)


def test_budget_is_shared_across_legs_and_failure_has_no_partial_path() -> None:
    with pytest.raises(PlanningBudgetExceeded):
        optimize_path(
            [(1, 1, 1), (2, 2, 2), (3, 3, 3)],
            [],
            bounds=BOUNDS,
            grid_resolution_m=1,
            clearance_m=0,
            budget=SearchBudget(4),
        )


@pytest.mark.parametrize(
    "point,resolution", [((7, 1, 1), 1), ((float("nan"), 1, 1), 1), ((1, 1, 1), 0.001)]
)
def test_invalid_geometry_and_huge_grid_are_rejected(point: tuple, resolution: float) -> None:
    with pytest.raises(ValueError):
        optimize_path([point], [], bounds=BOUNDS, grid_resolution_m=resolution, clearance_m=0)


def test_partial_last_grid_cell_and_deterministic_search() -> None:
    bounds = PlanningBounds(minimum=(0, 0, 0), maximum=(6.2, 6.2, 4.2))
    obstacle = Obstacle(id="wall", position=(3, 2, 2), size=(1, 3, 4), confidence=1)
    args = dict(bounds=bounds, grid_resolution_m=1, clearance_m=0)
    path = optimize_path([(0.2, 2, 1), (6.2, 2, 1)], [obstacle], **args)
    assert path == optimize_path([(0.2, 2, 1), (6.2, 2, 1)], [obstacle], **args)
    assert path.points[-1] == (6.2, 2, 1)
