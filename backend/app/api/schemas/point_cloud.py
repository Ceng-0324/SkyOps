"""点云处理相关的 API schemas。"""

from pydantic import BaseModel, Field

from app.core.models.point_cloud import ObstacleDetectionResult


class ObstacleDetectionRequest(BaseModel):
    """障碍物检测请求。"""

    point_cloud_file: str = Field(..., description="点云文件路径")
    height_threshold: float = Field(
        default=0.5, ge=0.0, description="高度阈值（米）"
    )
    min_points: int = Field(default=10, ge=1, description="最小点数")
    cluster_tolerance: float = Field(
        default=1.0, ge=0.1, description="聚类容差（米）"
    )


class ObstacleDetectionResponse(BaseModel):
    """障碍物检测响应。"""

    result: ObstacleDetectionResult = Field(..., description="检测结果")
