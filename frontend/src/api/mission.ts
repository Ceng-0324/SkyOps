import { apiRequest } from "./client";
import { isRecord, isTaskDependencies, isTaskTree, type TaskDependencies, type TaskTree } from "./task";

export type DataSourceType = "mock" | "simulated" | "real";
export type RiskLevel = "low" | "medium" | "high" | "critical";

export type Explanation = {
  facts: string[];
  inferences: string[];
  recommended_actions: string[];
  human_confirmation_required: string[];
};

export type MissionTask = {
  id: string;
  raw_user_input: string;
  scenario_type: string;
  operation_object: string;
  operation_area: string;
  operation_goals: string[];
  requested_time_window: string;
  risk_preference: string;
  special_constraints: string[];
  source_type: DataSourceType;
};

export type EnvironmentState = {
  source_type: DataSourceType;
  weather_summary: string;
  wind_speed_mps: number;
  visibility_level: string;
  crowd_level: RiskLevel;
  gps_quality: string;
  gps_confidence: number;
  data_confidence: number;
};

export type AirspaceConstraint = {
  source_type: DataSourceType;
  is_flyable: boolean;
  approval_required: boolean;
  restricted_zones: string[];
  altitude_limit_m: number | null;
  compliance_risk_level: RiskLevel;
  explanation: string;
};

export type DroneState = {
  source_type: DataSourceType;
  drone_id: string;
  model: string;
  battery_percent: number;
  estimated_endurance_minutes: number;
  return_to_home_battery_threshold: number;
  payloads: string[];
  link_quality: RiskLevel;
  video_latency_ms: number;
  available_for_mission: boolean;
};

export type RiskItem = {
  id: string;
  category: string;
  description: string;
  severity: RiskLevel;
  probability: RiskLevel;
  risk_level: RiskLevel;
  trigger_condition: string;
  mitigation: string;
  evidence: string[];
  requires_human_confirmation: boolean;
};

export type LaunchLandingPoint = {
  id: string;
  name: string;
  description: string;
  safety_notes: string[];
};

export type SafetyThresholds = {
  max_wind_speed_mps: number;
  min_battery_percent: number;
  min_gps_confidence: number;
  max_video_latency_ms: number;
};

export type MissionPlan = {
  mission_id: string;
  recommended_time_window: string;
  launch_landing_points: LaunchLandingPoint[];
  route_strategy: string;
  flight_segments: string[];
  safety_thresholds: SafetyThresholds;
  abort_conditions: string[];
  contingency_plan: string[];
  expected_coverage_percent: number;
  estimated_duration_minutes: number;
  explanation: string;
};

export type IncidentEvent = {
  id: string;
  mission_id: string;
  event_type: string;
  observed_value: string;
  threshold: string;
  severity: RiskLevel;
  source_type: DataSourceType;
  description: string;
};

export type ReplanDecision = {
  incident_id: string;
  decision: string;
  actions: string[];
  affected_segments: string[];
  makeup_flight_required: boolean;
  human_takeover_required: boolean;
  reason: string;
  alternatives_considered: string[];
};

export type MissionReview = {
  mission_id: string;
  completion_rate: number;
  data_quality_score: number;
  risk_trigger_log: string[];
  uncovered_areas: string[];
  makeup_flight_plan: string[];
  human_review_checklist: string[];
  next_mission_optimizations: string[];
};

export type MissionPlanRequest = {
  raw_user_input: string;
  scenario_id?: string;
};

export type MissionPlanResponse = {
  task_tree: TaskTree;
  task_dependencies: TaskDependencies;
  planning_basis: "scenario_template";
  mission_task: MissionTask;
  environment_state: EnvironmentState;
  airspace_constraint: AirspaceConstraint;
  drone_state: DroneState;
  risks: RiskItem[];
  mission_plan: MissionPlan;
  human_explanation: Explanation;
};

export type MissionReplanRequest = {
  scenario_id?: string;
  incident_event: IncidentEvent;
};

export type MissionReplanResponse = {
  replan_decision: ReplanDecision;
};

export type MissionReviewRequest = {
  scenario_id?: string;
  incident_events: IncidentEvent[];
};

export type MissionReviewResponse = {
  mission_review: MissionReview;
};

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isReplanDecision(value: unknown): value is ReplanDecision {
  return isRecord(value)
    && typeof value.incident_id === "string"
    && typeof value.decision === "string"
    && isStringArray(value.actions)
    && isStringArray(value.affected_segments)
    && typeof value.makeup_flight_required === "boolean"
    && typeof value.human_takeover_required === "boolean"
    && typeof value.reason === "string"
    && isStringArray(value.alternatives_considered);
}

function isMissionReview(value: unknown): value is MissionReview {
  return isRecord(value)
    && typeof value.mission_id === "string"
    && typeof value.completion_rate === "number"
    && Number.isFinite(value.completion_rate)
    && value.completion_rate >= 0 && value.completion_rate <= 100
    && typeof value.data_quality_score === "number"
    && Number.isFinite(value.data_quality_score)
    && value.data_quality_score >= 0 && value.data_quality_score <= 100
    && isStringArray(value.risk_trigger_log)
    && isStringArray(value.uncovered_areas)
    && isStringArray(value.makeup_flight_plan)
    && isStringArray(value.human_review_checklist)
    && isStringArray(value.next_mission_optimizations);
}

export const DEFAULT_SCENARIO_ID = "shenzhen_nanshan_highrise_demo";
export const DEFAULT_MISSION_ID = "mission-shenzhen-nanshan-highrise-demo";

export const DEFAULT_TASK_INPUT =
  "明天上午巡检南山区一栋180米高办公楼外立面，重点排查幕墙裂缝和脱落风险，尽量减少对行人的影响。";

export const DEFAULT_INCIDENT_EVENT: IncidentEvent = {
  id: "incident-wind-001",
  mission_id: DEFAULT_MISSION_ID,
  event_type: "wind_speed_spike",
  observed_value: "9.4 m/s",
  threshold: "8.0 m/s",
  severity: "high",
  source_type: "mock",
  description: "Simulated sudden wind increase near the upper facade.",
};

export async function createMissionPlan(
  request: MissionPlanRequest,
): Promise<MissionPlanResponse> {
  const response = await apiRequest<unknown>("/missions/plan", {
    method: "POST",
    body: request,
  });
  if (!isRecord(response) || !isTaskTree(response.task_tree)
    || !isTaskDependencies(response.task_dependencies) || response.planning_basis !== "scenario_template") {
    throw new Error("Invalid task-understanding response");
  }
  return response as MissionPlanResponse;
}

export async function createReplanDecision(
  request: MissionReplanRequest,
): Promise<MissionReplanResponse> {
  const response = await apiRequest<unknown>("/missions/replan", {
    method: "POST",
    body: request,
  });
  if (!isRecord(response) || !isReplanDecision(response.replan_decision)) {
    throw new Error("Invalid mission-replan response");
  }
  return response as MissionReplanResponse;
}

export async function createMissionReview(
  request: MissionReviewRequest,
): Promise<MissionReviewResponse> {
  const response = await apiRequest<unknown>("/missions/review", {
    method: "POST",
    body: request,
  });
  if (!isRecord(response) || !isMissionReview(response.mission_review)) {
    throw new Error("Invalid mission-review response");
  }
  return response as MissionReviewResponse;
}
