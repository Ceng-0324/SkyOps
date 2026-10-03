"""独立候选评分；固定标度支持跨候选比较，风险只表示已知障碍接近程度。"""

from itertools import pairwise
from math import sqrt

from app.core.models.candidate_planning import PlanningScene, PlanScore, Position, RoutePath
from app.core.planning.path_optimizer import Box, SearchBudget, obstacle_boxes


def segment_box_distance(start: Position, end: Position, box: Box) -> float:
    """精确最小化线段到 AABB 的分段二次距离，避免仅采样端点漏掉近障碍段。"""
    delta = tuple(b - a for a, b in zip(start, end, strict=True))
    knots = {0.0, 1.0}
    for value, step, low, high in zip(start, delta, *box, strict=True):
        if step:
            knots.update(t for t in ((low - value) / step, (high - value) / step) if 0 < t < 1)

    def squared(t: float) -> float:
        return sum(
            max(low - (value + t * step), 0, value + t * step - high) ** 2
            for value, step, low, high in zip(start, delta, *box, strict=True)
        )

    minimum = min(squared(0), squared(1))
    for left, right in pairwise(sorted(knots)):
        midpoint = (left + right) / 2
        linear, quadratic = 0.0, 0.0
        for value, step, low, high in zip(start, delta, *box, strict=True):
            point = value + midpoint * step
            if point < low or point > high:
                offset = value - (low if point < low else high)
                linear += offset * step
                quadratic += step * step
        best_t = max(left, min(right, -linear / quadratic)) if quadratic else midpoint
        minimum = min(minimum, squared(left), squared(right), squared(best_t))
    return sqrt(max(0, minimum))


def score_plan(
    path: RoutePath,
    scene: PlanningScene,
    *,
    visited_samples: int,
    credited_samples: int,
    total_samples: int,
    budget: SearchBudget,
) -> PlanScore:
    """完成度按样本计数；时间含返程和停留；风险不受点云 confidence 折扣。"""
    if total_samples <= 0 or not 0 <= visited_samples + credited_samples <= total_samples:
        raise ValueError("Invalid sample accounting")
    duration = (
        path.distance_m / scene.cruise_speed_mps + visited_samples * scene.observation_seconds
    )
    coverage = (visited_samples + credited_samples) / total_samples
    nearest = float("inf")
    boxes = obstacle_boxes(scene.obstacle_detection.obstacles, scene.clearance_m)
    segments = list(pairwise(path.points)) or [(path.points[0], path.points[0])]
    for start, end in segments:
        budget.spend()
        for box in boxes:
            budget.spend()
            nearest = min(nearest, segment_box_distance(start, end, box))
    risk = 0.0 if not boxes else 1 / (1 + nearest)
    time_score = 1 / (1 + duration / 60)
    return PlanScore(
        sample_coverage_percent=100 * coverage,
        estimated_duration_seconds=duration,
        proximity_risk=risk,
        time_score=time_score,
        total=100 * (0.5 * coverage + 0.3 * time_score + 0.2 * (1 - risk)),
    )
