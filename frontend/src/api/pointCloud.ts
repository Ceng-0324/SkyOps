import { apiRequest } from "./client";
import type { DataSourceType } from "./mission";

/** Coordinates and extents are local Cartesian metres, not latitude/longitude. */
export type Vector3 = [number, number, number];

export type Obstacle = {
  id: string;
  position: Vector3;
  size: Vector3;
  confidence: number;
  obstacle_type: string;
};

export type ObstacleDetectionRequest = {
  point_cloud_file: string;
  height_threshold?: number;
  min_points?: number;
  cluster_tolerance?: number;
};

export type ObstacleDetectionResult = {
  obstacles: Obstacle[];
  detection_time: string;
  algorithm: string;
  source: DataSourceType;
};

export type ObstacleDetectionResponse = { result: ObstacleDetectionResult };

/** Detect a server-side PCD; omitted parameters use the backend defaults. */
export function detectObstacles(
  request: ObstacleDetectionRequest,
): Promise<ObstacleDetectionResponse> {
  return apiRequest<ObstacleDetectionResponse>("/point-cloud/detect-obstacles", {
    method: "POST",
    body: request,
  });
}
