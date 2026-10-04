import type { TaskNode } from "../../api/task";
import type { MissionDraft } from "./missionDrafts";

export type MapPoint = { id: string; number: number; x: number; y: number; z: number };
export type SpatialTaskDraft = {
  version: 1;
  coordinateFrame: "reference_image_px";
  bound: boolean;
  points: MapPoint[];
  start: MapPoint | null;
  nextNumber: number;
  inputMode: "text" | "fields";
  action: TaskNode["action"];
  completion: string;
};
export const actionNames: Record<TaskNode["action"], string> = { inspect: "巡检", patrol: "巡逻", capture: "拍摄", survey: "测绘" };

export function initialSpatialDraft(draft: MissionDraft): SpatialTaskDraft {
  return draft.spatial ?? {
    version: 1, coordinateFrame: "reference_image_px", bound: false, points: [], start: null, nextNumber: 1,
    inputMode: "text", action: draft.template === "campus" ? "patrol" : draft.template === "mapping" ? "survey" : "inspect",
    completion: draft.completion,
  };
}

export function isMapPoint(value: unknown): value is MapPoint {
  if (typeof value !== "object" || value === null) return false;
  const p = value as Record<string, unknown>;
  return typeof p.id === "string" && p.id.length > 0 && p.id.length <= 80
    && Number.isSafeInteger(p.number) && Number(p.number) >= 0
    && typeof p.x === "number" && Number.isFinite(p.x) && p.x >= 0 && p.x <= 1280
    && typeof p.y === "number" && Number.isFinite(p.y) && p.y >= 0 && p.y <= 1280
    && typeof p.z === "number" && Number.isFinite(p.z) && p.z >= -10000 && p.z <= 10000;
}

export function isSpatialTaskDraft(value: unknown): value is SpatialTaskDraft {
  if (typeof value !== "object" || value === null) return false;
  const d = value as Record<string, unknown>;
  return d.version === 1 && d.coordinateFrame === "reference_image_px" && typeof d.bound === "boolean"
    && Array.isArray(d.points) && d.points.length <= 16 && d.points.every(isMapPoint)
    && d.points.every(p => p.id !== "start" && p.number > 0)
    && new Set(d.points.map(p => p.id)).size === d.points.length
    && new Set(d.points.map(p => p.number)).size === d.points.length
    && (d.start === null || (isMapPoint(d.start) && d.start.id === "start" && d.start.number === 0))
    && (d.bound || (d.points.length === 0 && d.start === null))
    && Number.isSafeInteger(d.nextNumber) && Number(d.nextNumber) > Math.max(0, ...d.points.map(p => p.number))
    && (d.inputMode === "text" || d.inputMode === "fields")
    && typeof d.action === "string" && Object.hasOwn(actionNames, d.action)
    && typeof d.completion === "string" && d.completion.length <= 1024;
}

/** Only explicit fields enter the DSL. Image pixels never become planning metres. */
export function taskInputFor(spatial: SpatialTaskDraft, rawInput: string): string {
  if (spatial.inputMode === "text") return rawInput;
  return JSON.stringify({ version: 1, nodes: [{
    id: "task-001", action: spatial.action,
    target: spatial.bound ? { kind: "object", label: "示例建筑 A", refs: ["A"] } : null,
    completion_conditions: spatial.completion.trim() ? [spatial.completion.trim()] : [],
    parent_id: null, depends_on: [],
  }] });
}

export function addMapPoint(state: SpatialTaskDraft, kind: "observation" | "start", x: number, y: number): SpatialTaskDraft {
  if (!state.bound || !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1280 || y < 0 || y > 1280) return state;
  if (kind === "start") return { ...state, start: { id: "start", number: 0, x, y, z: 0 } };
  if (state.points.length >= 16) return state;
  return { ...state, nextNumber: state.nextNumber + 1, points: [...state.points,
    { id: `p${state.nextNumber}`, number: state.nextNumber, x, y, z: 30 }] };
}

export function moveMapPoint(state: SpatialTaskDraft, id: string, change: Partial<Pick<MapPoint, "x" | "y" | "z">>): SpatialTaskDraft {
  const existing = id === "start" ? state.start : state.points.find(p => p.id === id);
  if (!existing) return state;
  const next = { ...existing, ...change };
  if (!isMapPoint(next)) return state;
  return id === "start" ? { ...state, start: next } : { ...state, points: state.points.map(p => p.id === id ? next : p) };
}
