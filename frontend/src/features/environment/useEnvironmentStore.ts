import { useStore } from "zustand";
import { createEnvironmentStore, type EnvironmentState } from "./environmentStore";

/** Shared environment state; constructing/importing it does not start detection. */
export const environmentStore = createEnvironmentStore();

/** Subscribe with a stable selector. Pass a store instance for an isolated workspace. */
export function useEnvironmentStore<T>(
  selector: (state: EnvironmentState) => T,
  store = environmentStore,
): T {
  return useStore(store, selector);
}

/** Returns an existing result object (or null), never a freshly allocated snapshot. */
export function selectSelectedObstacle(state: EnvironmentState) {
  return state.status === "success"
    ? state.result.obstacles.find(obstacle => obstacle.id === state.selectedObstacleId) ?? null
    : null;
}
