import { mockCampus } from "./mockCampus";
import type { ObstacleDetectionRequest } from "../../api/pointCloud";

/** Persist only editable settings; results must be detected again after reload. */
export type SceneInput = {
  dataset: "campus" | "demo" | "server";
  file: string;
  height: string;
  minPoints: string;
  tolerance: string;
};
export function scenePreset(dataset: SceneInput["dataset"]): SceneInput {
  return dataset === "campus"
    ? { dataset, file: mockCampus.point_cloud_file, height: String(mockCampus.height_threshold), minPoints: String(mockCampus.min_points), tolerance: String(mockCampus.cluster_tolerance) }
    : { dataset, file: dataset === "demo" ? "demo.pcd" : "", height: "0.5", minPoints: "10", tolerance: "0.1" };
}
export const defaultSceneInput = scenePreset("campus");

export function isSceneInput(value: unknown): value is SceneInput {
  if (!value || typeof value !== "object") return false;
  const input = value as Record<string, unknown>;
  return (input.dataset === "campus" || input.dataset === "demo" || input.dataset === "server")
    && typeof input.file === "string" && input.file.length <= 1024
    && (input.dataset !== "demo" || input.file === "demo.pcd")
    && (input.dataset !== "campus" || input.file === mockCampus.point_cloud_file)
    && [input.height, input.minPoints, input.tolerance].every(v => typeof v === "string" && v.length <= 32);
}

export function sceneRequest(input: SceneInput): { request: ObstacleDetectionRequest; error: null } | { request: null; error: string } {
  if (!input.file.trim()) return { request: null, error: "请填写受控目录中的 PCD 文件路径。" };
  if (!input.height.trim() || !Number.isFinite(Number(input.height)) || Number(input.height) < 0)
    return { request: null, error: "高度阈值须为不小于 0 的有效数值。" };
  if (!input.minPoints.trim() || !Number.isSafeInteger(Number(input.minPoints)) || Number(input.minPoints) < 1)
    return { request: null, error: "最少点数须为可精确表示的正整数。" };
  if (!input.tolerance.trim() || !Number.isFinite(Number(input.tolerance)) || Number(input.tolerance) < 0.1)
    return { request: null, error: "聚类距离须为不小于 0.1 m 的有效数值。" };
  return { request: { point_cloud_file: input.file, height_threshold: Number(input.height), min_points: Number(input.minPoints), cluster_tolerance: Number(input.tolerance) }, error: null };
}

export const sceneStatusNames = { idle: "未检测", loading: "检测中", success: "检测完成", error: "检测失败" };
export const sceneSourceNames = { mock: "Mock · 模拟数据", simulated: "Simulated · 仿真数据", real: "Real · 实测数据" };
export function sceneNumber(value: number): string {
  return value !== 0 && (Math.abs(value) < 0.001 || Math.abs(value) >= 1e7)
    ? value.toExponential(3) : value.toLocaleString("zh-CN", { maximumFractionDigits: 6, useGrouping: false });
}
