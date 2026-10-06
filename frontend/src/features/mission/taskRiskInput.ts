import type { CandidateRequest, CandidateResult } from "../../api/candidates";
import type { TaskAddedEvent } from "../../api/riskSimulation";
import type { TaskNode } from "../../api/task";
import type { Vector3 } from "../../api/pointCloud";

export type TaskRiskInput = {
  action: TaskNode["action"];
  targetMode: "existing" | "new";
  targetRef: string;
  newTarget: string;
  points: [string, string, string][];
  completion: string;
  after: string[];
  before: string[];
};

export function emptyTaskRiskInput(): TaskRiskInput {
  return { action: "capture", targetMode: "existing", targetRef: "", newTarget: "",
    points: [["", "", ""]], completion: "", after: [], before: [] };
}

/** Translate form fields into a bounded event without mutating the adopted task or scene. */
export function buildTaskRiskEvent(input: TaskRiskInput, request: CandidateRequest, baseline: CandidateResult): TaskAddedEvent {
  const nodes = baseline.task_tree.definition?.nodes;
  if (!nodes?.length) throw new Error("请先生成任务并设为当前草案。");
  if (nodes.length >= 128) throw new Error("任务数量已达上限 128，无法新增任务。");
  if (!["inspect", "patrol", "capture", "survey"].includes(input.action)) throw new Error("请选择支持的作业动作。");
  const completion = input.completion.trim();
  if (!completion || completion.length > 512) throw new Error("请填写完成条件，最多 512 字。");
  const target = (input.targetMode === "new" ? input.newTarget : input.targetRef).trim();
  if (!target || target.length > 512) throw new Error("请选择目标或填写新目标名称，最多 512 字。");
  const existing = request.scene.targets.find(t => t.ref === target);
  const geometry: TaskAddedEvent["geometry"] = [];
  if (input.targetMode === "existing") {
    if (!existing) throw new Error("所选目标不在当前草案中，请重新选择。");
  } else {
    if (existing) throw new Error("目标名称已存在，请复用该目标或使用新名称。");
    if (request.scene.targets.length >= 32) throw new Error("场景目标已达上限 32。");
    if (!input.points.length || input.points.length > 16) throw new Error("请填写 1–16 个观察点。");
    const points = input.points.map((point, index): Vector3 => {
      if (point.length !== 3 || point.some(v => !v.trim() || !Number.isFinite(Number(v)))) {
        throw new Error(`观察点 ${index + 1} 需填写有限的 X / Y / Z 米制坐标。`);
      }
      const p = point.map(Number) as Vector3;
      if (p.some((v, i) => Math.abs(v) > 10000 || v < request.scene.bounds.minimum[i] || v > request.scene.bounds.maximum[i])) {
        throw new Error(`观察点 ${index + 1} 超出当前规划边界，请调整坐标。`);
      }
      return p;
    });
    if (new Set(points.map(p => p.join(","))).size !== points.length) throw new Error("观察点不能重复。");
    if (points.length + request.scene.targets.reduce((n, t) => n + t.observation_points.length, 0) > 64) throw new Error("场景观察点总数不能超过 64。");
    geometry.push({ ref: target, observation_points: points });
  }
  for (const ids of [input.after, input.before]) {
    if (ids.length > 32 || new Set(ids).size !== ids.length || ids.some(id => !nodes.some(n => n.id === id))) {
      throw new Error("执行顺序包含失效或重复任务，请重新选择（最多 32 项）。");
    }
  }
  const descendants = new Set(input.before);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes) if (!descendants.has(node.id) && node.depends_on.some(id => descendants.has(id))) {
      descendants.add(node.id); changed = true;
    }
  }
  if (input.after.some(id => descendants.has(id))) throw new Error("前后约束形成循环，请调整任务顺序。");
  if (request.completed_task_ids.some(id => descendants.has(id))) throw new Error("新增任务不能成为已声明完成任务的前置条件。");
  let index = 1;
  while (nodes.some(n => n.id === `added-${index}`)) index++;
  return {
    id: "task-added", type: "task_added", source: "simulated", timestamp: new Date().toISOString(),
    task: { id: `added-${index}`, action: input.action,
      target: { kind: "object", label: target, refs: [target] }, completion_conditions: [completion],
      depends_on: [...input.after], parent_id: null },
    geometry, before_task_ids: [...input.before],
  };
}
