import { Plus, Trash2 } from "lucide-react";
import { useStore } from "zustand";
import type { Workspace } from "./workspaceStore";
import type { TaskRiskInput } from "./taskRiskInput";

export function TaskRiskFields({ workspace, onVisit }: { workspace: Workspace; onVisit: (index: number) => void }) {
  const { planning, planningRequest, adoptedStrategy, taskRiskInput: input, setTaskRiskInput: update } = useStore(workspace.store);
  const targets = planningRequest?.scene.targets ?? [];
  const nodes = planning.data?.task_tree.definition?.nodes ?? [];
  const target = targets.find(t => t.ref === input.targetRef);
  const plan = planning.data?.candidates.find(c => c.strategy === adoptedStrategy);
  const visit = plan?.visits.findIndex(v => v.target_ref === input.targetRef) ?? -1;
  const set = (change: Partial<TaskRiskInput>) => update({ ...input, ...change });
  return <div className="ws-task-risk-fields">
    <label className="ws-field-label" htmlFor="risk-action">作业动作</label>
    <select className="ws-input" id="risk-action" value={input.action} onChange={e => set({ action: e.target.value as TaskRiskInput["action"] })}>
      <option value="capture">拍摄</option><option value="inspect">巡检</option><option value="patrol">巡逻</option><option value="survey">测绘</option>
    </select>
    <label className="ws-field-label" htmlFor="risk-target">作业目标</label>
    <select className="ws-input" id="risk-target" value={input.targetMode === "new" ? "new" : `existing:${input.targetRef}`} onChange={e => e.target.value === "new" ? set({ targetMode: "new" }) : set({ targetMode: "existing", targetRef: e.target.value.slice(9) })}>
      <option value="existing:">请选择目标</option>{input.targetRef && !target && <option value={`existing:${input.targetRef}`}>原目标已失效，请重选</option>}
      {targets.map(t => <option key={t.ref} value={`existing:${t.ref}`}>{t.ref} · 复用已有目标</option>)}
      <option value="new">新建目标 · 补充观察点</option>
    </select>
    {input.targetMode === "existing" ? <>
      <div className="ws-risk-target-row"><span>沿用 {target?.observation_points.length ?? 0} 个观察点</span><button className="ws-text-button" disabled={visit < 0} onClick={() => onVisit(visit + 1)}>在地图中查看</button></div>
    </> : <>
      <label className="ws-field-label" htmlFor="risk-new-target">新目标名称</label>
      <input className="ws-input" id="risk-new-target" maxLength={512} placeholder="例如：对象 D" value={input.newTarget} onChange={e => set({ newTarget: e.target.value })} />
      <fieldset className="ws-risk-points"><legend>观察点 · 局部 X / Y / Z（米）</legend>
        {input.points.map((point, index) => <div className="ws-risk-point-row" key={index}>
          <span>{index + 1}</span>{point.map((value, axis) => <label key={axis}><span>{["X", "Y", "Z"][axis]}</span><input className="ws-input" type="number" step="any" aria-label={`观察点 ${index + 1} ${["X", "Y", "Z"][axis]}`} value={value} onChange={e => set({ points: input.points.map((p, i) => i === index ? p.map((v, a) => a === axis ? e.target.value : v) as [string, string, string] : p) })} /></label>)}
          <button className="ws-icon" aria-label={`删除观察点 ${index + 1}`} disabled={input.points.length === 1} onClick={() => set({ points: input.points.filter((_, i) => i !== index) })}><Trash2 size={14} /></button>
        </div>)}
        <button className="ws-text-button" disabled={input.points.length >= 16} onClick={() => set({ points: [...input.points, ["", "", ""]] })}><Plus size={14} />添加观察点</button>
      </fieldset>
      {planningRequest && <p className="ws-muted ws-risk-bounds">当前边界：{["X", "Y", "Z"].map((axis, i) => `${axis} ${planningRequest.scene.bounds.minimum[i]}–${planningRequest.scene.bounds.maximum[i]} m`).join("；")}。坐标不代表经纬度。</p>}
    </>}
    <label className="ws-field-label" htmlFor="risk-completion">完成条件</label>
    <textarea className="ws-input" id="risk-completion" rows={2} maxLength={512} placeholder="例如：取得对象 A 四面的细节影像" value={input.completion} onChange={e => set({ completion: e.target.value })} />
    <h3 className="ws-risk-order-heading">执行顺序</h3>
    {([['after', '在这些任务之后'], ['before', '在这些任务之前']] as const).map(([key, label]) => <details className="ws-risk-order" key={key} open={input[key].length > 0 || undefined}>
      <summary>{label}<span>{input[key].length ? `${input[key].length} 项` : "无约束"}</span></summary>
      <div>{nodes.map(n => <label key={n.id}><input type="checkbox" data-risk-order={key} value={n.id} checked={input[key].includes(n.id)} onChange={e => set({ [key]: e.target.checked ? [...input[key], n.id] : input[key].filter(id => id !== n.id) })} /><span>{n.target?.label ?? n.id}<small>{n.id}{planningRequest?.completed_task_ids.includes(n.id) ? " · 已声明完成" : ""}</small></span></label>)}</div>
      {input[key].some(id => !nodes.some(n => n.id === id)) && <button className="ws-text-button" onClick={() => set({ [key]: input[key].filter(id => nodes.some(n => n.id === id)) })}>移除失效任务</button>}
    </details>)}
    <p className="ws-risk-note">先后约束参与重规划；预演保留原草案与原规划策略。</p>
  </div>;
}
