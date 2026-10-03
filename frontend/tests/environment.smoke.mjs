import assert from "node:assert/strict";
import { test } from "node:test";
import { createEnvironmentStore, selectSelectedObstacle } from "../node_modules/.tmp/environment-tests/environment.mjs";

test("real HTTP: demo obstacles → selection → empty result → 404 → retry → reset", async () => {
  const store = createEnvironmentStore();
  const states = [];
  const unsubscribe = store.subscribe(state => states.push(state.status));
  const request = { point_cloud_file: "demo.pcd", cluster_tolerance: 0.1 };
  await store.getState().detect(request);
  let state = store.getState();
  assert.equal(state.status, "success", state.error ?? "expected success");
  assert.equal(state.result.obstacles.length, 2);
  assert.equal(state.result.source, "mock");
  assert.equal(state.result.algorithm, "height_threshold_euclidean");
  assert.ok(Number.isFinite(Date.parse(state.result.detection_time)));
  state.selectObstacle(state.result.obstacles[0].id);
  assert.ok(selectSelectedObstacle(store.getState()));
  console.log("demo", JSON.stringify(state.result));

  await store.getState().detect({ ...request, height_threshold: 10000 });
  state = store.getState();
  assert.equal(state.status, "success", state.error ?? "expected empty success");
  assert.deepEqual(state.result.obstacles, []);
  assert.equal(state.result.source, "mock");
  assert.equal(state.selectedObstacleId, null);
  await store.getState().detect({ point_cloud_file: "f02-smoke-missing.pcd" });
  assert.equal(store.getState().status, "error");
  assert.equal(store.getState().result, null);
  const error = store.getState().error;
  assert.ok(error);
  await store.getState().retry();
  assert.equal(store.getState().status, "error");
  assert.equal(store.getState().error, error);
  await store.getState().detect(request);
  assert.equal(store.getState().status, "success");
  store.getState().reset();
  assert.equal(store.getState().status, "idle");
  unsubscribe();
  assert.deepEqual(states, ["loading", "success", "success", "loading", "success",
    "loading", "error", "loading", "error", "loading", "success", "idle"]);
  console.log("observable states", states.join(" → "));
});
