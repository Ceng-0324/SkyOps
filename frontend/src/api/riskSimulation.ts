import { apiRequest } from "./client";
import { readCandidateResult, type Candidate, type CandidateRequest, type CandidateResult, type Strategy } from "./candidates";
import { isRecord, isStringList } from "./task";

export type WindRiskEvent = {
  id: string; type: "wind_change"; source: "simulated"; timestamp: string;
  wind_speed_mps: number | null;
};
export type WindRiskRequest = { planning_request: CandidateRequest; selected_strategy: Strategy; event: WindRiskEvent };
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

export async function simulateWindRisk(request: WindRiskRequest, baseline: CandidateResult): Promise<WindRiskResult> {
  return readWindRiskResult(await apiRequest<unknown>("/missions/simulate-risk", { method: "POST", body: request }), request, baseline);
}
