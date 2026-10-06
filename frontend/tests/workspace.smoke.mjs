import assert from "node:assert/strict";
import { test } from "node:test";
import { createWorkspace, createCandidates, simulateRisk, DEFAULT_INCIDENT_EVENT } from "../node_modules/.tmp/workspace-tests/workspace.mjs";

test("real F01 → F02 → F03 → F04 supports task dependencies, route selection, invalidation and reference views", async () => {
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
    w.store.getState().adoptStrategy("focused_observation");
    assert.equal(w.store.getState().adoptedStrategy, "focused_observation");
    w.store.getState().setRiskInput({ wind: "8", unknown: false });
    await w.store.getState().simulateRisk();
    assert.equal(w.store.getState().risk.status, "success", w.store.getState().risk.error);
    assert.equal(w.store.getState().risk.data.recommended_response, "pause_for_review");
    w.store.getState().setRiskInput({ wind: "7", unknown: false });
    assert.equal(w.store.getState().risk.status, "idle");
    await w.store.getState().simulateRisk();
    assert.equal(w.store.getState().risk.status, "success", w.store.getState().risk.error);
    assert.equal(w.store.getState().risk.data.recommended_response, "continue_original");
    w.store.getState().setRiskInput({ wind: "", unknown: true });
    await w.store.getState().simulateRisk();
    assert.equal(w.store.getState().risk.data.status, "needs_clarification");
    const originalSnapshot = structuredClone(w.store.getState().planning.data);
    const originalRequest = structuredClone(w.store.getState().planningRequest);
    w.store.getState().setRiskEventType('task_added');
    const setAdded = change => w.store.getState().setTaskRiskInput({ ...w.store.getState().taskRiskInput, ...change });
    setAdded({ targetRef: 'A', completion: '取得细节影像', after: [task.definition.nodes[0].id] });
    await w.store.getState().simulateRisk();
    assert.equal(w.store.getState().risk.status, 'success', w.store.getState().risk.error);
    let risk = w.store.getState().risk.data;
    assert.equal(risk.recommended_response, 'replan');
    assert.equal(risk.projected.task_tree.definition.nodes.length, 4);
    assert.equal(risk.event.geometry.length, 0);
    assert.deepEqual(w.store.getState().planning.data, originalSnapshot);
    assert.deepEqual(w.store.getState().planningRequest, originalRequest);
    setAdded({ targetMode: 'new', newTarget: 'D', points: [['6','6','2']], after: [], before: [task.definition.nodes[0].id] });
    await w.store.getState().simulateRisk();
    assert.equal(w.store.getState().risk.status, 'success', w.store.getState().risk.error);
    risk = w.store.getState().risk.data;
    assert.equal(risk.recommended_response, 'replan');
    assert.ok(risk.impact.dependent_task_ids.includes(task.definition.nodes[0].id));
    assert.equal(risk.projected.scene.targets.at(-1).ref, 'D');
    assert.deepEqual(w.store.getState().planningRequest, originalRequest);
    // Completion credits differ across strategies; only supplementary capture skips them.
    const creditedRequest = { ...originalRequest, completed_task_ids: [task.definition.nodes[0].id] };
    const credited = await createCandidates(creditedRequest);
    const creditedRisk = await simulateRisk({ planning_request: creditedRequest, selected_strategy: 'focused_observation',
      event: { ...risk.event, before_task_ids: [], task: { ...risk.event.task, depends_on: [] } } }, credited);
    assert.equal(creditedRisk.recommended_response, 'replan');
    // Missing geometry is a valid clarification result, not a malformed response.
    const missing = await simulateRisk({ planning_request: originalRequest, selected_strategy: 'focused_observation',
      event: { ...risk.event, geometry: [], before_task_ids: [], task: { ...risk.event.task, depends_on: [] } } }, originalSnapshot);
    assert.equal(missing.status, 'needs_clarification');
    assert.equal(missing.projected.effective_bounds, null);
    assert.equal(missing.alternatives.find(a => a.strategy === 'replan').projected_plan, null);
    // A target inside a detected obstacle produces a genuine infeasible alternative.
    const obstacle = w.environment.getState().result.obstacles[0];
    const infeasible = await simulateRisk({ planning_request: originalRequest, selected_strategy: 'focused_observation',
      event: { ...risk.event, geometry: [{ ref: 'D', observation_points: [obstacle.position] }], before_task_ids: [], task: { ...risk.event.task, depends_on: [] } } }, originalSnapshot);
    assert.equal(infeasible.recommended_response, 'pause_for_review');
    assert.equal(infeasible.alternatives.find(a => a.strategy === 'replan').projected_plan, null);
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
