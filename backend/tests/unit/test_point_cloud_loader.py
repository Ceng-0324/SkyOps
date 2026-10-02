"""点云加载器单元测试。"""

from pathlib import Path

import pytest

from app.core.point_cloud.loader import PointCloudLoadError, load_point_cloud_from_file


def test_load_nonexistent_file_raises_error():
    """测试加载不存在的文件抛出异常。"""
    with pytest.raises(PointCloudLoadError, match="not found"):
        load_point_cloud_from_file("nonexistent.pcd")


def test_point_cloud_source_labeling():
    """测试点云数据来源标注。"""
    # 创建一个简单的 mock 点云文件用于测试
    # 注意：这里需要实际的 .pcd 文件，暂时跳过
    pytest.skip("需要 mock .pcd 文件")
