import { createStore } from "zustand/vanilla";
import {
  detectObstacles,
  type ObstacleDetectionRequest,
  type ObstacleDetectionResult,
} from "../../api/pointCloud";

type DetectionState =
  | { status: "idle"; result: null; error: null }
  | { status: "loading"; result: null; error: null }
  | { status: "success"; result: ObstacleDetectionResult; error: null }
  | { status: "error"; result: null; error: string };

export type EnvironmentState = DetectionState & {
  detect: (request: ObstacleDetectionRequest) => Promise<void>;
  retry: () => Promise<void>;
  selectedObstacleId: string | null;
  selectObstacle: (id: string | null) => void;
  reset: () => void;
};

/** Each instance owns its request lifecycle, so tests and workspaces stay isolated. */
export function createEnvironmentStore(detector: typeof detectObstacles = detectObstacles) {
  let lastRequest: ObstacleDetectionRequest | null = null;
  // Logical cancellation: the shared HTTP client does not expose AbortSignal.
  let generation = 0;
  return createStore<EnvironmentState>()((set, get) => ({
    status: "idle",
    result: null,
    error: null,
    selectedObstacleId: null,
    selectObstacle: (id) => {
      const state = get();
      const valid = state.status === "success"
        && state.result.obstacles.some(obstacle => obstacle.id === id);
      set({ selectedObstacleId: valid ? id : null });
    },
    reset: () => {
      generation++;
      lastRequest = null;
      set({ status: "idle", result: null, error: null, selectedObstacleId: null });
    },
    retry: async () => {
      if (get().status === "error" && lastRequest) await get().detect(lastRequest);
    },
    detect: async (request) => {
      if (get().status === "loading") return;
      const currentGeneration = ++generation;
      lastRequest = { ...request };
      const submittedRequest = { ...lastRequest };
      set({ status: "loading", result: null, error: null, selectedObstacleId: null });
      try {
        const response = await detector(submittedRequest);
        if (currentGeneration !== generation) return;
        set({ status: "success", result: response.result, error: null });
      } catch (error) {
        if (currentGeneration !== generation) return;
        set({
          status: "error",
          result: null,
          error: error instanceof Error ? error.message : "Obstacle detection failed",
        });
      }
    },
  }));
}
