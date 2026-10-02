"""受控文件加载、PCD 真实解析、来源和资源界限。"""

import os
from pathlib import Path

import numpy as np
import pytest

from app.core.models.common import DataSourceType
from app.core.point_cloud.loader import (
    PointCloudAccessError,
    PointCloudLoadError,
    PointCloudNotFoundError,
    PointCloudTooLargeError,
    load_point_cloud_from_file,
)


@pytest.mark.parametrize("source", list(DataSourceType))
def test_load_pcd_and_source(pcd_file: Path, source: DataSourceType) -> None:
    """成功加载必须证明坐标、来源和时间戳完整。"""
    cloud = load_point_cloud_from_file(pcd_file.name, source, data_dir=pcd_file.parent)
    assert cloud.points.shape == (20, 3)
    assert cloud.points[10] == pytest.approx([100, 0, 2])
    assert cloud.source == source
    assert cloud.timestamp.tzinfo is not None
    assert cloud.colors is None


@pytest.mark.parametrize("encoding", ["ascii", "binary", "binary_compressed"])
def test_load_colors_and_encodings(tmp_path: Path, encoding: str) -> None:
    """由 Open3D 写入有效 PCD，再经过完整 loader 读取。"""
    import open3d as o3d

    pcd = o3d.geometry.PointCloud()
    pcd.points = o3d.utility.Vector3dVector(np.array([[0, 0, 2], [1, 1, 3]]))
    pcd.colors = o3d.utility.Vector3dVector(np.array([[1, 0, 0], [0, 1, 0]]))
    path = tmp_path / "colored.pcd"
    assert o3d.io.write_point_cloud(
        str(path), pcd, write_ascii=encoding == "ascii", compressed=encoding == "binary_compressed"
    )
    cloud = load_point_cloud_from_file(path, data_dir=tmp_path)
    np.testing.assert_allclose(cloud.points, np.asarray(pcd.points))
    np.testing.assert_allclose(cloud.colors, np.asarray(pcd.colors))


def test_load_nonexistent_file_raises_error(tmp_path: Path) -> None:
    """不存在与格式损坏具有不同错误类型。"""
    with pytest.raises(PointCloudNotFoundError, match="not found"):
        load_point_cloud_from_file("nonexistent.pcd", data_dir=tmp_path)


@pytest.mark.parametrize("kind", ["absolute", "traversal", "symlink"])
def test_rejects_outside_paths(pcd_file: Path, kind: str) -> None:
    """绝对路径、父目录跳转和链接均不能越过配置根目录。"""
    root = pcd_file.parent / "allowed"
    root.mkdir()
    if kind == "absolute":
        path = pcd_file
    elif kind == "traversal":
        path = Path("../scene.pcd")
    else:
        path = root / "link.pcd"
        path.symlink_to(pcd_file)
    with pytest.raises(PointCloudAccessError):
        load_point_cloud_from_file(path, data_dir=root)


def test_allows_in_root_symlink(pcd_file: Path) -> None:
    """根内链接可以读取，权限按解析后的实际路径判断。"""
    link = pcd_file.parent / "link.pcd"
    link.symlink_to(pcd_file)
    assert len(load_point_cloud_from_file(link, data_dir=pcd_file.parent).points) == 20


@pytest.mark.parametrize("kind", ["directory", "fifo"])
def test_rejects_special_files(tmp_path: Path, kind: str) -> None:
    """普通文件校验不需要 FIFO 写入端。"""
    path = tmp_path / "special.pcd"
    if kind == "fifo":
        os.mkfifo(path)
    else:
        path.mkdir()
    with pytest.raises(PointCloudLoadError, match="regular file"):
        load_point_cloud_from_file(path, data_dir=tmp_path)


@pytest.mark.parametrize("limit", ["bytes", "points"])
def test_limits_before_parsing(pcd_file: Path, limit: str) -> None:
    """在 Open3D 原生分配内存之前拒绝超限数据。"""
    kwargs = {"max_file_bytes": 10} if limit == "bytes" else {"max_points": 19}
    with pytest.raises(PointCloudTooLargeError):
        load_point_cloud_from_file(pcd_file, data_dir=pcd_file.parent, **kwargs)


@pytest.mark.parametrize("contents", [b"", b"not a PCD", b"DATA ascii\n"])
def test_rejects_invalid_format(tmp_path: Path, contents: bytes) -> None:
    """空文件和不完整头部不能成为空场景。"""
    path = tmp_path / "invalid.pcd"
    path.write_bytes(contents)
    with pytest.raises(PointCloudLoadError, match="Invalid PCD"):
        load_point_cloud_from_file(path, data_dir=tmp_path)


@pytest.mark.parametrize("value", ["nan", "inf", "-inf", "invalid"])
def test_rejects_invalid_coordinate_tokens(pcd_file: Path, value: str) -> None:
    """真实 PCD 混入非有限值或坏 token 时拒绝整个输入。"""
    pcd_file.write_text(pcd_file.read_text().replace("0.0 0 2", f"{value} 0 2", 1))
    with pytest.raises(PointCloudLoadError):
        load_point_cloud_from_file(pcd_file, data_dir=pcd_file.parent)


def test_declared_allocation_limit(pcd_file: Path) -> None:
    """很小的文件也可能用头部声明极大的原生分配。"""
    pcd_file.write_text(
        pcd_file.read_text()
        .replace("COUNT 1 1 1", "COUNT 1 1 1 100000000")
        .replace("FIELDS x y z", "FIELDS x y z extra")
        .replace("SIZE 4 4 4", "SIZE 4 4 4 4")
        .replace("TYPE F F F", "TYPE F F F F")
    )
    with pytest.raises(PointCloudTooLargeError, match="Decoded"):
        load_point_cloud_from_file(pcd_file, data_dir=pcd_file.parent)


@pytest.mark.parametrize("damage", ["declared_size", "compressed_stream"])
def test_rejects_damaged_compressed_pcd(pcd_file: Path, damage: str) -> None:
    """压缩大小异常及原生解压失败都不能返回成功点云。"""
    import open3d as o3d

    cloud = o3d.io.read_point_cloud(str(pcd_file))
    assert o3d.io.write_point_cloud(str(pcd_file), cloud, compressed=True)
    header, body = pcd_file.read_bytes().split(b"DATA binary_compressed\n", 1)
    if damage == "declared_size":
        body = body[:4] + b"\xff" * 4 + body[8:]
    else:
        body = body[:8] + b"\xff" * (len(body) - 8)
    pcd_file.write_bytes(header + b"DATA binary_compressed\n" + body)
    with pytest.raises(PointCloudLoadError):
        load_point_cloud_from_file(pcd_file, data_dir=pcd_file.parent)
