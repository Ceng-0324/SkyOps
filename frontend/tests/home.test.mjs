import assert from "node:assert/strict";
import { test } from "node:test";
import { makeDraft, readDrafts, validBrief, initialSpatialDraft, addMapPoint, moveMapPoint, taskInputFor, isSpatialTaskDraft } from "../node_modules/.tmp/home-tests/drafts.mjs";
const brief = { name: "  A 区巡检  ", goal: "巡检目标建筑", completion: "取得四面影像" };
const storage = data => ({ getItem: () => data });

test("creation preserves user text and completion, without inventing location bindings", () => {
  const first = makeDraft(brief, "building"), second = makeDraft(brief, "building");
  assert.equal(first.name, "A 区巡检");
  assert.equal(first.rawInput, "巡检目标建筑\n完成条件：取得四面影像");
  assert.notEqual(first.id, second.id);
  assert.equal(first.createdAt, first.updatedAt);
  assert.ok(!first.rawInput.includes("对象[A]"));
  const literal = makeDraft({ ...brief, goal: '<script>alert("x")</script>', completion: "" }, "blank");
  assert.equal(literal.rawInput, '<script>alert("x")</script>');
});
test("blank fields and length limits are rejected while completion is optional", () => {
  for (const patch of [{ name: "  " }, { goal: "\n\t" }, { name: "名".repeat(81) }, { goal: "目".repeat(2049) }, { completion: "条".repeat(1025) }]) {
    assert.equal(validBrief({ ...brief, ...patch }), false);
    assert.throws(() => makeDraft({ ...brief, ...patch }, "blank"));
  }
  assert.equal(validBrief({ ...brief, completion: "" }), true);
});
test("saved drafts survive round trip; missing storage starts empty", () => {
  const drafts = [makeDraft(brief, "building")];
  assert.deepEqual(readDrafts(storage(JSON.stringify({ version: 1, drafts }))), drafts);
  assert.deepEqual(readDrafts(storage(null)), []);
});
test("corrupt, unknown-version and duplicate records fail instead of becoming silently empty", () => {
  const draft = makeDraft(brief, "building");
  for (const payload of ["{", "null", JSON.stringify({ version: 2, drafts: [] }), JSON.stringify({ version: 1, drafts: [draft, draft] }), ...[{ template: "__proto__" }, { updatedAt: "yesterday" }, { name: "" }, { rawInput: 2 }, { rawInput: "x".repeat(16385) }].map(patch => JSON.stringify({ version: 1, drafts: [{ ...draft, ...patch }] }))]) {
    assert.throws(() => readDrafts(storage(payload)));
  }
  assert.throws(() => readDrafts({ getItem() { throw new Error("Access denied"); } }));
});


test("image points remain explicitly unregistered and are isolated between drafts", () => {
  const draft = makeDraft(brief, "building"), original = initialSpatialDraft(draft);
  assert.equal(addMapPoint(original, "observation", 600, 700), original);
  let state = { ...original, bound: true };
  for (let n = 0; n < 17; n++) state = addMapPoint(state, "observation", n, n);
  assert.equal(state.points.length, 16);
  assert.equal(new Set(state.points.map(p => p.id)).size, 16);
  state = addMapPoint(state, "start", 1280, 0);
  assert.equal(state.start.id, "start");
  assert.equal(state.coordinateFrame, "reference_image_px");
  assert.equal(state.points[0].z, 30);
  assert.equal(moveMapPoint(state, "p1", { z: Infinity }), state);
  assert.equal(moveMapPoint(state, "p1", { x: -1 }), state);
  const moved = moveMapPoint(state, "p1", { x: 640, z: 35.5 });
  assert.equal(moved.points[0].z, 35.5);
  assert.equal(state.points[0].z, 30);
  assert.equal(original.bound, false);
  assert.deepEqual(initialSpatialDraft(makeDraft(brief, "blank")).points, []);
  assert.equal(addMapPoint(state, "start", NaN, 700), state);
});
test("explicit F01 fields retain action and completion and never serialize pixels as metres", () => {
  const spatial = { ...initialSpatialDraft(makeDraft(brief, "building")), inputMode: "fields", bound: true, completion: '取得影像；保留文字"与换行\n内容' };
  const node = JSON.parse(taskInputFor(spatial, "原文不自动替换")).nodes[0];
  assert.deepEqual(node.target.refs, ["A"]);
  assert.equal(node.completion_conditions[0], spatial.completion);
  assert.equal(node.action, "inspect");
  assert.equal(taskInputFor({ ...spatial, inputMode: "text" }, "原文"), "原文");
  assert.equal(JSON.parse(taskInputFor({ ...spatial, bound: false }, "")).nodes[0].target, null);
  assert.ok(!taskInputFor(spatial, "").includes("coordinate"));
});
test("spatial persistence round-trips and rejects invalid frames, IDs and points", () => {
  const draft = makeDraft(brief, "building");
  const spatial = addMapPoint({ ...initialSpatialDraft(draft), bound: true }, "observation", 700, 600);
  assert.ok(isSpatialTaskDraft(spatial));
  assert.deepEqual(readDrafts(storage(JSON.stringify({ version: 1, drafts: [{ ...draft, spatial }] })))[0].spatial, spatial);
  for (const bad of [{ ...spatial, coordinateFrame: "local_cartesian_m" }, { ...spatial, bound: false }, { ...spatial, points: [spatial.points[0], spatial.points[0]] }, { ...spatial, nextNumber: 1 }, { ...spatial, start: spatial.points[0] }, { ...spatial, action: "__proto__" }]) {
    assert.equal(isSpatialTaskDraft(bad), false);
    assert.throws(() => readDrafts(storage(JSON.stringify({ version: 1, drafts: [{ ...draft, spatial: bad }] }))));
  }
});
