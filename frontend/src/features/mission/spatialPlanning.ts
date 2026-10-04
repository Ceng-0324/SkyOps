import type { PlanningGeometry, Strategy } from "../../api/candidates";
import type { SpatialTaskDraft } from "./spatialTaskDraft";
import { imageToMockLocal, isMockCampus, mockCampus } from "../environment/mockCampus";
import type { SceneInput } from "../environment/sceneInput";

export const strategyNames: Record<Strategy, string> = { coverage: "全面覆盖", focused_observation: "重点观察", supplementary_capture: "补充采集" };
export const strategyDescriptions: Record<Strategy, string> = {
  coverage: "访问全部任务样本，完整复查目标。", focused_observation: "优先处理重点任务及前置任务，再复查其余位置。", supplementary_capture: "跳过已声明完成的任务，访问剩余样本。",
};
export const candidateStatusNames = { feasible: "可行草案", infeasible: "不可行", budget_exceeded: "计算预算耗尽", no_remaining_tasks: "无剩余任务" };
export const defaultPlanningSettings = { ceiling: "120", origin: "0", resolution: "8", clearance: "1", speed: "5", dwell: "5" };
export type PlanningSettings = typeof defaultPlanningSettings;
export const planningFields: { key: keyof PlanningSettings; label: string; min: number; max: number }[] = [
  { key: "ceiling", label: "规划高度上界 / m", min: 0.1, max: 10000 },
  { key: "origin", label: "局部零点基准高度 / m", min: -10000, max: 10000 },
  { key: "resolution", label: "网格分辨率 / m", min: 0.1, max: 100 },
  { key: "clearance", label: "障碍膨胀距离 / m", min: 0, max: 100 },
  { key: "speed", label: "巡航速度 / m/s", min: 0.1, max: 30 },
  { key: "dwell", label: "样本停留时间 / s", min: 0, max: 600 },
];

/** Only the explicitly paired mock campus permits pixel-to-metre conversion. */
export function prepareSpatialPlanning(spatial: SpatialTaskDraft, scene: SceneInput, settings: PlanningSettings): { geometry: PlanningGeometry | null; reasons: string[] } {
  const reasons: string[] = [];
  if (!isMockCampus(scene)) reasons.push("当前点云未与任务影像配对，请在场景页选择建筑巡检演示。");
  if (!spatial.bound) reasons.push("请先在任务页绑定作业对象 A。");
  if (!spatial.points.length) reasons.push("请在任务页设置观察点。");
  if (!spatial.start) reasons.push("请在任务页设置起点 / 返回点。");
  for (const field of planningFields) {
    const value = Number(settings[field.key]);
    if (!settings[field.key].trim() || !Number.isFinite(value) || value < field.min || value > field.max) reasons.push(`${field.label}须在 ${field.min}–${field.max} 之间。`);
  }
  if (reasons.length || !spatial.start) return { geometry: null, reasons };
  const ceiling = Number(settings.ceiling), resolution = Number(settings.resolution);
  const size = mockCampus.image_size_px * mockCampus.metres_per_pixel;
  const points = spatial.points.map(p => imageToMockLocal(p.x, p.y, p.z));
  const start = imageToMockLocal(spatial.start.x, spatial.start.y, spatial.start.z);
  if ([start, ...points].some(p => p[2] < 0 || p[2] > ceiling)) reasons.push("起点和观察点高度须位于 0 至规划高度上界之间，请返回任务页调整。");
  if (new Set(points.map(p => p.join(","))).size !== points.length) reasons.push("观察点坐标重复，请返回任务页调整。");
  if ((Math.ceil(size / resolution) + 1) ** 2 * (Math.ceil(ceiling / resolution) + 1) > 50000) reasons.push("规划网格超过 50,000 节点，请增大网格分辨率或降低规划高度上界。");
  return { reasons, geometry: reasons.length ? null : {
    coordinate_frame: "local_cartesian_m", source: "mock", bounds: { minimum: [0, 0, 0], maximum: [size, size, ceiling] },
    start, targets: [{ ref: "A", observation_points: points }], altitude_origin_m: Number(settings.origin),
    grid_resolution_m: resolution, clearance_m: Number(settings.clearance), cruise_speed_mps: Number(settings.speed), observation_seconds: Number(settings.dwell),
  } };
}

export function planDuration(seconds: number): string {
  const rounded = Math.round(seconds);
  return `${Math.floor(rounded / 60)}分${String(rounded % 60).padStart(2, "0")}秒`;
}
