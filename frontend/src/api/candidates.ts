import { apiRequest } from "./client";
import type { DataSourceType } from "./mission";
import type { ObstacleDetectionResult, Vector3 } from "./pointCloud";
import { isRecord, isSource, isStringList, isTaskTree, type TaskTree } from "./task";

export const strategies = ["coverage", "focused_observation", "supplementary_capture"] as const;
export type Strategy = typeof strategies[number];
export type Bounds = { minimum: Vector3; maximum: Vector3 };
export type PlanningGeometry = {
  coordinate_frame: "local_cartesian_m";
  source: "mock" | "simulated";
  bounds: Bounds;
  start: Vector3;
  altitude_origin_m: number | null;
  targets: { ref: string; observation_points: Vector3[] }[];
  grid_resolution_m: number;
  clearance_m: number;
  cruise_speed_mps: number;
  observation_seconds: number;
};
export type PlanningScene = PlanningGeometry & { obstacle_detection: ObstacleDetectionResult };
export type CandidateRequest = {
  raw_user_input: string;
  scenario_id: string;
  scene: PlanningScene;
  priority_task_ids: string[];
  completed_task_ids: string[];
};
export type Candidate = {
  strategy: Strategy;
  status: "feasible" | "infeasible" | "no_remaining_tasks" | "budget_exceeded";
  task_order: string[];
  visits: { task_id: string; target_ref: string; sample_index: number; position: Vector3 }[];
  assumed_completed_task_ids: string[];
  path: { points: Vector3[]; distance_m: number } | null;
  score: {
    sample_coverage_percent: number;
    estimated_duration_seconds: number;
    proximity_risk: number;
    time_score: number;
    total: number;
  } | null;
  reasons: string[];
  equivalent_to: Strategy | null;
  execution_authorized: false;
};
export type CandidateResult = {
  status: "candidates" | "needs_clarification" | "blocked" | "no_feasible_plan";
  task_tree: TaskTree;
  rule_evaluation: { passed: boolean; checks: { rule_id: string; passed: boolean; reason: string; evidence: string[] }[] };
  scenario_id: string;
  rule_sources: Record<string, DataSourceType>;
  candidates: Candidate[];
  clarifications: string[];
  reasons: string[];
  recommended_strategy: Strategy | null;
  scene: PlanningScene;
  effective_bounds: Bounds | null;
  source: "simulated";
  execution_authorized: false;
  limitations: string[];
};

function finite(value: unknown, minimum = -Infinity, maximum = Infinity): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}
function vector(value: unknown): value is Vector3 {
  return Array.isArray(value) && value.length === 3 && value.every(v => finite(v));
}
function bounds(value: unknown): value is Bounds {
  return isRecord(value) && vector(value.minimum) && vector(value.maximum)
    && value.minimum.every((v, i) => v < (value.maximum as Vector3)[i]);
}
function strategy(value: unknown): value is Strategy {
  return strategies.some(s => s === value);
}
function candidate(value: unknown): value is Candidate {
  if (!isRecord(value) || !strategy(value.strategy)
    || !["feasible", "infeasible", "no_remaining_tasks", "budget_exceeded"].includes(String(value.status))
    || value.execution_authorized !== false || !isStringList(value.task_order)
    || !isStringList(value.assumed_completed_task_ids) || !isStringList(value.reasons)
    || !(value.equivalent_to === null || strategy(value.equivalent_to))
    || !Array.isArray(value.visits) || !value.visits.every(v => isRecord(v)
      && typeof v.task_id === "string" && typeof v.target_ref === "string"
      && finite(v.sample_index, 0) && Number.isInteger(v.sample_index) && vector(v.position))) return false;
  if (value.status !== "feasible") return value.path === null && value.score === null;
  const { path, score } = value;
  return isRecord(path) && Array.isArray(path.points) && path.points.length > 0
    && path.points.every(vector) && finite(path.distance_m, 0)
    && isRecord(score) && finite(score.sample_coverage_percent, 0, 100)
    && finite(score.estimated_duration_seconds, 0) && finite(score.proximity_risk, 0, 1)
    && finite(score.time_score, 0, 1) && finite(score.total, 0, 100);
}

/** Validate data consumed by comparison, task and map views before publishing it. */
export function readCandidateResult(value: unknown, request: CandidateRequest): CandidateResult {
  if (!isRecord(value) || !["candidates", "needs_clarification", "blocked", "no_feasible_plan"].includes(String(value.status))
    || value.source !== "simulated" || value.execution_authorized !== false
    || value.scenario_id !== request.scenario_id || !isTaskTree(value.task_tree)
    || value.task_tree.raw_input !== request.raw_user_input
    || !isStringList(value.clarifications) || !isStringList(value.reasons) || !isStringList(value.limitations)
    || !isRecord(value.rule_sources) || !Object.values(value.rule_sources).every(isSource)
    || !isRecord(value.rule_evaluation) || typeof value.rule_evaluation.passed !== "boolean"
    || !Array.isArray(value.rule_evaluation.checks) || !value.rule_evaluation.checks.every(c =>
      isRecord(c) && typeof c.rule_id === "string" && typeof c.passed === "boolean"
      && typeof c.reason === "string" && isStringList(c.evidence))
    || !(value.effective_bounds === null || bounds(value.effective_bounds))
    || !Array.isArray(value.candidates) || !value.candidates.every(candidate)
    || new Set(value.candidates.map(c => c.strategy)).size !== value.candidates.length
    || !(value.recommended_strategy === null || value.candidates.some(c =>
      c.strategy === value.recommended_strategy && c.status === "feasible"))) {
    throw new Error("Invalid candidate-planning response");
  }
  // Render the submitted geometry snapshot, never an unvalidated server geometry replacement.
  const result = { ...value, scene: structuredClone(request.scene) } as CandidateResult;
  const activeBounds = result.effective_bounds ?? request.scene.bounds;
  for (const plan of result.candidates) {
    if (plan.path && (!plan.path.points.every(p => p.every((v, i) =>
      v >= activeBounds.minimum[i] && v <= activeBounds.maximum[i]))
      || plan.path.points[0].some((v, i) => v !== request.scene.start[i])
      || plan.path.points.at(-1)!.some((v, i) => v !== request.scene.start[i]))) {
      throw new Error("Invalid candidate route bounds or return point");
    }
  }
  return result;
}

export async function createCandidates(request: CandidateRequest): Promise<CandidateResult> {
  const response = await apiRequest<unknown>("/missions/plan-candidates", { method: "POST", body: request });
  return readCandidateResult(response, request);
}
