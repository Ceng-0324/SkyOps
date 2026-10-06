import { buildTaskRiskEvent, emptyTaskRiskInput, type TaskRiskInput } from "./taskRiskInput";
import { createStore } from "zustand/vanilla";
import { simulateRisk, type RiskResult, type RiskRequest } from "../../api/riskSimulation";
import { createCandidates, type CandidateRequest, type CandidateResult, type PlanningGeometry, type Strategy } from "../../api/candidates";
import {
  createMissionPlan, createMissionReview, createReplanDecision, DEFAULT_SCENARIO_ID,
  type IncidentEvent, type MissionPlanResponse,
} from "../../api/mission";
import { createEnvironmentStore } from "../environment/environmentStore";
import type { MissionCycleState } from "./types";

export const demoTask = "检查对象[A]；完成条件：取得影像，同时拍摄点[B]；完成条件：取得照片，然后测绘区域[C]；完成条件：覆盖全区";
export const demoGeometry: PlanningGeometry = {
  coordinate_frame: "local_cartesian_m", source: "mock",
  bounds: { minimum: [-2, -8, 0], maximum: [105, 12, 8] },
  start: [1, 1, 2], altitude_origin_m: 0,
  targets: [
    { ref: "A", observation_points: [[10, 0, 2], [10, 3, 2]] },
    { ref: "B", observation_points: [[101, 0, 2]] },
    { ref: "C", observation_points: [[50, 5, 2]] },
  ],
  grid_resolution_m: 2, clearance_m: 0.2, cruise_speed_mps: 2, observation_seconds: 5,
};

export type RemoteState<T> =
  | { status: "idle" | "loading"; data: null; error: null }
  | { status: "success"; data: T; error: null }
  | { status: "error"; data: null; error: string };
const idle = { status: "idle", data: null, error: null } as const;
const loading = { status: "loading", data: null, error: null } as const;
const message = (error: unknown) => error instanceof Error ? error.message : "Request failed";

type WorkspaceState = {
  taskInput: string;
  geometry: PlanningGeometry;
  task: RemoteState<MissionPlanResponse>;
  planning: RemoteState<CandidateResult>;
  priorityIds: string[];
  completedIds: string[];
  adoptedStrategy: Strategy | null;
  planningRequest: CandidateRequest | null;
  risk: RemoteState<RiskResult>;
  riskInput: { wind: string; unknown: boolean };
  riskEdited: boolean;
  riskEventType: "wind_change" | "task_added";
  taskRiskInput: TaskRiskInput;
  setRiskEventType: (type: "wind_change" | "task_added") => void;
  setTaskRiskInput: (input: TaskRiskInput) => void;
  reference: MissionCycleState;
  setTaskInput: (input: string) => void;
  setGeometry: (geometry: PlanningGeometry) => void;
  setTaskFlag: (kind: "priority" | "completed", id: string, checked: boolean) => void;
  parse: () => Promise<void>;
  generate: () => Promise<void>;
  adoptStrategy: (strategy: Strategy) => void;
  setRiskInput: (input: { wind: string; unknown: boolean }) => void;
  simulateRisk: () => Promise<void>;
  loadReference: (incident: IncidentEvent) => Promise<void>;
  reset: () => void;
};

const defaultServices = { parse: createMissionPlan, generate: createCandidates, replan: createReplanDecision, review: createMissionReview, simulateRisk };

/** One workspace owns its request generations and F02 store; no cross-workspace singleton. */
export function createWorkspace(services = defaultServices, environment = createEnvironmentStore()) {
  let taskVersion = 0;
  let planningVersion = 0;
  let referenceVersion = 0;
  let riskVersion = 0;
  const invalidRisk = { risk: idle, riskEdited: false } as const;
  const store = createStore<WorkspaceState>()((set, get) => ({
    taskInput: demoTask, geometry: structuredClone(demoGeometry), task: idle, planning: idle,
    priorityIds: [], completedIds: [], adoptedStrategy: null, planningRequest: null, ...invalidRisk, reference: { status: "idle" }, riskInput: { wind: "", unknown: false }, riskEventType: "wind_change", taskRiskInput: emptyTaskRiskInput(),
    setTaskInput: taskInput => {
      taskVersion++; planningVersion++; riskVersion++; referenceVersion++;
      set({ taskInput, task: idle, planning: idle, adoptedStrategy: null, planningRequest: null, ...invalidRisk, priorityIds: [], completedIds: [], reference: { status: "idle" } });
    },
    setGeometry: geometry => {
      planningVersion++; riskVersion++;
      set({ geometry: structuredClone(geometry), planning: idle, adoptedStrategy: null, planningRequest: null, ...invalidRisk });
    },
    setTaskFlag: (kind, id, checked) => {
      const state = get();
      if (state.task.status !== "success" || !state.task.data.task_tree.definition?.nodes.some(n => n.id === id)) return;
      const key = kind === "priority" ? "priorityIds" : "completedIds";
      const ids = state[key].filter(value => value !== id);
      if (checked) ids.push(id);
      planningVersion++; riskVersion++;
      set({ [key]: ids, planning: idle, adoptedStrategy: null, planningRequest: null, ...invalidRisk });
    },
    parse: async () => {
      if (get().task.status === "loading" || !get().taskInput.trim()) return;
      const version = ++taskVersion;
      planningVersion++; riskVersion++; referenceVersion++;
      const input = get().taskInput;
      set({ task: loading, planning: idle, adoptedStrategy: null, planningRequest: null, ...invalidRisk, priorityIds: [], completedIds: [], reference: { status: "idle" } });
      try {
        const data = await services.parse({ raw_user_input: input, scenario_id: DEFAULT_SCENARIO_ID });
        if (version === taskVersion) set({ task: { status: "success", data, error: null } });
      } catch (error) {
        if (version === taskVersion) set({ task: { status: "error", data: null, error: message(error) } });
      }
    },
    generate: async () => {
      const state = get();
      const detection = environment.getState();
      if (state.planning.status === "loading" || state.task.status !== "success"
        || state.task.data.task_tree.status !== "parsed" || detection.status !== "success") return;
      const version = ++planningVersion; riskVersion++;
      const request = structuredClone({
        raw_user_input: state.taskInput, scenario_id: DEFAULT_SCENARIO_ID,
        scene: { ...state.geometry, obstacle_detection: detection.result },
        priority_task_ids: state.priorityIds, completed_task_ids: state.completedIds,
      });
      set({ planning: loading, adoptedStrategy: null, planningRequest: null, ...invalidRisk });
      try {
        const data = await services.generate(request);
        if (version === planningVersion) set({ planning: { status: "success", data, error: null }, planningRequest: request });
      } catch (error) {
        if (version === planningVersion) set({ planning: { status: "error", data: null, error: message(error) } });
      }
    },
    adoptStrategy: strategy => {
      const { planning, adoptedStrategy } = get();
      if (strategy !== adoptedStrategy && planning.status === "success"
        && planning.data.candidates.some(c => c.strategy === strategy && c.status === "feasible")) {
        riskVersion++;
        set({ adoptedStrategy: strategy, ...invalidRisk });
      }
    },
    setRiskInput: riskInput => {
      riskVersion++;
      const state = get();
      set({ riskInput: { ...riskInput }, risk: idle, riskEdited: state.riskEdited || state.risk.status !== "idle" });
    },
    setRiskEventType: riskEventType => {
      const state = get();
      if (riskEventType === state.riskEventType) return;
      riskVersion++;
      const input = state.taskRiskInput;
      const first = state.planningRequest?.scene.targets[0]?.ref;
      set({ riskEventType, risk: idle, riskEdited: state.riskEdited || state.risk.status !== "idle",
        taskRiskInput: !input.targetRef && first ? { ...input, targetRef: first } : input });
    },
    setTaskRiskInput: taskRiskInput => {
      riskVersion++;
      const state = get();
      set({ taskRiskInput: structuredClone(taskRiskInput), risk: idle, riskEdited: state.riskEdited || state.risk.status !== "idle" });
    },
    simulateRisk: async () => {
      const state = get();
      if (state.risk.status === "loading" || !state.adoptedStrategy || !state.planningRequest
        || state.planning.status !== "success") return;
      const version = ++riskVersion;
      let request: RiskRequest;
      try {
        if (state.riskEventType === "task_added") {
          request = { planning_request: state.planningRequest, selected_strategy: state.adoptedStrategy,
            event: { ...buildTaskRiskEvent(state.taskRiskInput, state.planningRequest, state.planning.data), id: `task-${version}` } };
        } else {
          const speed = state.riskInput.unknown ? null : Number(state.riskInput.wind);
          if (speed !== null && (!state.riskInput.wind.trim() || !Number.isFinite(speed) || speed < 0)) {
            throw new Error("请输入不小于 0 的有限风速，或选择风速未知。");
          }
          request = { planning_request: state.planningRequest, selected_strategy: state.adoptedStrategy,
            event: { id: `wind-${version}`, type: "wind_change", source: "simulated", timestamp: new Date().toISOString(), wind_speed_mps: speed } };
        }
        request = structuredClone(request);
      } catch (error) {
        set({ risk: { status: "error", data: null, error: message(error) } }); return;
      }
      const baseline = structuredClone(state.planning.data);
      set({ risk: loading, riskEdited: false });
      try {
        const data = await services.simulateRisk(request, baseline);
        if (version === riskVersion) set({ risk: { status: "success", data, error: null } });
      } catch (error) {
        if (version === riskVersion) set({ risk: { status: "error", data: null, error: message(error) } });
      }
    },
    loadReference: async incident => {
      const state = get();
      if (state.task.status !== "success") return;
      const version = ++referenceVersion;
      const plan = state.task.data;
      const incidentEvent = structuredClone(incident);
      set({ reference: { status: "loading" } });
      try {
        const [replan, review] = await Promise.all([
          services.replan({ scenario_id: DEFAULT_SCENARIO_ID, incident_event: incidentEvent }),
          services.review({ scenario_id: DEFAULT_SCENARIO_ID, incident_events: [incidentEvent] }),
        ]);
        if (version === referenceVersion) set({ reference: { status: "ready", plan, replan, review, incidentEvent } });
      } catch (error) {
        if (version === referenceVersion) set({ reference: { status: "failed", message: message(error), possibleCauses: [], suggestedActions: [] } });
      }
    },
    reset: () => {
      taskVersion++; planningVersion++; riskVersion++; referenceVersion++;
      environment.getState().reset();
      set({ taskInput: demoTask, geometry: structuredClone(demoGeometry), task: idle, planning: idle,
        priorityIds: [], completedIds: [], adoptedStrategy: null, planningRequest: null, ...invalidRisk, riskInput: { wind: "", unknown: false }, riskEventType: "wind_change", taskRiskInput: emptyTaskRiskInput(), reference: { status: "idle" } });
    },
  }));
  // New detection/reset invalidates every route based on the previous obstacle snapshot.
  let unsubscribe = () => {};
  const connect = () => {
    unsubscribe();
    unsubscribe = environment.subscribe((next, previous) => {
    if (next.status !== previous.status || next.result !== previous.result) {
      planningVersion++; riskVersion++;
      store.setState({ planning: idle, adoptedStrategy: null, planningRequest: null, ...invalidRisk });
    }
    });
  };
  connect();
  return {
    store, environment, connect,
    dispose: () => { taskVersion++; planningVersion++; riskVersion++; referenceVersion++; unsubscribe(); },
  };
}

export type Workspace = ReturnType<typeof createWorkspace>;
