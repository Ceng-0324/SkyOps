"""点云和障碍物数据模型。"""

from datetime import datetime
from typing import Literal

import numpy as np
from numpy.typing import NDArray
from pydantic import BaseModel, Field


class PointCloud(BaseModel):
    """三维点云数据。

    Attributes:
        points: N×3 数组，每行为 [x, y, z] 坐标
        colors: N×3 数组，每行为 [r, g, b] 颜色（可选）
        source: 数据来源标注
        timestamp: 采集时间
    """

    points: NDArray[np.float64] = Field(..., description="点云坐标数组 (N×3)")
    colors: NDArray[np.float64] | None = Field(
        None, description="点云颜色数组 (N×3)"
    )
    source: Literal["mock", "simulated", "real"] = Field(
        default="mock", description="数据来源"
    )
    timestamp: datetime = Field(default_factory=datetime.now, description="采集时间")

    class Config:
        arbitrary_types_allowed = True


class Obstacle(BaseModel):
    """检测到的障碍物。

    Attributes:
        id: 唯一标识符
        position: 障碍物中心位置 [x, y, z]
        size: 障碍物尺寸 [width, depth, height]
        confidence: 检测置信度 (0-1)
        obstacle_type: 障碍物类型
    """

    id: str = Field(..., description="障碍物ID")
    position: tuple[float, float, float] = Field(..., description="中心位置 [x, y, z]")
    size: tuple[float, float, float] = Field(
        ..., description="尺寸 [width, depth, height]"
    )
    confidence: float = Field(..., ge=0.0, le=1.0, description="检测置信度")
    obstacle_type: str = Field(default="unknown", description="障碍物类型")


class ObstacleDetectionResult(BaseModel):
    """障碍物检测结果。

    Attributes:
        obstacles: 检测到的障碍物列表
        detection_time: 检测时间
        algorithm: 使用的检测算法
    """

    obstacles: list[Obstacle] = Field(default_factory=list, description="障碍物列表")
    detection_time: datetime = Field(
        default_factory=datetime.now, description="检测时间"
    )
    algorithm: str = Field(default="unknown", description="检测算法名称")
