"""从共享模拟场景定义生成可复现 PCD，不代表影像重建或实测坐标。"""

import json
from itertools import product
from math import ceil
from pathlib import Path

SCENE_PATH = Path(__file__).with_name("mock-campus.json")


def generate_pcd() -> str:
    """采样三个包围盒的棱，保持连通并保留设定的几何边界。"""
    scene = json.loads(SCENE_PATH.read_text())
    scale = scene["metres_per_pixel"]
    ox, oy = scene["image_origin_px"]
    points: set[tuple[float, float, float]] = set()
    for obstacle in scene["obstacles"]:
        left, top, right, bottom = obstacle["image_bounds_px"]
        bounds = [
            ((left - ox) * scale, (right - ox) * scale),
            ((oy - bottom) * scale, (oy - top) * scale),
            (obstacle["base_m"], obstacle["base_m"] + obstacle["height_m"]),
        ]
        for axis in range(3):
            other = [i for i in range(3) if i != axis]
            low, high = bounds[axis]
            steps = max(1, ceil(high - low))
            for ends in product((0, 1), repeat=2):
                for step in range(steps + 1):
                    point = [0.0, 0.0, 0.0]
                    point[axis] = low + (high - low) * step / steps
                    for i, end in zip(other, ends, strict=True):
                        point[i] = bounds[i][end]
                    points.add(tuple(round(v, 6) for v in point))
    rows = [" ".join(f"{v:.6f}" for v in p) for p in sorted(points)]
    return (
        "# Mock campus: synthetic box edges, simulated image registration only\n"
        "VERSION .7\nFIELDS x y z\nSIZE 4 4 4\nTYPE F F F\nCOUNT 1 1 1\n"
        f"WIDTH {len(rows)}\nHEIGHT 1\nVIEWPOINT 0 0 0 1 0 0 0\n"
        f"POINTS {len(rows)}\nDATA ascii\n" + "\n".join(rows) + "\n"
    )


if __name__ == "__main__":
    SCENE_PATH.with_suffix(".pcd").write_text(generate_pcd())
