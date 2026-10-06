import { apiRequest } from "./client";
import { readCandidateResult, type Candidate, type CandidateRequest, type CandidateResult, type Strategy } from "./candidates";
import { isRecord, isStringList, type TaskNode } from "./task";

export type WindRiskEvent = {
  id: string; type: "wind_change"; source: "simulated"; timestamp: string;
  wind_speed_mps: number | null;
};
export type WindRiskRequest = { planning_request: CandidateRequest; selected_strategy: Strategy; event: WindRiskEvent };
export type TaskAddedEvent = {
  id: string; type: "task_added"; source: "simulated"; timestamp: string;
  task: TaskNode; geometry: CandidateRequest["scene"]["targets"]; before_task_ids: string[];
};
export type TaskRiskRequest = Omit<WindRiskRequest, "event"> & { event: TaskAddedEvent };
export type RiskRequest = WindRiskRequest | TaskRiskRequest;
export type TaskAlternative = Omit<WindAlternative, "strategy" | "status"> & {
  strategy: "continue_original" | "pause_for_review" | "replan";
  status: "eligible" | "blocked" | "requires_review" | "infeasible" | "budget_exceeded";
};
export type TaskRiskResult = Omit<WindRiskResult, "event" | "projected" | "alternatives" | "recommended_response"> & {
  event: TaskAddedEvent; projected: CandidateResult; alternatives: TaskAlternative[];
  recommended_response: "replan" | "pause_for_review";
};
export type RiskResult = WindRiskResult | TaskRiskResult;

export function isTaskRisk(result: RiskResult): result is TaskRiskResult {
  return result.event.type === "task_added";
}
export type RiskRules = CandidateResult["rule_evaluation"];
export type WindAlternative = {
  strategy: "continue_original" | "pause_for_review";
  status: "eligible" | "blocked" | "requires_review";
  reasons: string[]; deferred_task_ids: string[];
  projected_plan: Candidate | null;
  distance_delta_m: number | null; duration_delta_seconds: number | null;
  execution_authorized: false;
};
export type WindRiskResult = {
  status: "simulated" | "needs_clarification";
  baseline: CandidateResult; selected_strategy: Strategy; event: WindRiskEvent;
  rules_after: RiskRules | null; projected: null;
  impact: { direct_task_ids: string[]; dependent_task_ids: string[]; rescheduled_task_ids: string[]; reasons: string[] };
  alternatives: WindAlternative[];
  recommended_response: "continue_original" | "pause_for_review";
  reasons: string[]; limitations: string[];
  source: "simulated"; execution_authorized: false; requires_human_confirmation: true;
};

/** Object key order is not part of the HTTP contract; array order and values are. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => sameValue(v, b[i]));
  if (!isRecord(a) || !isRecord(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(k => Object.hasOwn(b, k) && sameValue(a[k], b[k]));
}
function rules(value: unknown): value is RiskRules {
  return isRecord(value) && typeof value.passed === "boolean" && Array.isArray(value.checks)
    && value.checks.length > 0 && value.checks.every(c => isRecord(c) && typeof c.rule_id === "string"
      && typeof c.passed === "boolean" && typeof c.reason === "string" && isStringList(c.evidence))
    && new Set(value.checks.map(c => c.rule_id)).size === value.checks.length
    && value.passed === value.checks.every(c => c.passed);
}

/** Validate the wind-only response and bind it to the exact draft that the user adopted. */
export function readWindRiskResult(value: unknown, request: WindRiskRequest, expected: CandidateResult): WindRiskResult {
  const invalid = () => new Error("预演响应与当前事件不一致，请重试；若持续失败，请检查服务版本。");
  if (!isRecord(value) || !isRecord(value.baseline)) throw invalid();
  const baseline = readCandidateResult(value.baseline, request.planning_request);
  // readCandidateResult intentionally renders submitted geometry; inspect server geometry first.
  if (!sameValue(value.baseline.scene, request.planning_request.scene) || !sameValue(baseline, expected)) {
    throw new Error("规划基线已变化，请返回方案页重新生成并设为当前草案。");
  }
  const original = baseline.candidates.find(c => c.strategy === request.selected_strategy);
  const unknown = request.event.wind_speed_mps === null;
  if (!original || original.status !== "feasible" || value.status !== (unknown ? "needs_clarification" : "simulated")
    || value.source !== "simulated" || value.execution_authorized !== false || value.requires_human_confirmation !== true
    || value.selected_strategy !== request.selected_strategy || value.projected !== null
    || !isRecord(value.event) || value.event.id !== request.event.id || value.event.type !== "wind_change"
    || value.event.source !== request.event.source || typeof value.event.timestamp !== "string"
    || Date.parse(value.event.timestamp) !== Date.parse(request.event.timestamp)
    || value.event.wind_speed_mps !== request.event.wind_speed_mps
    || !isStringList(value.reasons) || !isStringList(value.limitations)
    || !isRecord(value.impact) || !sameValue(value.impact.direct_task_ids, original.task_order)
    || !sameValue(value.impact.dependent_task_ids, []) || !sameValue(value.impact.rescheduled_task_ids, [])
    || !isStringList(value.impact.reasons)
    || !(unknown ? value.rules_after === null : rules(value.rules_after))
    || !Array.isArray(value.alternatives) || value.alternatives.length !== 2) throw invalid();
  const after = value.rules_after as RiskRules | null;
  const canContinue = after?.passed === true;
  const recommendation = canContinue ? "continue_original" : "pause_for_review";
  if (value.recommended_response !== recommendation) throw invalid();
  for (const [i, a] of value.alternatives.entries()) {
    const eligible = i === 0 && canContinue;
    if (!isRecord(a) || a.strategy !== (i === 0 ? "continue_original" : "pause_for_review")
      || a.status !== (i === 1 || unknown ? "requires_review" : canContinue ? "eligible" : "blocked")
      || a.execution_authorized !== false || !isStringList(a.reasons) || !isStringList(a.deferred_task_ids)
      || !sameValue(a.deferred_task_ids, eligible ? [] : original.task_order)
      || !sameValue(a.projected_plan, eligible ? original : null)
      || a.distance_delta_m !== (eligible ? 0 : null) || a.duration_delta_seconds !== (eligible ? 0 : null)) throw invalid();
  }
  return { ...value, baseline } as WindRiskResult;
}

/** Values come from existing rule evidence, never from duplicated frontend thresholds. */
export function windRuleFacts(evaluation: RiskRules | null | undefined) {
  const check = evaluation?.checks.find(c => c.rule_id === "hard-wind-speed");
  const number = (key: string) => {
    const text = check?.evidence.find(line => line.startsWith(`${key}=`))?.slice(key.length + 1);
    if (!text?.trim()) return null;
    const value = Number(text);
    return Number.isFinite(value) && value >= 0 ? value : null;
  };
  return { speed: number("wind_speed_mps"), threshold: number("max_wind_speed_mps") };
}

/** Expand only the event's declared task/geometry; never accept an unrelated server scene. */
export function taskProjection(request: TaskRiskRequest, baseline: CandidateResult): CandidateRequest {
  const definition = structuredClone(baseline.task_tree.definition);
  if (!definition) throw new Error("请先生成完整任务草案。");
  for (const node of definition.nodes) {
    if (request.event.before_task_ids.includes(node.id)) node.depends_on.push(request.event.task.id);
  }
  definition.nodes.push(structuredClone(request.event.task));
  return { ...structuredClone(request.planning_request), raw_user_input: JSON.stringify(definition),
    scene: { ...structuredClone(request.planning_request.scene), targets: [
      ...structuredClone(request.planning_request.scene.targets), ...structuredClone(request.event.geometry),
    ] } };
}

/** Validate task projection, impacts and alternative evidence before any route is rendered. */
export function readTaskRiskResult(value: unknown, request: TaskRiskRequest, expected: CandidateResult): TaskRiskResult {
  const invalid = () => new Error("新增任务预演响应与当前事件不一致，请重试或检查服务版本。");
  if (!isRecord(value) || !isRecord(value.baseline)) throw invalid();
  const baseline = readCandidateResult(value.baseline, request.planning_request);
  if (!sameValue(value.baseline.scene, request.planning_request.scene) || !sameValue(baseline, expected)) {
    throw new Error("规划基线已变化，请返回方案页重新生成并设为当前草案。");
  }
  const original = baseline.candidates.find(c => c.strategy === request.selected_strategy);
  if (!original?.path || !original.score || original.status !== "feasible"
    || value.source !== "simulated" || value.execution_authorized !== false || value.requires_human_confirmation !== true
    || value.selected_strategy !== request.selected_strategy || !isRecord(value.event)
    || typeof value.event.timestamp !== "string" || Date.parse(value.event.timestamp) !== Date.parse(request.event.timestamp)
    || !sameValue({ ...value.event, timestamp: request.event.timestamp }, request.event)
    || !isStringList(value.reasons) || !isStringList(value.limitations)
    || !isRecord(value.projected) || !isRecord(value.projected.task_tree)) throw invalid();
  const projectedRequest = taskProjection(request, baseline);
  // Python and JS serialize Unicode/whitespace differently; compare the DSL as data.
  const raw = value.projected.task_tree.raw_input;
  try {
    if (typeof raw !== "string" || !sameValue(JSON.parse(raw), JSON.parse(projectedRequest.raw_user_input))) throw invalid();
  } catch { throw invalid(); }
  projectedRequest.raw_user_input = raw as string;
  if (!sameValue(value.projected.scene, projectedRequest.scene)) throw invalid();
  const projected = readCandidateResult(value.projected, projectedRequest);
  if (!sameValue(projected.task_tree.definition, JSON.parse(projectedRequest.raw_user_input))
    || !rules(value.rules_after) || !sameValue(value.rules_after, projected.rule_evaluation)
    || !sameValue(projected.rule_sources, baseline.rule_sources)
    || !(projected.effective_bounds === null && projected.candidates.length === 0 && projected.status !== "candidates")
      && !sameValue(projected.effective_bounds, baseline.effective_bounds)) throw invalid();
  const nodes = projected.task_tree.definition!.nodes;
  const descendants = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes) if (!descendants.has(node.id)
      && node.depends_on.some(id => id === request.event.task.id || descendants.has(id))) {
      descendants.add(node.id); changed = true;
    }
  }
  if (descendants.has(request.event.task.id)) throw invalid();
  const proposed = projected.candidates.find(c => c.strategy === request.selected_strategy);
  const rescheduled = proposed?.task_order.filter((id, index) => original.task_order.includes(id) && original.task_order.indexOf(id) !== index) ?? [];
  if (!isRecord(value.impact) || !sameValue(value.impact.direct_task_ids, [request.event.task.id])
    || !sameValue(value.impact.dependent_task_ids, [...descendants].sort())
    || !sameValue(value.impact.rescheduled_task_ids, rescheduled) || !isStringList(value.impact.reasons)) throw invalid();
  // Bind visits to known tasks and exact samples, including repeated visits for distinct tasks.
  for (const plan of projected.candidates) {
    const originalStrategy = baseline.candidates.find(c => c.strategy === plan.strategy);
    if (new Set(plan.task_order).size !== plan.task_order.length
      || plan.task_order.some(id => !nodes.some(n => n.id === id))
      || !originalStrategy || !sameValue(plan.assumed_completed_task_ids, originalStrategy.assumed_completed_task_ids)) throw invalid();
    for (const visit of plan.visits) {
      const node = nodes.find(n => n.id === visit.task_id);
      const point = projected.scene.targets.find(t => t.ref === visit.target_ref)?.observation_points[visit.sample_index];
      if (!node?.target?.refs.includes(visit.target_ref) || !plan.task_order.includes(visit.task_id)
        || !sameValue(point, visit.position)) throw invalid();
    }
    if (plan.status === "feasible") {
      const pending = nodes.filter(n => !plan.assumed_completed_task_ids.includes(n.id)).map(n => n.id);
      if (!projected.rule_evaluation.passed || projected.status !== "candidates"
        || !sameValue([...plan.task_order].sort(), [...pending].sort())
        || plan.task_order.some((id, index) => !plan.visits.some(v => v.task_id === id)
          || nodes.find(n => n.id === id)!.depends_on.some(dependency =>
            !plan.assumed_completed_task_ids.includes(dependency)
            && !plan.task_order.slice(0, index).includes(dependency)))) throw invalid();
    }
  }
  const eligible = proposed?.status === "feasible";
  const status = projected.status === "needs_clarification" ? "needs_clarification" : "simulated";
  const alternativeStatus = eligible ? "eligible" : status === "needs_clarification" ? "requires_review"
    : projected.status === "blocked" ? "blocked" : proposed?.status === "budget_exceeded" ? "budget_exceeded" : "infeasible";
  if (value.status !== status || value.recommended_response !== (eligible ? "replan" : "pause_for_review")
    || !Array.isArray(value.alternatives) || value.alternatives.length !== 3) throw invalid();
  const pending = [...original.task_order, request.event.task.id];
  for (const [index, item] of value.alternatives.entries()) {
    const feasible = index === 2 && eligible;
    const deferred = index === 0 ? [request.event.task.id, ...descendants].sort() : feasible ? [] : pending;
    if (!isRecord(item) || item.strategy !== ["continue_original", "pause_for_review", "replan"][index]
      || item.status !== ["blocked", "requires_review", alternativeStatus][index]
      || item.execution_authorized !== false || !isStringList(item.reasons) || !isStringList(item.deferred_task_ids)
      || !sameValue([...item.deferred_task_ids].sort(), [...deferred].sort())
      || !sameValue(item.projected_plan, feasible ? proposed : null)) throw invalid();
    const deltas = feasible ? [proposed!.path!.distance_m - original.path.distance_m,
      proposed!.score!.estimated_duration_seconds - original.score.estimated_duration_seconds] : [null, null];
    for (const [i, actual] of [item.distance_delta_m, item.duration_delta_seconds].entries()) {
      const delta = deltas[i];
      if (delta === null ? actual !== null : typeof actual !== "number" || !Number.isFinite(actual) || Math.abs(actual - delta) > 1e-7) throw invalid();
    }
  }
  return { ...value, baseline, projected } as TaskRiskResult;
}

export async function simulateRisk(request: RiskRequest, baseline: CandidateResult): Promise<RiskResult> {
  const response = await apiRequest<unknown>("/missions/simulate-risk", { method: "POST", body: request });
  return request.event.type === "wind_change"
    ? readWindRiskResult(response, request as WindRiskRequest, baseline)
    : readTaskRiskResult(response, request as TaskRiskRequest, baseline);
}
