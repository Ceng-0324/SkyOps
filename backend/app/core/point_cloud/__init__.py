"""点云处理模块。

提供点云加载、障碍物检测等功能。
"""

from app.core.point_cloud.detector import detect_obstacles
from app.core.point_cloud.loader import load_point_cloud_from_file

__all__ = ["detect_obstacles", "load_point_cloud_from_file"]
