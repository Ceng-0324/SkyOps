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

/** A valid HTTP/JSON envelope can still violate the point-cloud contract. */
export class PointCloudResponseError extends Error {
  constructor() {
    super("Invalid point-cloud response");
    this.name = "PointCloudResponseError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isVector3(value: unknown): value is Vector3 {
  return Array.isArray(value) && value.length === 3
    && value.every(item => typeof item === "number" && Number.isFinite(item));
}

function isObstacle(value: unknown): value is Obstacle {
  return isRecord(value) && isText(value.id)
    && isVector3(value.position) && isVector3(value.size)
    && value.size.every(extent => extent >= 0)
    && typeof value.confidence === "number" && Number.isFinite(value.confidence)
    && value.confidence >= 0 && value.confidence <= 1
    && isText(value.obstacle_type);
}

function isDetectionResponse(value: unknown): value is ObstacleDetectionResponse {
  if (!isRecord(value) || !isRecord(value.result)) return false;
  const result = value.result;
  return Array.isArray(result.obstacles) && result.obstacles.every(isObstacle)
    && new Set(result.obstacles.map(obstacle => obstacle.id)).size === result.obstacles.length
    && (result.source === "mock" || result.source === "simulated" || result.source === "real")
    && isText(result.algorithm) && isText(result.detection_time)
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(result.detection_time)
    && Number.isFinite(Date.parse(result.detection_time));
}

/** Detect a server-side PCD and validate unknown network data before exposing it. */
export async function detectObstacles(
  request: ObstacleDetectionRequest,
): Promise<ObstacleDetectionResponse> {
  const response = await apiRequest<unknown>("/point-cloud/detect-obstacles", {
    method: "POST",
    body: request,
  });
  if (!isDetectionResponse(response)) throw new PointCloudResponseError();
  return response;
}
