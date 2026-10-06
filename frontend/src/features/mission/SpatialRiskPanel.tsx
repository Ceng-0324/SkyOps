import { Check, LoaderCircle, Pause, RefreshCw, Route } from "lucide-react";
import { useStore } from "zustand";
import { windRuleFacts, isTaskRisk, type RiskResult } from "../../api/riskSimulation";
import type { Candidate } from "../../api/candidates";
import type { Workspace } from "./workspaceStore";
import { TaskRiskFields } from "./TaskRiskFields";
import { buildTaskRiskEvent } from "./taskRiskInput";
import { strategyNames } from "./spatialPlanning";

export function riskHeading(result: RiskResult | null): string {
  if (!result) return "等待预演";
  if (isTaskRisk(result)) return result.recommended_response === "replan" ? "建议比较重规划方案" : result.status === "needs_clarification" ? "请补充任务信息" : "建议暂停复核";
  return result.recommended_response === "continue_original" ? "可考虑继续原方案" : "建议暂停复核";
}
export function riskExplanation(result: RiskResult): string {
  if (isTaskRisk(result)) return result.recommended_response === "replan"
    ? "原方案未包含新增任务。预演保持原规划策略，将新增任务与先后约束纳入比较。"
    : "相同策略下暂未得到可用方案。原草案保留，请检查输入与预演依据后重试。";
  if (result.event.wind_speed_mps === null) return "缺少可用风速，无法判断事件后的规则状态。补充信息后重新预演。";
  if (result.rules_after?.passed) return "假设风速下既有规则通过。几何路线与静态时长估算不变，未模拟风场或能耗变化。";
  const wind = result.rules_after?.checks.find(c => c.rule_id === "hard-wind-speed");
  return wind?.passed === false
    ? `假设风速达到 ${result.event.wind_speed_mps} m/s，触发现有风速规则。原方案当前不满足继续条件。`
    : "事件后的规则检查未通过，请查看规则依据并人工复核。";
}
export function RiskInputPanel({ workspace, plan, onPrepare, onResult, onVisit }: {
  workspace: Workspace; plan: Candidate | undefined; onPrepare: () => void; onResult: () => void; onVisit: (index: number) => void;
}) {
  const { planning, planningRequest, risk, riskInput, riskEdited, setRiskInput, simulateRisk, riskEventType, setRiskEventType, taskRiskInput } = useStore(workspace.store);
  const result = risk.data;
  const facts = windRuleFacts(planning.data?.rule_evaluation);
  const affected = result?.impact.direct_task_ids ?? [];
  const nodes = planning.data?.task_tree.definition?.nodes ?? [];
  let taskError = "";
  if (riskEventType === "task_added" && planningRequest && planning.data) {
    try { buildTaskRiskEvent(taskRiskInput, planningRequest, planning.data); } catch (error) { taskError = error instanceof Error ? error.message : "请检查任务输入。"; }
  }
  const valid = riskEventType === "task_added" ? !taskError : riskInput.unknown || (riskInput.wind.trim() !== "" && Number.isFinite(Number(riskInput.wind)) && Number(riskInput.wind) >= 0);
  return <>
    <div className="ws-panel-scroll ws-risk-input">
      <section className="ws-section"><div className="ws-section-heading"><h2>预演对象</h2><span className="ws-cyan">当前草案</span></div>
        {plan ? <><div className="ws-risk-baseline"><Route size={18} /><div><strong>{strategyNames[plan.strategy]}</strong><small>{plan.task_order.length} 项任务 · {plan.visits.length} 次观察访问</small></div></div><p className="ws-muted">以当前草案为基线，比较假设事件发生后的影响。</p></>
          : <><p className="ws-muted">先在方案页生成可行候选，并设为当前草案。</p><button className="ws-button" onClick={onPrepare}>前往方案页</button></>}
      </section>
      <section className="ws-section"><div className="ws-section-heading"><h2>假设事件</h2></div>
        <div className="ws-risk-event-switch" role="group" aria-label="假设事件类型"><button aria-pressed={riskEventType === "wind_change"} onClick={() => setRiskEventType("wind_change")}>风速变化</button><button aria-pressed={riskEventType === "task_added"} onClick={() => setRiskEventType("task_added")}>新增任务</button></div>
        {riskEventType === "task_added" ? <><TaskRiskFields workspace={workspace} onVisit={onVisit} /><p className="ws-error" id="risk-task-error" role="status">{taskError}</p></> : <>
        <label className="ws-field-label" htmlFor="risk-wind">假设风速</label><div className="ws-risk-number"><input id="risk-wind" type="number" min="0" step="any" value={riskInput.wind} placeholder="输入风速" disabled={riskInput.unknown} onChange={e => setRiskInput({ ...riskInput, wind: e.target.value })} aria-invalid={!valid && Boolean(riskInput.wind)} aria-describedby="risk-wind-note risk-input-error" /><span>m/s</span></div>
        <dl className="ws-object-fields ws-risk-facts"><div><dt>基线参考风速</dt><dd>{facts.speed === null ? "未提供" : `${facts.speed} m/s`}</dd></div><div><dt>规则阻断条件</dt><dd>{facts.threshold === null ? "未提供" : `≥ ${facts.threshold} m/s`}</dd></div></dl>
        <label className="ws-risk-unknown"><input id="risk-unknown" type="checkbox" checked={riskInput.unknown} onChange={e => setRiskInput({ ...riskInput, unknown: e.target.checked })} />当前风速未知</label>
        <p id="risk-input-error" className="ws-error" hidden={valid || !riskInput.wind}>请输入不小于 0 的有限风速。</p>
        <p id="risk-wind-note" className="ws-risk-note">规则阈值沿用现有配置。此处修改的是事件假设，不改变原任务环境。</p></>}
      </section>
      {riskEventType === "wind_change" && <section className="ws-section"><div className="ws-section-heading"><h2>受影响任务</h2><span className="ws-amber">{result ? `${affected.length} 项直接影响` : "等待预演"}</span></div>
        {result ? <>{affected.map(id => {
          const node = nodes.find(n => n.id === id);
          const visits = plan?.visits.flatMap((v, i) => v.task_id === id ? [i + 1] : []) ?? [];
          return <div className="ws-risk-task" key={id}><span>{id}</span><div><strong>{node?.target?.label ?? id}</strong><p>{node?.completion_conditions.join("；")}</p><div className="ws-risk-visits">{visits.map(i => <button key={i} className="ws-text-button" data-risk-visit={i} onClick={() => onVisit(i)}>观察访问 {i}</button>)}</div></div></div>;
        })}<p className="ws-muted">风速假设作用于全场景。琥珀外圈表示受事件影响，不表示障碍或碰撞。</p></> : <p className="ws-muted">{riskEdited ? "假设已修改，旧影响标记已清除。" : "运行预演后，显示关联任务与观察访问。"}</p>}
      </section>}
    </div>
    <footer className="ws-task-footer"><p role="status">{risk.status === "loading" ? "正在核对基线并计算影响…" : riskEdited ? "假设已修改 · 请重新预演" : result ? "结果对应当前假设 · 仅用于预演" : "预演不会下发执行指令。"}</p>
      <button className="ws-primary ws-full" id="risk-run" disabled={!plan || !valid || risk.status === "loading"} onClick={() => { onResult(); void simulateRisk(); }}>{risk.status === "loading" ? <LoaderCircle className="ws-spinner" size={16} /> : <RefreshCw size={16} />}{risk.status === "error" ? "重试预演" : result || riskEdited ? "重新预演" : "开始预演"}</button>
    </footer>
  </>;
}

export function RiskResults({ workspace, plan, onPrepare }: { workspace: Workspace; plan: Candidate | undefined; onPrepare: () => void }) {
  const { risk, riskEdited, riskEventType } = useStore(workspace.store);
  const result = risk.data;
  const facts = windRuleFacts(result?.rules_after);
  const task = result && isTaskRisk(result) ? result : null;
  const proposed = task?.alternatives.find(a => a.strategy === "replan");
  return <>
    <div className="ws-risk-results-heading"><div><h2>预演结果</h2><p>假设事件：{riskEventType === "task_added" ? "新增任务" : "风速变化"}</p></div>{result && <span className="ws-risk-chip">需人工确认</span>}</div>
    <div aria-live="polite" aria-atomic="true" className="ws-risk-result-status">
      {risk.status === "loading" ? <p className="ws-loading"><LoaderCircle className="ws-spinner" size={18} />正在预演，请稍候…</p> : risk.status === "error" ? <div className="ws-risk-error" role="alert"><h3>预演未完成</h3><p>{risk.error}</p><button className="ws-text-button" onClick={onPrepare}>返回方案页核对草案</button></div> : !result ? <div className="ws-risk-empty"><h3>{!plan ? "尚未选择当前草案" : riskEdited ? "结果已失效" : "等待预演"}</h3><p>{!plan ? "生成候选并设为当前草案后，再进行风险预演。" : riskEdited ? "使用修改后的假设重新预演，旧结果不会作为当前结论。" : riskEventType === "task_added" ? "填写作业目标、完成条件和执行顺序后开始预演。" : "在事件设置中输入假设风速，或明确风速未知。"}</p></div> : <section className="ws-risk-conclusion"><h3 className={result.recommended_response !== "pause_for_review" ? "ws-cyan" : "ws-amber"}>{task ? <Route size={23} /> : result.recommended_response === "continue_original" ? <Check size={23} /> : <Pause size={23} />}{riskHeading(result)}</h3><p>{riskExplanation(result)}</p>{!isTaskRisk(result) && <div><span>假设风速 / 阈值</span><strong>{result.event.wind_speed_mps ?? "未知"} / {facts.threshold ?? "未评估"}{facts.threshold === null ? "" : " m/s"}</strong></div>}
        {task && <table className="ws-risk-delta"><thead><tr><th scope="col">方案变化</th><th scope="col">原草案</th><th scope="col">预演后</th></tr></thead><tbody>
          <tr><th scope="row">任务数量</th><td>{task.baseline.task_tree.definition?.nodes.length} 项</td><td>{task.projected.task_tree.definition?.nodes.length} 项</td></tr>
          <tr><th scope="row">观察访问</th><td>{plan?.visits.length} 次</td><td>{proposed?.projected_plan ? `${proposed.projected_plan.visits.length} 次` : "未得到可行路线"}</td></tr>
          <tr><th scope="row">路径距离</th><td>{metric(plan?.path?.distance_m, "m")}</td><td>{metric(proposed?.projected_plan?.path?.distance_m, "m")}<small>{delta(proposed?.distance_delta_m, "m")}</small></td></tr>
          <tr><th scope="row">静态时长</th><td>{metric(plan?.score?.estimated_duration_seconds, "s")}</td><td>{metric(proposed?.projected_plan?.score?.estimated_duration_seconds, "s")}<small>{delta(proposed?.duration_delta_seconds, "s")}</small></td></tr>
        </tbody></table>}
      </section>}
    </div>
    {result && <>
      <section className="ws-risk-comparison"><h3>响应比较</h3>{[...result.alternatives].sort((a, b) => Number(b.strategy === "replan") - Number(a.strategy === "replan")).map(a => <div className="ws-risk-response" key={a.strategy}><div><strong>{a.strategy === "continue_original" ? "继续原方案" : a.strategy === "replan" ? "按原策略重新规划" : "暂停并人工复核"}</strong><span className={a.status === "blocked" ? "ws-risk-blocked" : "ws-amber"}>{a.status === "blocked" ? "受阻" : a.status === "infeasible" ? "不可行" : a.status === "budget_exceeded" ? "计算预算耗尽" : result.recommended_response === a.strategy ? "建议" : a.status === "requires_review" ? "待复核" : "可考虑"}</span></div>
        <p>{task ? a.strategy === "replan" ? a.status === "eligible" ? "新增任务和先后约束已纳入原策略的往返方案。" : "未得到可行路线，请查看依据并调整输入。" : a.strategy === "continue_original" ? "原方案不包含新增任务，无法满足本次变更。" : "确认新增范围与作业条件后，再决定方案。" : a.strategy === "pause_for_review" ? "暂缓当前任务，确认风速与作业条件后重新预演。" : a.status === "eligible" ? "原路线与静态时长估算不变；规则通过不代表已获准执行。" : a.status === "blocked" ? "规则未通过；不能以原路线仍可显示作为继续依据。" : "需要补充风速，不能用基线参考值代替。"}</p>
        {a.strategy === "pause_for_review" && !task && <dl><div><dt>等待时间</dt><dd>未估算</dd></div><div><dt>返航路线</dt><dd>未计算</dd></div></dl>}
      </div>)}</section>
      {task && <section className="ws-risk-task-impact"><h3>任务影响</h3>{([['direct_task_ids', '新增任务'], ['dependent_task_ids', '依赖影响'], ['rescheduled_task_ids', '访问顺序变化']] as const).map(([key, label]) => <div key={key}><strong>{label} · {task.impact[key].length} 项</strong>{task.impact[key].map(id => <p key={id}>{task.projected.task_tree.definition?.nodes.find(n => n.id === id)?.target?.label ?? id} · {id}</p>)}</div>)}<p className="ws-muted">顺序变化指访问序号，不表示执行时间变化。</p></section>}
      <details className="ws-risk-evidence"><summary>查看规则依据与影响范围</summary>{task && task.alternatives.map(a => <div key={a.strategy}><strong>{a.strategy === "replan" ? "重规划依据" : a.strategy === "continue_original" ? "原方案依据" : "暂停依据"}</strong>{a.reasons.map((reason, i) => <p key={i}>{reason}</p>)}</div>)}{result.rules_after?.checks.map(c => <div key={c.rule_id}><strong>{c.rule_id} · {c.passed ? "通过" : "未通过"}</strong><p>{c.reason}</p><ul>{c.evidence.map((e, i) => <li key={i}>{e}</li>)}</ul></div>)}{!result.rules_after && <p>未进行事件后的规则评估。</p>}<p>直接影响：{result.impact.direct_task_ids.join("、") || "无"}</p><p>事件来源：Simulated · {new Date(result.event.timestamp).toLocaleString("zh-CN")}</p><p>规则参考场景：{result.baseline.scenario_id}</p>{result.reasons.map((r, i) => <p key={i}>{r}</p>)}</details>
    </>}
    <p className="ws-risk-note">预演不改变当前草案，也不下发暂停或返航指令。结果基于模拟输入，仍需人工确认。</p>
  </>;
}

function metric(value: number | null | undefined, unit: string): string {
  return value == null ? "未计算" : `${Number(value.toFixed(1))} ${unit}`;
}
function delta(value: number | null | undefined, unit: string): string {
  return value == null ? "" : `${value >= 0 ? "+" : ""}${Number(value.toFixed(1))} ${unit}`;
}
