"""空间连通聚类、噪声和失败语义回归。"""

import numpy as np
import pytest

from app.core.models.point_cloud import PointCloud
from app.core.point_cloud import detector
from app.core.point_cloud.detector import detect_obstacles


def cloud_at(*offsets: float, count: int = 10) -> PointCloud:
    """生成间距 0.01 米的合成线状簇。"""
    return PointCloud(
        points=np.array([[x + i * 0.01, 0, 2] for x in offsets for i in range(count)])
    )


def test_separates_distant_clusters_and_uses_tolerance() -> None:
    """两个远距离簇必须分离，大容差才连接。"""
    cloud = cloud_at(0, 100)
    result = detect_obstacles(cloud, cluster_tolerance=0.1)
    assert len(result.obstacles) == 2
    assert [o.position[0] for o in result.obstacles] == pytest.approx([0.045, 100.045])
    assert [o.size[0] for o in result.obstacles] == pytest.approx([0.09, 0.09])
    assert len(detect_obstacles(cloud, cluster_tolerance=1000).obstacles) == 1


def test_filters_isolated_noise_even_when_total_count_is_large() -> None:
    """噪声判定按空间簇进行，而非按输入总点数。"""
    cloud = PointCloud(points=np.array([[i * 10.0, 0, 2] for i in range(30)]))
    assert detect_obstacles(cloud).obstacles == []


@pytest.mark.parametrize("count", [10, 20, 50])
def test_cluster_count_is_independent_of_sampling_density(count: int) -> None:
    """增加同一物体的采样点不能制造额外障碍。"""
    assert len(detect_obstacles(cloud_at(0, 100, count=count)).obstacles) == 2


def test_empty_and_below_threshold_points() -> None:
    """空输入和阈值边界均是有效空结果。"""
    for points in (np.empty((0, 3)), np.array([[0, 0, 0.5]] * 20)):
        result = detect_obstacles(PointCloud(points=points))
        assert result.obstacles == []
        assert result.algorithm == "height_threshold_euclidean"


def test_height_filter_and_small_cluster_filter() -> None:
    """只保留高于阈值且达到簇点数要求的物体。"""
    points = np.vstack((cloud_at(0).points, [[100, 0, 2]], [[0, 0, 0.2]] * 30))
    result = detect_obstacles(PointCloud(points=points))
    assert len(result.obstacles) == 1
    assert result.obstacles[0].position == pytest.approx((0.045, 0, 2))


def test_clusters_are_stable_across_input_order_and_not_capped_at_twenty() -> None:
    """顺序不影响 ID/边界框，不能静默截断障碍数。"""
    points = cloud_at(*range(0, 300, 10)).points
    first = detect_obstacles(PointCloud(points=points))
    second = detect_obstacles(PointCloud(points=points[::-1]))
    assert len(first.obstacles) == 30
    assert first.obstacles == second.obstacles


def test_confidence_calculation() -> None:
    """必须存在预期障碍，再检查启发式置信度范围。"""
    result = detect_obstacles(cloud_at(0, count=50))
    assert len(result.obstacles) == 1
    assert 0 < result.obstacles[0].confidence <= 1


@pytest.mark.parametrize("source", ["mock", "simulated", "real"])
@pytest.mark.parametrize("empty", [False, True])
def test_result_preserves_source(source: str, empty: bool) -> None:
    """有障碍和空场景都必须保留输入来源。"""
    points = np.empty((0, 3)) if empty else cloud_at(0).points
    result = detect_obstacles(PointCloud(points=points, source=source))
    assert result.model_dump(mode="json")["source"] == source


@pytest.mark.parametrize(
    "parameters",
    [
        {"height_threshold": float("nan")},
        {"height_threshold": -1},
        {"cluster_tolerance": float("inf")},
        {"cluster_tolerance": 0},
        {"min_points": 0},
        {"min_points": 1.5},
        {"min_points": True},
    ],
)
def test_invalid_algorithm_parameters(parameters: dict[str, float]) -> None:
    """核心入口也验证参数，不能依赖 HTTP 层。"""
    with pytest.raises(ValueError):
        detect_obstacles(cloud_at(0), **parameters)


def test_algorithm_failure_is_explicit(monkeypatch: pytest.MonkeyPatch) -> None:
    """计算失败必须传播，不能转成成功空结果。"""

    def broken_tree(points: np.ndarray) -> None:
        raise RuntimeError("synthetic clustering failure")

    monkeypatch.setattr(detector, "cKDTree", broken_tree)
    with pytest.raises(RuntimeError, match="clustering failure"):
        detect_obstacles(cloud_at(0))


def test_revalidates_mutated_arrays() -> None:
    """绕过模型赋值的 ndarray 原地变更也不能进入计算。"""
    cloud = cloud_at(0)
    cloud.points[0, 0] = np.nan
    with pytest.raises(ValueError, match="finite"):
        detect_obstacles(cloud)


def test_dense_neighborhood_limit_is_explicit(monkeypatch: pytest.MonkeyPatch) -> None:
    """资源保护不能静默遗漏障碍。"""
    monkeypatch.setattr(detector, "MAX_NEIGHBOR_LINKS", 99)
    with pytest.raises(ValueError, match="budget exceeded"):
        detect_obstacles(cloud_at(0))


def test_radius_boundary_connects_points() -> None:
    """容差边界采用闭区间；min_points 按连通簇点数计算。"""
    cloud = PointCloud(points=np.array([[0, 0, 2], [1, 0, 2], [2, 0, 2]]))
    assert len(detect_obstacles(cloud, min_points=3, cluster_tolerance=1).obstacles) == 1
    assert detect_obstacles(cloud, min_points=3, cluster_tolerance=0.99).obstacles == []


def test_volume_confidence_is_finite() -> None:
    """非退化三维簇也产生有限置信度和正确边界框。"""
    cloud = PointCloud(points=np.array([[x, y, z] for x in [0, 1] for y in [0, 1] for z in [2, 3]]))
    result = detect_obstacles(cloud, min_points=8)
    assert len(result.obstacles) == 1
    assert result.obstacles[0].size == (1, 1, 1)
    assert 0 < result.obstacles[0].confidence <= 1
