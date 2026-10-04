import { ArrowDown, GitBranch } from "lucide-react";
import { useStore } from "zustand";
import type { Locale } from "./i18n";
import type { Workspace } from "./workspaceStore";
import { actionNames } from "./spatialTaskDraft";

export function TaskTreeViewer({ workspace, locale = "zh", bound = false }: { workspace: Workspace; locale?: Locale; bound?: boolean }) {
  const { task } = useStore(workspace.store);
  const tree = task.data?.task_tree;
  const graph = task.data?.task_dependencies;
  const nodes = tree?.definition?.nodes ?? [];
  const ordered = graph?.topological_order ?? [];
  const orderedNodes = [...nodes].sort((a, b) => ordered.indexOf(a.id) - ordered.indexOf(b.id));
  return <section className="ws-tree" aria-label={locale === "zh" ? "任务树与依赖" : "Task tree and dependencies"}>
    <p className="ws-muted">{tree ? `${tree.source_type === "mock" ? "Mock" : tree.source_type} · 任务草稿 · 未授权执行` : "解析后显示目标、完成条件与依赖关系。"}</p>
    {!tree && <div className="ws-empty"><GitBranch size={28} /><p>先理解任务，再组织行动</p></div>}
    {tree?.clarifications.length ? <div className="ws-warning" role="status"><strong>还需要补充信息</strong><ul>{tree.clarifications.map((q, i) => <li key={i}>{q.task_id && `${q.task_id}：`}{q.question}</li>)}</ul></div> : null}
    {tree?.unparsed_fragments.length ? <details className="ws-parse-fragments"><summary>未解析的原文片段</summary>{tree.unparsed_fragments.map((text, i) => <p key={i}>{text}</p>)}</details> : null}
    {graph && <p className="ws-tree-summary">{nodes.length} 个任务 · {graph.edges.length} 条依赖 · {graph.parallel_groups.length} 个执行批次</p>}
    <ol className="ws-tree-nodes">{orderedNodes.map(node => <li key={node.id}>
      <div className="ws-tree-node-heading"><span>{node.id}</span><strong>{actionNames[node.action]}</strong></div>
      <h3>{node.target?.label ?? "目标待补充"}</h3>
      <p className="ws-muted">引用：{node.target?.refs.join(" · ") || "尚未绑定"}</p>
      {node.target?.refs.length ? <p className="ws-tree-binding">{bound && node.target.refs.every(ref => ref === "A") ? "已关联示例建筑 A · 坐标未配准" : "任务引用尚未关联当前地图对象"}</p> : null}
      <ul>{node.completion_conditions.map((condition, i) => <li key={i}>{condition}</li>)}</ul>
      {!node.completion_conditions.length && <p className="ws-amber">完成条件待补充</p>}
      {node.parent_id && <p className="ws-muted">父任务：{node.parent_id}</p>}
      {node.depends_on.length > 0 && <p className="ws-dependency"><ArrowDown size={13} />前置任务：{node.depends_on.join("、")}</p>}
      {graph?.blocked_tasks[node.id]?.map((reason, i) => <p className="ws-amber" key={i}>{reason}</p>)}
    </li>)}</ol>
    {graph && graph.parallel_groups.some(group => group.length > 1) && <details className="ws-parse-fragments"><summary>可并行任务</summary>{graph.parallel_groups.filter(group => group.length > 1).map((group, i) => <p key={i}>{group.join(" · ")}</p>)}</details>}
    {tree && <p className="ws-muted ws-tree-boundary">解析完成只表示任务字段完整。空间可达性与飞行条件仍需后续检查。</p>}
  </section>;
}
