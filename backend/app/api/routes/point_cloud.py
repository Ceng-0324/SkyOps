"""点云处理 API 路由。"""

from fastapi import APIRouter, HTTPException

from app.api.schemas.point_cloud import (
    ObstacleDetectionRequest,
    ObstacleDetectionResponse,
)
from app.core.models.common import DataSourceType
from app.core.point_cloud import detect_obstacles, load_point_cloud_from_file
from app.core.point_cloud.loader import PointCloudLoadError, PointCloudUnavailableError

router = APIRouter(prefix="/point-cloud", tags=["point-cloud"])


@router.post("/detect-obstacles")
def detect_obstacles_from_file(
    request: ObstacleDetectionRequest,
) -> ObstacleDetectionResponse:
    """从点云文件中检测障碍物。

    Args:
        request: 障碍物检测请求

    Returns:
        障碍物检测响应

    Raises:
        HTTPException: 文件不存在或参数非法
    """
    try:
        # 加载点云
        point_cloud = load_point_cloud_from_file(
            file_path=request.point_cloud_file,
            source=DataSourceType.MOCK,
        )

        # 检测障碍物
        result = detect_obstacles(
            point_cloud=point_cloud,
            height_threshold=request.height_threshold,
            min_points=request.min_points,
            cluster_tolerance=request.cluster_tolerance,
        )

        return ObstacleDetectionResponse(result=result)

    except PointCloudUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except PointCloudLoadError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Internal server error: {exc}") from exc
