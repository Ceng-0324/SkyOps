import assert from "node:assert/strict";
import { test } from "node:test";
import { createWorkspace, createCandidates, DEFAULT_INCIDENT_EVENT } from "../node_modules/.tmp/workspace-tests/workspace.mjs";

test("real F01 → F02 → F03 supports task dependencies, route selection, invalidation and reference views", async () => {
  const w = createWorkspace();
  try {
    await w.store.getState().parse();
    assert.equal(w.store.getState().task.status, "success", w.store.getState().task.error);
    const task = w.store.getState().task.data.task_tree;
    assert.equal(task.status, "parsed"); assert.equal(task.definition.nodes.length, 3);
    assert.equal(w.store.getState().task.data.task_dependencies.edges.length, 2);
    await w.environment.getState().detect({ point_cloud_file: "demo.pcd", cluster_tolerance: .1 });
    assert.equal(w.environment.getState().status, "success", w.environment.getState().error);
    assert.equal(w.environment.getState().result.obstacles.length, 2);
    w.store.getState().setTaskFlag("priority", task.definition.nodes[1].id, true);
    await w.store.getState().generate();
    assert.equal(w.store.getState().planning.status, "success", w.store.getState().planning.error);
    const data = w.store.getState().planning.data;
    assert.equal(data.status, "candidates"); assert.equal(data.candidates.length, 3);
    assert.ok(data.candidates.every(c => c.status === "feasible" && c.score && c.path));
    w.store.getState().selectStrategy("focused_observation");
    assert.equal(w.store.getState().selectedStrategy, "focused_observation");
    await w.store.getState().loadReference(DEFAULT_INCIDENT_EVENT);
    assert.equal(w.store.getState().reference.status, "ready");
    const blocked = await createCandidates({ raw_user_input: task.raw_input, scenario_id: data.scenario_id,
      scene: { ...data.scene, altitude_origin_m: 120 }, priority_task_ids: [], completed_task_ids: [] });
    assert.equal(blocked.status, "blocked"); assert.equal(blocked.candidates.length, 0);
    w.environment.getState().reset(); assert.equal(w.store.getState().planning.status, "idle");
    w.store.getState().setTaskInput("检查这里"); await w.store.getState().parse();
    assert.equal(w.store.getState().task.data.task_tree.status, "needs_clarification");
    await w.store.getState().generate(); assert.equal(w.store.getState().planning.status, "idle");
  } finally { w.dispose(); }
});
