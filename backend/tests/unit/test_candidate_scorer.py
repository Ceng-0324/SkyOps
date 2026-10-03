"""精确线段距离和评分的独立数值样例。"""

from math import sqrt

import pytest

from app.core.models.candidate_planning import CandidatePlanningRequest, RoutePath
from app.core.models.point_cloud import Obstacle
from app.core.planning.path_optimizer import SearchBudget
from app.core.strategy_composer.scorer import score_plan, segment_box_distance


@pytest.mark.parametrize(
    "start,end,expected",
    [
        ((0, 0, 0), (3, 0, 0), sqrt(2)),
        ((0, 1.5, 1.5), (3, 1.5, 1.5), 0),
        ((0, 0, 0), (0, 0, 0), sqrt(3)),
        ((3, 0, 0), (0, 0, 0), sqrt(2)),
        ((0, 3, 1.5), (3, 3, 1.5), 1),
    ],
)
def test_minimum_distance_includes_segment_interior(
    start: tuple, end: tuple, expected: float
) -> None:
    assert segment_box_distance(start, end, ((1, 1, 1), (2, 2, 2))) == pytest.approx(expected)


def test_score_monotonic_time_coverage_and_risk(
    candidate_request: CandidatePlanningRequest,
) -> None:
    scene = candidate_request.scene
    path = RoutePath(points=[(1, 1, 1), (9, 1, 1)], distance_m=8)
    args = dict(visited_samples=5, credited_samples=0, total_samples=5, budget=SearchBudget())
    base = score_plan(path, scene, **args)
    scene.cruise_speed_mps = 1
    slower = score_plan(path, scene, **args)
    assert slower.estimated_duration_seconds > base.estimated_duration_seconds
    assert slower.total < base.total
    scene.cruise_speed_mps = 2
    scene.obstacle_detection.obstacles = [
        Obstacle(id="o", position=(5, 3, 1), size=(1, 1, 1), confidence=0)
    ]
    nearby = score_plan(path, scene, **args)
    assert nearby.proximity_risk == pytest.approx(1 / (1 + 1.3))
    assert nearby.total < base.total
    scene.obstacle_detection.obstacles[0].confidence = 1
    assert score_plan(path, scene, **args) == nearby
    scene.obstacle_detection.obstacles = []
    partial = score_plan(
        path, scene, visited_samples=2, credited_samples=0, total_samples=5, budget=SearchBudget()
    )
    assert partial.sample_coverage_percent == 40
    assert partial.total < base.total


def test_completed_sample_credit_does_not_add_flight_time(
    candidate_request: CandidatePlanningRequest,
) -> None:
    scene = candidate_request.scene
    result = score_plan(
        RoutePath(points=[scene.start], distance_m=0),
        scene,
        visited_samples=1,
        credited_samples=4,
        total_samples=5,
        budget=SearchBudget(),
    )
    assert result.sample_coverage_percent == 100
    assert result.estimated_duration_seconds == 5
