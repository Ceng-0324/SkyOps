"""点云输入验证与数据所有权。"""

import numpy as np
import pytest
from pydantic import ValidationError

from app.core.models.point_cloud import PointCloud


@pytest.mark.parametrize(
    "points",
    [
        np.ones(3),
        np.ones((2, 2)),
        np.ones((2, 4)),
        np.array([[float("nan"), 0, 2]]),
        np.array([[0, float("inf"), 2]]),
        np.array([[0, 0, float("-inf")]]),
        np.array([["x", "y", "z"]]),
        np.ones((1, 3), dtype=complex),
    ],
)
def test_rejects_invalid_coordinates(points: np.ndarray) -> None:
    """拒绝错误形状、非数值和非有限坐标。"""
    with pytest.raises(ValidationError):
        PointCloud(points=points)


@pytest.mark.parametrize(
    "colors",
    [
        np.ones((2, 3)),
        np.ones((1, 2)),
        np.array([[1.1, 0, 0]]),
        np.array([[-0.1, 0, 0]]),
        np.array([[float("nan"), 0, 0]]),
    ],
)
def test_rejects_invalid_colors(colors: np.ndarray) -> None:
    """颜色必须与坐标对齐并处于 0 到 1。"""
    with pytest.raises(ValidationError):
        PointCloud(points=np.ones((1, 3)), colors=colors)


def test_cloud_owns_validated_coordinate_snapshot() -> None:
    """调用方修改原数组不能污染已验证的点云。"""
    original = np.ones((1, 3))
    cloud = PointCloud(points=original)
    original[0, 0] = float("nan")
    assert np.isfinite(cloud.points).all()
    assert cloud.points.dtype == np.float64
