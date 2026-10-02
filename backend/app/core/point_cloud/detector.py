"""按欧氏距离连通分量提取障碍，不把算法失败解释为空场景。"""

from math import isfinite

import numpy as np
from scipy.spatial import cKDTree

from app.core.models.point_cloud import Obstacle, ObstacleDetectionResult, PointCloud

# 限制密集场景的总邻域访问量，避免容差过大时退化为无界二次计算。
MAX_NEIGHBOR_LINKS = 5_000_000


def detect_obstacles(
    point_cloud: PointCloud,
    height_threshold: float = 0.5,
    min_points: int = 10,
    cluster_tolerance: float = 1.0,
) -> ObstacleDetectionResult:
    """高度过滤后，按距离不超过容差的连通分量生成障碍。

    min_points 是每个连通簇的最小点数，不是全场点数或预估障碍数。
    按坐标排序使同一输入集合的障碍 ID 与边界框不受输入顺序影响。
    confidence 是点数与密度的启发式分数，不是校准后的识别概率。
    非法输入或超过邻域计算预算时抛出 ValueError；其他计算错误原样传播。
    """
    if not isfinite(height_threshold) or height_threshold < 0:
        raise ValueError("height_threshold must be finite and non-negative")
    if not isfinite(cluster_tolerance) or cluster_tolerance <= 0:
        raise ValueError("cluster_tolerance must be finite and positive")
    if isinstance(min_points, bool) or not isinstance(min_points, int) or min_points < 1:
        raise ValueError("min_points must be a positive integer")

    # 数组可被调用方修改，因此在算法边界重新验证。
    cloud = PointCloud.model_validate(point_cloud)
    points = cloud.points[cloud.points[:, 2] > height_threshold]
    obstacles: list[Obstacle] = []
    if len(points) >= min_points:
        points = points[np.lexsort((points[:, 2], points[:, 1], points[:, 0]))]
        tree = cKDTree(points)
        if tree.count_neighbors(tree, cluster_tolerance) > MAX_NEIGHBOR_LINKS:
            raise ValueError("Point cloud neighborhood budget exceeded; reduce points or tolerance")
        visited = np.zeros(len(points), dtype=bool)
        for start in range(len(points)):
            if visited[start]:
                continue
            visited[start] = True
            pending = [start]
            members = []
            while pending:
                index = pending.pop()
                members.append(index)
                neighbors = tree.query_ball_point(points[index], cluster_tolerance)
                for neighbor in neighbors:
                    if not visited[neighbor]:
                        visited[neighbor] = True
                        pending.append(neighbor)
            if len(members) < min_points:
                continue

            cluster = points[members]
            minimum, maximum = cluster.min(axis=0), cluster.max(axis=0)
            with np.errstate(over="raise", invalid="raise"):
                size = maximum - minimum
                center = minimum / 2 + maximum / 2
                volume = float(np.prod(size))
            density = len(cluster) / (volume if volume > 0 else 1.0)
            point_score = min(1.0, len(cluster) / 50.0)
            density_score = min(1.0, density / 5.0)
            obstacles.append(
                Obstacle(
                    id=f"obs_{len(obstacles)}",
                    position=tuple(float(value) for value in center),
                    size=tuple(float(value) for value in size),
                    confidence=(point_score + density_score) / 2,
                )
            )

    return ObstacleDetectionResult(
        obstacles=obstacles,
        algorithm="height_threshold_euclidean",
        source=cloud.source,
    )
