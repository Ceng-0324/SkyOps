"""独立构造 PCD，验证原生解析器的坐标类型边界，不使用 Open3D writer。"""

import struct
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.core.point_cloud import loader
from app.core.point_cloud.loader import PointCloudLoadError, load_point_cloud_from_file

ENDPOINT = "/point-cloud/detect-obstacles"
FORMATS = {
    ("F", 4): "f",
    ("F", 8): "d",
    ("I", 1): "b",
    ("I", 2): "h",
    ("I", 4): "i",
    ("I", 8): "q",
    ("U", 1): "B",
    ("U", 2): "H",
    ("U", 4): "I",
    ("U", 8): "Q",
}


def _write_pcd(
    path: Path,
    encoding: str,
    fields: list[tuple[str, str, int]],
    values: list[int | float],
) -> None:
    """手工写入十个重复点；压缩格式使用合法的 LZF literal 块和按字段布局。"""
    header = (
        "# Synthetic mock data; independently encoded review regression\nVERSION 0.7\n"
        f"FIELDS {' '.join(name for name, _, _ in fields)}\n"
        f"SIZE {' '.join(str(size) for _, _, size in fields)}\n"
        f"TYPE {' '.join(kind for _, kind, _ in fields)}\n"
        f"COUNT {' '.join('1' for _ in fields)}\n"
        f"WIDTH 10\nHEIGHT 1\nPOINTS 10\nDATA {encoding}\n"
    ).encode("ascii")
    if encoding == "ascii":
        body = (" ".join(str(value) for value in values) + "\n").encode("ascii") * 10
    elif encoding == "binary":
        format_string = "<" + "".join(FORMATS[kind, size] for _, kind, size in fields)
        body = struct.pack(format_string, *values) * 10
    else:
        raw = b"".join(
            struct.pack("<" + FORMATS[kind, size], value) * 10
            for (_, kind, size), value in zip(fields, values, strict=True)
        )
        compressed = b"".join(
            bytes([len(raw[index : index + 32]) - 1]) + raw[index : index + 32]
            for index in range(0, len(raw), 32)
        )
        body = struct.pack("<II", len(compressed), len(raw)) + compressed
    path.write_bytes(header + body)


@pytest.mark.parametrize("encoding", ["binary", "binary_compressed"])
@pytest.mark.parametrize("kind", ["F", "I", "U"])
@pytest.mark.parametrize("axis", ["x", "y", "z", "all"])
def test_rejects_64_bit_coordinates_before_native_parsing(
    tmp_path: Path,
    point_cloud_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    encoding: str,
    kind: str,
    axis: str,
) -> None:
    """任一轴或全部轴使用 64 位都返回 400，拒绝发生在原生解析前。"""
    fields = [
        (name, kind, 8) if name == axis or axis == "all" else (name, "F", 4)
        for name in ("x", "y", "z")
    ]
    path = tmp_path / "unsupported.pcd"
    _write_pcd(path, encoding, fields, [100, 10, 2])
    with pytest.raises(PointCloudLoadError, match="Unsupported.*coordinate"):
        load_point_cloud_from_file(path, data_dir=tmp_path)

    def unexpected_import(name: str) -> None:
        pytest.fail("Unsupported coordinates reached the native parser")

    monkeypatch.setattr(loader, "import_module", unexpected_import)
    response = point_cloud_client.post(ENDPOINT, json={"point_cloud_file": path.name})
    assert response.status_code == 400
    assert "Unsupported" in response.json()["detail"]
    assert "result" not in response.json()


@pytest.mark.parametrize("encoding", ["binary", "binary_compressed"])
@pytest.mark.parametrize(
    "kind,size",
    [
        ("F", 4),
        ("I", 1),
        ("I", 2),
        ("I", 4),
        ("U", 1),
        ("U", 2),
        ("U", 4),
    ],
)
def test_supported_binary_coordinates_are_preserved(
    tmp_path: Path,
    point_cloud_client: TestClient,
    encoding: str,
    kind: str,
    size: int,
) -> None:
    """所有接受的二进制坐标组合都核对真实坐标及障碍，不能只数点。"""
    path = tmp_path / "supported.pcd"
    values = [100.25, 10.5, 2.75] if kind == "F" else [100, 10, 2]
    _write_pcd(path, encoding, [(axis, kind, size) for axis in ("x", "y", "z")], values)
    cloud = load_point_cloud_from_file(path, data_dir=tmp_path)
    np.testing.assert_array_equal(cloud.points, np.tile(values, (10, 1)))
    response = point_cloud_client.post(ENDPOINT, json={"point_cloud_file": path.name})
    assert response.status_code == 200
    obstacles = response.json()["result"]["obstacles"]
    assert len(obstacles) == 1
    assert obstacles[0]["position"] == values


@pytest.mark.parametrize("encoding", ["binary", "binary_compressed"])
def test_coordinate_checks_follow_names_and_allow_64_bit_auxiliary_fields(
    tmp_path: Path,
    point_cloud_client: TestClient,
    encoding: str,
) -> None:
    """重排坐标、混合类型和非坐标 64 位字段不能被整体 SIZE 黑名单误拒绝。"""
    path = tmp_path / "reordered.pcd"
    _write_pcd(
        path,
        encoding,
        [("intensity", "F", 8), ("z", "U", 2), ("x", "I", 4), ("y", "F", 4)],
        [123.5, 2, 100, 10.5],
    )
    cloud = load_point_cloud_from_file(path, data_dir=tmp_path)
    np.testing.assert_array_equal(cloud.points, np.tile([100, 10.5, 2], (10, 1)))
    response = point_cloud_client.post(ENDPOINT, json={"point_cloud_file": path.name})
    assert response.status_code == 200
    assert len(response.json()["result"]["obstacles"]) == 1


@pytest.mark.parametrize("kind", ["F", "I", "U"])
def test_ascii_64_bit_declarations_still_load(
    tmp_path: Path,
    point_cloud_client: TestClient,
    kind: str,
) -> None:
    """ASCII 文本解析不应套用 binary 的原生宽度限制。"""
    path = tmp_path / "ascii64.pcd"
    _write_pcd(path, "ascii", [(axis, kind, 8) for axis in ("x", "y", "z")], [100, 10, 2])
    cloud = load_point_cloud_from_file(path, data_dir=tmp_path)
    np.testing.assert_array_equal(cloud.points, np.tile([100, 10, 2], (10, 1)))
    response = point_cloud_client.post(ENDPOINT, json={"point_cloud_file": path.name})
    assert response.status_code == 200
    assert len(response.json()["result"]["obstacles"]) == 1
