"""点云和障碍物数据模型。"""

from datetime import UTC, datetime

import numpy as np
from numpy.typing import NDArray
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.core.models.common import DataSourceType


class PointCloud(BaseModel):
    """三维点云数据。

    Attributes:
        points: N×3 数组，每行为 [x, y, z] 坐标
        colors: N×3 数组，每行为 [r, g, b] 颜色（可选）
        source: 数据来源标注
        timestamp: 采集时间
    """

    model_config = ConfigDict(arbitrary_types_allowed=True, revalidate_instances="always")

    points: NDArray[np.float64] = Field(..., description="点云坐标数组 (N×3)")
    colors: NDArray[np.float64] | None = Field(None, description="点云颜色数组 (N×3)")
    source: DataSourceType = Field(default=DataSourceType.MOCK, description="数据来源")
    timestamp: datetime = Field(default_factory=lambda: datetime.now(UTC), description="采集时间")

    @field_validator("points", "colors")
    @classmethod
    def validate_array(cls, value: NDArray[np.float64] | None) -> NDArray[np.float64] | None:
        """保留独立的有限 N×3 实数数组，拒绝隐式丢弃坏点。"""
        if value is None:
            return None
        if value.ndim != 2 or value.shape[1] != 3 or value.dtype.kind not in "fiu":
            raise ValueError("Point cloud arrays must have shape (N, 3) and real numeric values")
        result = np.array(value, dtype=np.float64, copy=True)
        if not np.isfinite(result).all():
            raise ValueError("Point cloud arrays must contain only finite values")
        return result

    @model_validator(mode="after")
    def validate_colors(self) -> "PointCloud":
        """验证颜色与点一一对应且处于归一化范围。"""
        if self.colors is not None:
            if self.colors.shape != self.points.shape:
                raise ValueError("Colors must match the point coordinates")
            if np.any((self.colors < 0) | (self.colors > 1)):
                raise ValueError("Colors must be between 0 and 1")
        return self


class Obstacle(BaseModel):
    """检测到的障碍物。

    Attributes:
        id: 唯一标识符
        position: 障碍物中心位置 [x, y, z]
        size: 障碍物尺寸 [width, depth, height]
        confidence: 检测置信度 (0-1)
        obstacle_type: 障碍物类型
    """

    model_config = ConfigDict(allow_inf_nan=False)

    id: str = Field(..., description="障碍物ID")
    position: tuple[float, float, float] = Field(..., description="中心位置 [x, y, z]")
    size: tuple[float, float, float] = Field(..., description="尺寸 [width, depth, height]")
    confidence: float = Field(..., ge=0.0, le=1.0, description="检测置信度")
    obstacle_type: str = Field(default="unknown", description="障碍物类型")


class ObstacleDetectionResult(BaseModel):
    """障碍物检测结果。

    Attributes:
        obstacles: 检测到的障碍物列表
        detection_time: 检测时间
        algorithm: 使用的检测算法
        source: 输入点云的数据来源（空结果也保留）
    """

    obstacles: list[Obstacle] = Field(default_factory=list, description="障碍物列表")
    detection_time: datetime = Field(
        default_factory=lambda: datetime.now(UTC), description="检测时间"
    )
    algorithm: str = Field(default="unknown", description="检测算法名称")
    source: DataSourceType = Field(..., description="输入点云的数据来源")
