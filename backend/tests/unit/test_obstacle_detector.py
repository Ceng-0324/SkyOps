"""障碍物检测器单元测试。"""

import numpy as np
import pytest

from app.core.models.point_cloud import PointCloud
from app.core.point_cloud.detector import detect_obstacles


def test_empty_point_cloud():
    """测试空点云返回空结果。"""
    point_cloud = PointCloud(
        points=np.array([]).reshape(0, 3),
        source="mock",
    )
    result = detect_obstacles(point_cloud)

    assert len(result.obstacles) == 0
    assert result.algorithm == "height_threshold_kmeans"


def test_detect_obstacles_with_height_threshold():
    """测试高度阈值过滤。"""
    # 创建测试数据：5个低点 + 10个高点
    low_points = np.array([[i, i, 0.2] for i in range(5)])
    high_points = np.array([[i, i, 2.0] for i in range(5, 15)])
    all_points = np.vstack([low_points, high_points])

    point_cloud = PointCloud(points=all_points, source="mock")

    result = detect_obstacles(
        point_cloud,
        height_threshold=0.5,
        min_points=5,
    )

    # 应该检测到至少一个障碍物（高点聚类）
    assert len(result.obstacles) >= 1
    assert all(obs.confidence > 0 for obs in result.obstacles)


def test_noise_filtering():
    """测试噪声点过滤。"""
    # 只有少量高点，不足 min_points
    sparse_points = np.array([[0, 0, 2.0], [1, 1, 2.0]])

    point_cloud = PointCloud(points=sparse_points, source="mock")

    result = detect_obstacles(
        point_cloud,
        height_threshold=0.5,
        min_points=10,  # 要求至少10个点
    )

    # 应该被过滤掉
    assert len(result.obstacles) == 0


def test_confidence_calculation():
    """测试置信度计算。"""
    # 创建密集点云
    dense_points = np.array([[i * 0.1, j * 0.1, 2.0] for i in range(10) for j in range(10)])

    point_cloud = PointCloud(points=dense_points, source="mock")

    result = detect_obstacles(point_cloud, min_points=10)

    if len(result.obstacles) > 0:
        # 密集点云应该有较高置信度
        assert result.obstacles[0].confidence > 0.0
        assert result.obstacles[0].confidence <= 1.0
