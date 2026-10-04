import { Check, LoaderCircle, Route } from "lucide-react";
import { useStore } from "zustand";
import type { Candidate, CandidateResult, Strategy } from "../../api/candidates";
import type { Workspace } from "./workspaceStore";
import { actionNames, type SpatialTaskDraft } from "./spatialTaskDraft";
import { candidateStatusNames, planDuration, planningFields, strategyDescriptions, strategyNames, type PlanningSettings } from "./spatialPlanning";

export function SpatialPlanPanel({ workspace, reasons, settings, onSettings, selected, adopted, onSelect, onAdopt, onGenerate, onPrepare }: {
  workspace: Workspace; reasons: string[]; settings: PlanningSettings; onSettings: (settings: PlanningSettings) => void;
  selected: Candidate | undefined; adopted: Strategy | null; onSelect: (id: Strategy) => void; onAdopt: () => void; onGenerate: () => void; onPrepare: (section: "task" | "scene") => void;
}) {
  const { task, planning, priorityIds, completedIds, setTaskFlag } = useStore(workspace.store);
  const result = planning.data;
  const nodes = task.data?.task_tree.definition?.nodes ?? [];
  return <>
    <div className="ws-panel-scroll ws-plan-panel">
      <section className="ws-section">
        <div className="ws-section-heading"><h2>{result ? "候选方案" : "规划准备"}</h2><span className="ws-cyan">局部仿真</span></div>
        <p className="ws-muted">比较任务样本访问、预计耗时与几何接近风险。</p>
        {!!reasons.length && <div className="ws-warning" role="status"><ul>{reasons.map(reason => <li key={reason}>{reason}</li>)}</ul></div>}
        {!result && <div className="ws-plan-preparation"><button className="ws-button" onClick={() => onPrepare("task")}>完善任务与点位</button><button className="ws-button" onClick={() => onPrepare("scene")}>准备场景检测</button></div>}
        {planning.status === "error" && <p className="ws-error" role="alert">{planning.error}。检查输入或服务连接后重试。</p>}
        {planning.status === "loading" && <p role="status" className="ws-loading"><LoaderCircle size={16} className="ws-spinner" />正在计算三种策略…</p>}
        {result && <>
          {(result.reasons.length > 0 || result.clarifications.length > 0) && <div className="ws-warning" role="status">{[...result.reasons, ...result.clarifications].map((reason, i) => <p key={i}>{reason}</p>)}</div>}
          <div className="ws-plan-options" aria-label="候选方案列表">{result.candidates.map(plan => <button key={plan.strategy} data-select-plan={plan.strategy} className={`ws-plan-option ${selected?.strategy === plan.strategy ? "is-selected" : ""}`} aria-pressed={selected?.strategy === plan.strategy} onClick={() => onSelect(plan.strategy)}>
            <span className="ws-plan-option-heading"><strong>{strategyNames[plan.strategy]}</strong><span>{result.recommended_strategy === plan.strategy ? "评分推荐" : candidateStatusNames[plan.status]}</span></span>
            <span className="ws-plan-description">{strategyDescriptions[plan.strategy]}</span>
            {plan.score ? <span className="ws-plan-metrics"><span><small>样本覆盖率</small><strong>{plan.score.sample_coverage_percent.toFixed(0)}%</strong></span><span><small>预计耗时</small><strong>{planDuration(plan.score.estimated_duration_seconds)}</strong></span><span><small>接近风险 ↓</small><strong>{plan.score.proximity_risk.toFixed(2)}</strong></span></span> : <span className="ws-plan-note">{candidateStatusNames[plan.status]}</span>}
            {plan.reasons.map((reason, i) => <span className="ws-plan-note" key={i}>{reason}</span>)}
            {plan.assumed_completed_task_ids.length > 0 && <span className="ws-plan-note">本次访问 {plan.visits.length} 个样本；{plan.assumed_completed_task_ids.length} 个任务按用户完成声明计入。</span>}
            {plan.equivalent_to && <span className="ws-plan-note">与{strategyNames[plan.equivalent_to]}路线及访问安排等价。</span>}
          </button>)}</div>
          <div className="ws-plan-recommendation"><h3>推荐依据</h3><p>{result.recommended_strategy ? `${strategyNames[result.recommended_strategy]}取得本次最高综合评分。同分按策略固定顺序选择，不代表飞行批准。` : "没有可推荐的路线，请查看各策略的原因或待补充信息。"}</p></div>
        </>}
        <details className="ws-plan-settings"><summary>规划参数与任务声明</summary>
          <p className="ws-muted">使用 256 × 256 m 模拟影像范围。高度基准与参数为演示设定，未实测校准；仅保留在当前工作区。</p>
          {planningFields.map(field => <label key={field.key} className="ws-scene-parameter">{field.label}<input className="ws-input" data-plan-setting={field.key} type="number" min={field.min} max={field.max} step="any" value={settings[field.key]} onChange={e => onSettings({ ...settings, [field.key]: e.target.value })} /></label>)}
          {nodes.length > 0 && <><h3>任务声明</h3><p className="ws-muted">重点按勾选顺序排序，仍遵守前置依赖。完成声明只用于补采，不代表系统已核验证据。</p>{nodes.map(node => <fieldset className="ws-plan-flags" key={node.id}><legend>{node.id} · {actionNames[node.action]} · {node.target?.label}</legend><label><input type="checkbox" data-priority-task={node.id} checked={priorityIds.includes(node.id)} onChange={e => setTaskFlag("priority", node.id, e.target.checked)} />重点任务{priorityIds.includes(node.id) && ` · 顺位 ${priorityIds.indexOf(node.id) + 1}`}</label><label><input type="checkbox" data-completed-task={node.id} checked={completedIds.includes(node.id)} onChange={e => setTaskFlag("completed", node.id, e.target.checked)} />声明已完成</label>{node.depends_on.length > 0 && <p className="ws-muted">前置任务：{node.depends_on.join("、")}</p>}</fieldset>)}</>}
        </details>
      </section>
    </div>
    <footer className="ws-task-footer">
      <p role="status">{adopted ? `当前草案：${strategyNames[adopted]}。仅保留在当前工作区，未下发执行。` : "任务、点位、参数或检测变化后，候选与草案选择失效。"}</p>
      {result?.candidates.length ? <button className="ws-primary ws-full" disabled={selected?.status !== "feasible" || adopted === selected?.strategy} onClick={onAdopt}><Check size={16} />{adopted === selected?.strategy ? "已设为当前草案" : "设为当前草案"}</button> : null}
      <button className={result?.candidates.length ? "ws-button ws-full ws-plan-regenerate" : "ws-primary ws-full"} disabled={reasons.length > 0 || planning.status === "loading"} onClick={onGenerate}>{planning.status === "loading" ? <LoaderCircle className="ws-spinner" size={16} /> : <Route size={16} />}{planning.status === "error" ? "重试生成方案" : result ? "重新生成方案" : "生成候选方案"}</button>
    </footer>
  </>;
}

export function SpatialPlanDetails({ plan, result, spatial, visitIndex, onVisit }: { plan: Candidate; result: CandidateResult; spatial: SpatialTaskDraft; visitIndex: number | null; onVisit: (index: number) => void }) {
  const visits = plan.path ? [{ label: "从起止点出发", position: result.scene.start }, ...plan.visits.map(visit => ({ label: `${visit.task_id} · 观察点 ${spatial.points[visit.sample_index]?.number ?? visit.sample_index + 1}`, position: visit.position })), { label: "返回起止点", position: result.scene.start }] : [];
  return <div className="ws-plan-details">
    <p className="ws-muted">局部仿真候选 · 模拟配准 · {candidateStatusNames[plan.status]}</p>
    {plan.score && <div className="ws-plan-score"><strong>{plan.score.total.toFixed(1)}</strong><span>综合评分 / 100</span><span>往返 {plan.path?.distance_m.toFixed(1)} m</span></div>}
    {plan.reasons.map((reason, i) => <p key={i} className="ws-warning">{reason}</p>)}
    {plan.equivalent_to && <p className="ws-plan-note">与{strategyNames[plan.equivalent_to]}路线及访问安排相同，无额外差异。</p>}
    {visits.length > 0 && <section><h3>访问顺序 <small>同点返回</small></h3><ol className="ws-plan-visits">{visits.map((visit, i) => <li key={i}><button data-plan-visit={i} aria-pressed={visitIndex === i} onClick={() => onVisit(i)}><span>{i === 0 || i === visits.length - 1 ? "S" : i}</span>{visit.label}<small>{visit.position[2]} m</small></button></li>)}</ol></section>}
    {plan.assumed_completed_task_ids.length > 0 && <p className="ws-plan-note">完成声明：{plan.assumed_completed_task_ids.join("、")}。这些任务不在本次补采路线中，按用户声明计入覆盖率，未核验证据。</p>}
    {plan.score && <section><h3>评分依据 <small>同一权重比较</small></h3><dl className="ws-object-fields"><div><dt>样本覆盖 · 50%</dt><dd>{(plan.score.sample_coverage_percent * .5).toFixed(1)} / 50</dd></div><div><dt>时间效率 · 30%</dt><dd>{(plan.score.time_score * 30).toFixed(1)} / 30</dd></div><div><dt>几何间隔 · 20%</dt><dd>{((1 - plan.score.proximity_risk) * 20).toFixed(1)} / 20</dd></div></dl></section>}
    <p className="ws-muted">覆盖率是任务样本指标；接近风险衡量与已知障碍的几何间隔，不是事故概率。选择草案不会批准或执行飞行。</p>
    <details className="ws-plan-settings"><summary>规划边界与限制</summary><p className="ws-muted">规则参考场景：{result.scenario_id}；障碍来源：{result.scene.obstacle_detection.source}。规则数据不代表当前影像的实测环境。</p>{result.limitations.map((text, i) => <p className="ws-muted" key={i}>{text}</p>)}</details>
  </div>;
}
