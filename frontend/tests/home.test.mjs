import assert from "node:assert/strict";
import { test } from "node:test";
import { makeDraft, readDrafts, validBrief } from "../node_modules/.tmp/home-tests/drafts.mjs";
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
