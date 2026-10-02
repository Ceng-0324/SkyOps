"""从受控目录读取有资源界限的 PCD 快照，再交给 Open3D 解析。"""

import os
import stat
import struct
from importlib import import_module
from io import BytesIO
from pathlib import Path
from tempfile import NamedTemporaryFile

import numpy as np
from pydantic import ValidationError

from app.core.config import DEFAULT_POINT_CLOUD_MAX_BYTES, DEFAULT_POINT_CLOUD_MAX_POINTS
from app.core.models.common import DataSourceType
from app.core.models.point_cloud import PointCloud


class PointCloudLoadError(Exception):
    """PCD 格式或文件类型不合法。"""


class PointCloudNotFoundError(PointCloudLoadError):
    """受控目录内的点云文件不存在。"""


class PointCloudAccessError(PointCloudLoadError):
    """路径越界或文件不可读。"""


class PointCloudTooLargeError(PointCloudLoadError):
    """文件大小、解压大小或点数超限。"""


class PointCloudUnavailableError(Exception):
    """点云原生运行依赖不可用。"""


def load_point_cloud_from_file(
    file_path: str | Path,
    source: DataSourceType = DataSourceType.MOCK,
    *,
    data_dir: Path,
    max_file_bytes: int = DEFAULT_POINT_CLOUD_MAX_BYTES,
    max_points: int = DEFAULT_POINT_CLOUD_MAX_POINTS,
) -> PointCloud:
    """加载受控目录内的 ASCII、binary 或 binary_compressed PCD。

    相对路径以 data_dir 为根；绝对路径和符号链接解析后仍必须位于根内。
    文件先按大小上限读为快照，再预检头部/载荷，避免原生解析器根据恶意
    头部分配任意内存。不存在、越界、超限和无效格式分别抛出专用异常。
    """
    if max_file_bytes < 1 or max_points < 1:
        raise ValueError("Point cloud resource limits must be positive")
    data = _read_snapshot(file_path, data_dir, max_file_bytes)
    count = _validate_pcd(data, max_file_bytes, max_points)

    try:
        o3d = import_module("open3d")
    except (ImportError, OSError) as exc:
        raise PointCloudUnavailableError("Point cloud runtime is unavailable") from exc

    try:
        with NamedTemporaryFile(suffix=".pcd") as snapshot:
            snapshot.write(data)
            snapshot.flush()
            pcd = o3d.io.read_point_cloud(
                snapshot.name, remove_nan_points=False, remove_infinite_points=False
            )
        if len(pcd.points) != count:
            raise PointCloudLoadError("PCD parser did not return the declared point count")
        return PointCloud(
            points=np.asarray(pcd.points, dtype=np.float64),
            colors=np.asarray(pcd.colors, dtype=np.float64) if pcd.has_colors() else None,
            source=source,
        )
    except ValidationError as exc:
        raise PointCloudLoadError("PCD contains invalid coordinates or colors") from exc
    except RuntimeError as exc:
        raise PointCloudLoadError("PCD could not be parsed") from exc


def _read_snapshot(file_path: str | Path, data_dir: Path, limit: int) -> bytes:
    try:
        root = data_dir.resolve()
        path = Path(file_path)
        path = (path if path.is_absolute() else root / path).resolve()
        if not path.is_relative_to(root):
            raise PointCloudAccessError("Point cloud path is outside the configured data directory")
        if path.suffix.lower() != ".pcd":
            raise PointCloudLoadError("Only .pcd files are supported")
        # 非阻塞打开避免 FIFO 在文件类型检查之前挂住；不跟随竞态替换的末级链接。
        descriptor = os.open(path, os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW)
        try:
            metadata = os.fstat(descriptor)
            if not stat.S_ISREG(metadata.st_mode):
                raise PointCloudLoadError("Point cloud input must be a regular file")
            if metadata.st_size > limit:
                raise PointCloudTooLargeError("Point cloud file exceeds the byte limit")
            with os.fdopen(descriptor, "rb", closefd=False) as stream:
                data = stream.read(limit + 1)
        finally:
            os.close(descriptor)
        if len(data) > limit:
            raise PointCloudTooLargeError("Point cloud file exceeds the byte limit")
        return data
    except FileNotFoundError as exc:
        raise PointCloudNotFoundError("Point cloud file not found") from exc
    except (OSError, RuntimeError, ValueError) as exc:
        raise PointCloudAccessError("Point cloud path cannot be accessed") from exc


def _validate_pcd(data: bytes, byte_limit: int, point_limit: int) -> int:
    """验证分配规模和载荷完整性，不能依赖解析后的点数检查。"""
    stream = BytesIO(data)
    header: dict[str, list[str]] = {}
    try:
        while stream.tell() < 65_536:
            line = stream.readline(8193)
            if not line or len(line) > 8192:
                raise ValueError("missing or oversized header")
            parts = line.decode("ascii").split()
            if not parts or parts[0].startswith("#"):
                continue
            key, values = parts[0].upper(), parts[1:]
            if key in header:
                raise ValueError("duplicate header field")
            header[key] = values
            if key == "DATA":
                break
        else:
            raise ValueError("oversized header")

        fields = header["FIELDS"]
        sizes = [int(value) for value in header["SIZE"]]
        types = header["TYPE"]
        counts = [int(value) for value in header.get("COUNT", ["1"] * len(fields))]
        if not (3 <= len(fields) <= 64 and len(fields) == len(set(fields))):
            raise ValueError("invalid fields")
        if not (len(sizes) == len(types) == len(counts) == len(fields)):
            raise ValueError("field metadata mismatch")
        if any(size not in {1, 2, 4, 8} for size in sizes) or any(n < 1 for n in counts):
            raise ValueError("invalid field size/count")
        if any(kind not in {"F", "I", "U"} for kind in types):
            raise ValueError("invalid field type")
        if any(kind == "F" and size not in {4, 8} for kind, size in zip(types, sizes, strict=True)):
            raise ValueError("invalid floating point size")
        if any(counts[fields.index(axis)] != 1 for axis in ("x", "y", "z")):
            raise ValueError("invalid coordinates")
        for key in ("WIDTH", "HEIGHT", "POINTS", "DATA"):
            if len(header[key]) != 1:
                raise ValueError("invalid scalar header")
        count = int(header["POINTS"][0])
        width, height = int(header["WIDTH"][0]), int(header["HEIGHT"][0])
        if count < 1 or width < 1 or height < 1 or width * height != count:
            raise ValueError("invalid dimensions")
        if count > point_limit:
            raise PointCloudTooLargeError("Point cloud exceeds the point limit")
        decoded_size = count * sum(size * n for size, n in zip(sizes, counts, strict=True))
        if decoded_size > byte_limit:
            raise PointCloudTooLargeError("Decoded point cloud exceeds the byte limit")
        body = stream.read()
        encoding = header["DATA"][0]
        if encoding == "ascii":
            rows = [row.split() for row in body.splitlines() if row.strip()]
            if len(rows) != count or any(len(row) != sum(counts) for row in rows):
                raise ValueError("ASCII payload dimensions do not match header")
            # 解析器可能容忍坏 token；预先拒绝，避免把损坏的坐标读成零。
            values = np.asarray(rows, dtype=np.float64)
            offsets = np.cumsum([0, *counts[:-1]])
            coordinates = values[:, [offsets[fields.index(axis)] for axis in ("x", "y", "z")]]
            if not np.isfinite(coordinates).all():
                raise ValueError("non-finite coordinates")
        elif encoding == "binary":
            if len(body) != decoded_size:
                raise ValueError("binary payload size does not match header")
        elif encoding == "binary_compressed":
            compressed, uncompressed = struct.unpack("<II", body[:8])
            if compressed != len(body) - 8 or uncompressed != decoded_size:
                raise ValueError("compressed payload size does not match header")
        else:
            raise ValueError("unsupported PCD encoding")
    except (KeyError, ValueError, UnicodeError, struct.error) as exc:
        raise PointCloudLoadError("Invalid PCD header or payload") from exc
    return count
