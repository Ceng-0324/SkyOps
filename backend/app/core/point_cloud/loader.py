"""点云加载器。

从文件或数据流加载点云数据。
"""

from pathlib import Path

import numpy as np
import open3d as o3d

from app.core.models.common import DataSourceType
from app.core.models.point_cloud import PointCloud


class PointCloudLoadError(Exception):
    """点云加载错误。"""

    pass


def load_point_cloud_from_file(
    file_path: str | Path,
    source: DataSourceType = DataSourceType.MOCK,
) -> PointCloud:
    """从文件加载点云数据。

    Args:
        file_path: .pcd 或其他支持格式的文件路径
        source: 数据来源标注

    Returns:
        PointCloud 实例

    Raises:
        PointCloudLoadError: 文件不存在或格式不支持
    """
    file_path = Path(file_path)

    if not file_path.exists():
        msg = f"Point cloud file not found: {file_path}"
        raise PointCloudLoadError(msg)

    try:
        # 使用 Open3D 加载点云
        pcd = o3d.io.read_point_cloud(str(file_path))

        if pcd.is_empty():
            msg = f"Point cloud file is empty: {file_path}"
            raise PointCloudLoadError(msg)

        # 提取点坐标
        points = np.asarray(pcd.points, dtype=np.float64)

        # 提取颜色（如果有）
        colors = None
        if pcd.has_colors():
            colors = np.asarray(pcd.colors, dtype=np.float64)

        return PointCloud(
            points=points,
            colors=colors,
            source=source,
        )

    except Exception as e:
        msg = f"Failed to load point cloud from {file_path}: {e}"
        raise PointCloudLoadError(msg) from e
