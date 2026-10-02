"""障碍物检测器。

从点云数据中检测障碍物。
"""

from datetime import datetime, timezone

import numpy as np
from scipy.cluster.vq import kmeans2

from app.core.models.point_cloud import Obstacle, ObstacleDetectionResult, PointCloud


def detect_obstacles(
    point_cloud: PointCloud,
    height_threshold: float = 0.5,
    min_points: int = 10,
    cluster_tolerance: float = 1.0,
) -> ObstacleDetectionResult:
    """从点云中检测障碍物。

    Args:
        point_cloud: 点云数据
        height_threshold: 高度阈值（米），低于此高度的点被过滤
        min_points: 最小点数，过滤噪声
        cluster_tolerance: 聚类容差（米）

    Returns:
        障碍物检测结果

    算法：
    1. 过滤高度 > height_threshold 的点
    2. K-means 聚类分组
    3. 为每个聚类计算边界框
    4. 生成 Obstacle 对象
    """
    points = point_cloud.points

    if len(points) == 0:
        return ObstacleDetectionResult(
            obstacles=[],
            detection_time=datetime.now(timezone.utc),
            algorithm="height_threshold_kmeans",
        )

    # 1. 过滤高度
    high_points = points[points[:, 2] > height_threshold]

    if len(high_points) < min_points:
        return ObstacleDetectionResult(
            obstacles=[],
            detection_time=datetime.now(timezone.utc),
            algorithm="height_threshold_kmeans",
        )

    # 2. K-means 聚类（估算簇数）
    estimated_clusters = max(1, len(high_points) // (min_points * 2))
    estimated_clusters = min(estimated_clusters, 20)  # 最多20个障碍物

    try:
        centroids, labels = kmeans2(
            high_points, k=estimated_clusters, minit="points", iter=10
        )
    except Exception:
        # 聚类失败，返回空结果
        return ObstacleDetectionResult(
            obstacles=[],
            detection_time=datetime.now(timezone.utc),
            algorithm="height_threshold_kmeans",
        )

    # 3. 为每个聚类生成障碍物
    obstacles = []
    for cluster_id in range(estimated_clusters):
        cluster_points = high_points[labels == cluster_id]

        if len(cluster_points) < min_points:
            continue

        # 计算边界框
        min_coords = cluster_points.min(axis=0)
        max_coords = cluster_points.max(axis=0)
        center = (min_coords + max_coords) / 2
        size = max_coords - min_coords

        # 计算置信度（基于点数和密度）
        point_count = len(cluster_points)
        volume = float(np.prod(size)) if np.prod(size) > 0 else 1.0
        density = point_count / volume

        # 标准化置信度：点数越多、密度越高，置信度越高
        # 使用 sigmoid 函数限制在 [0, 1] 范围
        point_score = min(1.0, point_count / 50.0)  # 50个点以上接近满分
        density_score = min(1.0, density / 5.0)  # 密度5以上接近满分
        confidence = (point_score + density_score) / 2  # 综合评分

        obstacle = Obstacle(
            id=f"obs_{cluster_id}",
            position=(float(center[0]), float(center[1]), float(center[2])),
            size=(float(size[0]), float(size[1]), float(size[2])),
            confidence=float(confidence),
            obstacle_type="unknown",
        )
        obstacles.append(obstacle)

    return ObstacleDetectionResult(
        obstacles=obstacles,
        detection_time=datetime.now(timezone.utc),
        algorithm="height_threshold_kmeans",
    )
