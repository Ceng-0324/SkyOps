import { createStore } from "zustand/vanilla";
import { createCandidates, type CandidateResult, type PlanningGeometry, type Strategy } from "../../api/candidates";
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
  selectedStrategy: Strategy | null;
  reference: MissionCycleState;
  setTaskInput: (input: string) => void;
  setGeometry: (geometry: PlanningGeometry) => void;
  setTaskFlag: (kind: "priority" | "completed", id: string, checked: boolean) => void;
  parse: () => Promise<void>;
  generate: () => Promise<void>;
  selectStrategy: (strategy: Strategy) => void;
  loadReference: (incident: IncidentEvent) => Promise<void>;
  reset: () => void;
};

const defaultServices = { parse: createMissionPlan, generate: createCandidates, replan: createReplanDecision, review: createMissionReview };

/** One workspace owns its request generations and F02 store; no cross-workspace singleton. */
export function createWorkspace(services = defaultServices, environment = createEnvironmentStore()) {
  let taskVersion = 0;
  let planningVersion = 0;
  let referenceVersion = 0;
  const store = createStore<WorkspaceState>()((set, get) => ({
    taskInput: demoTask, geometry: structuredClone(demoGeometry), task: idle, planning: idle,
    priorityIds: [], completedIds: [], selectedStrategy: null, reference: { status: "idle" },
    setTaskInput: taskInput => {
      taskVersion++; planningVersion++; referenceVersion++;
      set({ taskInput, task: idle, planning: idle, selectedStrategy: null, priorityIds: [], completedIds: [], reference: { status: "idle" } });
    },
    setGeometry: geometry => {
      planningVersion++;
      set({ geometry: structuredClone(geometry), planning: idle, selectedStrategy: null });
    },
    setTaskFlag: (kind, id, checked) => {
      const state = get();
      if (state.task.status !== "success" || !state.task.data.task_tree.definition?.nodes.some(n => n.id === id)) return;
      const key = kind === "priority" ? "priorityIds" : "completedIds";
      const ids = state[key].filter(value => value !== id);
      if (checked) ids.push(id);
      planningVersion++;
      set({ [key]: ids, planning: idle, selectedStrategy: null });
    },
    parse: async () => {
      if (get().task.status === "loading" || !get().taskInput.trim()) return;
      const version = ++taskVersion;
      planningVersion++; referenceVersion++;
      const input = get().taskInput;
      set({ task: loading, planning: idle, selectedStrategy: null, priorityIds: [], completedIds: [], reference: { status: "idle" } });
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
      const version = ++planningVersion;
      const request = structuredClone({
        raw_user_input: state.taskInput, scenario_id: DEFAULT_SCENARIO_ID,
        scene: { ...state.geometry, obstacle_detection: detection.result },
        priority_task_ids: state.priorityIds, completed_task_ids: state.completedIds,
      });
      set({ planning: loading, selectedStrategy: null });
      try {
        const data = await services.generate(request);
        if (version === planningVersion) set({ planning: { status: "success", data, error: null }, selectedStrategy: data.recommended_strategy });
      } catch (error) {
        if (version === planningVersion) set({ planning: { status: "error", data: null, error: message(error) } });
      }
    },
    selectStrategy: strategy => {
      const { planning } = get();
      if (planning.status === "success" && planning.data.candidates.some(c => c.strategy === strategy && c.status === "feasible")) set({ selectedStrategy: strategy });
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
      taskVersion++; planningVersion++; referenceVersion++;
      environment.getState().reset();
      set({ taskInput: demoTask, geometry: structuredClone(demoGeometry), task: idle, planning: idle,
        priorityIds: [], completedIds: [], selectedStrategy: null, reference: { status: "idle" } });
    },
  }));
  // New detection/reset invalidates every route based on the previous obstacle snapshot.
  let unsubscribe = () => {};
  const connect = () => {
    unsubscribe();
    unsubscribe = environment.subscribe((next, previous) => {
    if (next.status !== previous.status || next.result !== previous.result) {
      planningVersion++;
      store.setState({ planning: idle, selectedStrategy: null });
    }
    });
  };
  connect();
  return {
    store, environment, connect,
    dispose: () => { taskVersion++; planningVersion++; referenceVersion++; unsubscribe(); },
  };
}

export type Workspace = ReturnType<typeof createWorkspace>;
