import assert from "node:assert/strict";
import { test } from "node:test";
import { createWorkspace, createEnvironmentStore, createCandidates, createMissionPlan, demoTask, demoGeometry, readCandidateResult } from "../node_modules/.tmp/workspace-tests/workspace.mjs";

const detection = { source: "mock", obstacles: [], algorithm: "test", detection_time: "2026-10-03T00:00:00Z" };
const tree = {
  raw_input: demoTask, input_format: "text", source_type: "mock", boundary: "draft", execution_authorized: false,
  status: "parsed", unparsed_fragments: [], clarifications: [],
  definition: { version: 1, nodes: [{ id: "a", action: "inspect", target: { kind: "object", label: "A", refs: ["A"] }, depends_on: [], completion_conditions: ["影像"], parent_id: null }] },
};
const parsed = { task_tree: tree, task_dependencies: { nodes: ["a"], edges: [], topological_order: ["a"], parallel_groups: [["a"]], blocked_tasks: {} }, planning_basis: "scenario_template" };
const request = { raw_user_input: demoTask, scenario_id: "shenzhen_nanshan_highrise_demo", scene: { ...demoGeometry, obstacle_detection: detection }, priority_task_ids: [], completed_task_ids: [] };
function result() {
  return {
    status: "candidates", task_tree: tree, scenario_id: request.scenario_id, rule_sources: { environment: "mock" },
    rule_evaluation: { passed: true, checks: [] }, reasons: [], clarifications: [], limitations: [],
    recommended_strategy: "coverage", scene: request.scene, effective_bounds: demoGeometry.bounds,
    source: "simulated", execution_authorized: false,
    candidates: ["coverage", "focused_observation", "supplementary_capture"].map(strategy => ({
      strategy, status: "feasible", task_order: ["a"], visits: [], assumed_completed_task_ids: [],
      path: { points: [[1, 1, 2], [10, 0, 2], [1, 1, 2]], distance_m: 18.1 },
      score: { sample_coverage_percent: 100, estimated_duration_seconds: 14, proximity_risk: 0, time_score: .8, total: 94 },
      reasons: [], equivalent_to: null, execution_authorized: false,
    })),
  };
}
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
const defaults = { parse: async () => structuredClone(parsed), generate: async () => result(), replan: async () => ({}), review: async () => ({}) };
function workspace(overrides = {}) { return createWorkspace({ ...defaults, ...overrides }, createEnvironmentStore(async () => ({ result: detection }))); }
async function ready(w) { await w.store.getState().parse(); await w.environment.getState().detect({ point_cloud_file: "demo.pcd" }); }

test("planning waits for parsed task and successful detection; selection only accepts feasible plans", async () => {
  let calls = 0;
  const w = workspace({ generate: async input => { calls++; assert.equal(input.scene.obstacle_detection.source, "mock"); return result(); } });
  await w.store.getState().generate(); assert.equal(calls, 0);
  await w.store.getState().parse(); await w.store.getState().generate(); assert.equal(calls, 0);
  await ready(w); await w.store.getState().generate(); assert.equal(calls, 1);
  assert.equal(w.store.getState().selectedStrategy, "coverage");
  w.store.getState().selectStrategy("missing"); assert.equal(w.store.getState().selectedStrategy, "coverage");
  w.store.getState().selectStrategy("focused_observation"); assert.equal(w.store.getState().selectedStrategy, "focused_observation");
  w.dispose();
});
test("clarification does not become a plannable task", async () => {
  const w = workspace({ parse: async () => ({ ...parsed, task_tree: { ...tree, status: "needs_clarification" } }), generate: async () => assert.fail("must not plan") });
  await ready(w); await w.store.getState().generate(); assert.equal(w.store.getState().planning.status, "idle"); w.dispose();
});
for (const mutation of ["task", "geometry", "detection", "completion", "reset"]) {
  test(`${mutation} invalidates late candidate response and selection`, async () => {
    const pending = deferred(); const w = workspace({ generate: () => pending.promise }); await ready(w);
    const work = w.store.getState().generate();
    if (mutation === "task") w.store.getState().setTaskInput("新任务");
    if (mutation === "geometry") w.store.getState().setGeometry({ ...demoGeometry, clearance_m: 1 });
    if (mutation === "detection") w.environment.getState().reset();
    if (mutation === "completion") w.store.getState().setTaskFlag("completed", "a", true);
    if (mutation === "reset") w.store.getState().reset();
    pending.resolve(result()); await work;
    assert.equal(w.store.getState().planning.status, "idle"); assert.equal(w.store.getState().selectedStrategy, null); w.dispose();
  });
}
test("late task success and failure cannot overwrite an edited input", async () => {
  for (const reject of [false, true]) {
    const pending = deferred(); const w = workspace({ parse: () => pending.promise });
    const work = w.store.getState().parse(); w.store.getState().setTaskInput("edited");
    if (reject) pending.reject(new Error("old failure")); else pending.resolve(parsed);
    await work; assert.equal(w.store.getState().task.status, "idle"); w.dispose();
  }
});
test("duplicate planning is ignored and network failure can be retried", async () => {
  const pending = deferred(); let calls = 0;
  const w = workspace({ generate: async () => { calls++; if (calls === 1) return pending.promise; return result(); } });
  await ready(w); const work = w.store.getState().generate(); await w.store.getState().generate(); assert.equal(calls, 1);
  pending.reject(new Error("offline")); await work; assert.equal(w.store.getState().planning.error, "offline");
  await w.store.getState().generate(); assert.equal(w.store.getState().planning.status, "success"); w.dispose();
});
test("reference requests are explicit and cannot publish after task reset", async () => {
  const pending = deferred(); const w = workspace({ replan: () => pending.promise }); await ready(w);
  assert.equal(w.store.getState().reference.status, "idle");
  const work = w.store.getState().loadReference({ id: "mock" }); w.store.getState().reset(); pending.resolve({}); await work;
  assert.equal(w.store.getState().reference.status, "idle"); w.dispose();
});
test("workspace reconnect preserves invalidation after effect cleanup", async () => {
  const w = workspace(); w.dispose(); w.connect(); await ready(w); await w.store.getState().generate();
  assert.equal(w.store.getState().planning.status, "success");
  w.environment.getState().reset(); assert.equal(w.store.getState().planning.status, "idle"); w.dispose();
});
test("planning client sends the contract and retains the submitted scene snapshot", async t => {
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, "/missions/plan-candidates"); assert.deepEqual(JSON.parse(options.body), request); return Response.json(result());
  });
  const data = await createCandidates(request); assert.deepEqual(data.scene, request.scene); assert.notEqual(data.scene, request.scene);
});
for (const mutate of [
  r => r.execution_authorized = true, r => r.candidates[0].path.points[1][0] = Infinity,
  r => r.candidates[0].score.total = 101, r => r.candidates[0].path.points[1][0] = 999,
  r => r.candidates[0].path.points.pop(), r => r.candidates[0].status = "infeasible",
  r => r.recommended_strategy = "missing", r => r.task_tree = null,
  r => r.candidates.push(r.candidates[0]), r => r.rule_evaluation.checks = [{}],
]) test("invalid candidate payload is rejected before map rendering", () => {
  const data = structuredClone(result()); mutate(data); assert.throws(() => readCandidateResult(data, request));
});
test("task client validates task/dependency contract and exposes FastAPI field errors", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ task_tree: {} }));
  await assert.rejects(createMissionPlan({ raw_user_input: demoTask }), /Invalid task/);
  t.mock.method(globalThis, "fetch", async () => Response.json({ detail: [{ loc: ["body", "scene", "start"], msg: "outside bounds" }] }, { status: 422 }));
  await assert.rejects(createCandidates(request), /body.scene.start: outside bounds/);
});

const { prepareSpatialPlanning, defaultPlanningSettings } = await import("../node_modules/.tmp/workspace-tests/workspace.mjs");
const spatial = { version: 1, coordinateFrame: "reference_image_px", bound: true, inputMode: "fields", action: "inspect", completion: "影像", points: [{ id: "p1", number: 1, x: 790, y: 620, z: 30 }], start: { id: "start", number: 0, x: 540, y: 1000, z: 0 }, nextNumber: 2 };
const sceneInput = { dataset: "campus", file: "mock-campus.pcd", height: "0.5", minPoints: "10", tolerance: "2" };
test("paired scene converts task pixels using shared mock scale, flips Y and preserves height", () => {
  const before = structuredClone(spatial);
  const { geometry, reasons } = prepareSpatialPlanning(spatial, sceneInput, defaultPlanningSettings);
  assert.deepEqual(reasons, []);
  assert.deepEqual(geometry.start, [108, 56, 0]);
  assert.deepEqual(geometry.targets, [{ ref: "A", observation_points: [[158, 132, 30]] }]);
  assert.equal(geometry.source, "mock"); assert.equal(geometry.coordinate_frame, "local_cartesian_m");
  assert.deepEqual(spatial, before);
});
test("unpaired data, missing bindings, duplicate samples, invalid heights and excessive grids cannot plan", () => {
  for (const [draft, scene, settings] of [
    [spatial, { ...sceneInput, dataset: "server" }, defaultPlanningSettings],
    [spatial, { ...sceneInput, file: "demo.pcd" }, defaultPlanningSettings],
    [{ ...spatial, bound: false }, sceneInput, defaultPlanningSettings],
    [{ ...spatial, start: null }, sceneInput, defaultPlanningSettings],
    [{ ...spatial, points: [] }, sceneInput, defaultPlanningSettings],
    [{ ...spatial, points: [...spatial.points, { ...spatial.points[0], id: "p2" }] }, sceneInput, defaultPlanningSettings],
    [{ ...spatial, start: { ...spatial.start, z: -1 } }, sceneInput, defaultPlanningSettings],
    [spatial, sceneInput, { ...defaultPlanningSettings, ceiling: "20" }],
    [spatial, sceneInput, { ...defaultPlanningSettings, resolution: "0.1" }],
    [spatial, sceneInput, { ...defaultPlanningSettings, origin: "" }],
    [spatial, sceneInput, { ...defaultPlanningSettings, speed: "Infinity" }],
  ]) { const result = prepareSpatialPlanning(draft, scene, settings); assert.equal(result.geometry, null); assert.ok(result.reasons.length); }
});
