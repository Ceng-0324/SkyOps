"""点云处理 API 路由。"""

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException

from app.api.schemas.point_cloud import (
    ObstacleDetectionRequest,
    ObstacleDetectionResponse,
)
from app.core.config import Settings, get_settings
from app.core.models.common import DataSourceType
from app.core.point_cloud import detect_obstacles, load_point_cloud_from_file
from app.core.point_cloud.loader import (
    PointCloudAccessError,
    PointCloudLoadError,
    PointCloudNotFoundError,
    PointCloudTooLargeError,
    PointCloudUnavailableError,
)

router = APIRouter(prefix="/point-cloud", tags=["point-cloud"])
logger = logging.getLogger(__name__)


@router.post(
    "/detect-obstacles",
    responses={
        400: {"description": "Invalid PCD, non-regular file, or clustering budget exceeded"},
        403: {"description": "Path is outside the configured directory or cannot be read"},
        404: {"description": "Point cloud file not found"},
        413: {"description": "File size, decoded size, or point count exceeds the limit"},
        500: {"description": "Detection failed"},
        503: {"description": "Open3D runtime unavailable"},
    },
)
def detect_obstacles_from_file(
    request: ObstacleDetectionRequest,
    settings: Annotated[Settings, Depends(get_settings)],
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
            data_dir=settings.point_cloud_data_dir,
            max_file_bytes=settings.point_cloud_max_bytes,
            max_points=settings.point_cloud_max_points,
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
    except PointCloudAccessError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except PointCloudNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PointCloudTooLargeError as exc:
        raise HTTPException(status_code=413, detail=str(exc)) from exc
    except (PointCloudLoadError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Point cloud detection failed")
        raise HTTPException(status_code=500, detail="Point cloud detection failed") from exc
