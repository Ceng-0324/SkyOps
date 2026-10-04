import type { DataSourceType } from "./mission";

export type TaskNode = {
  id: string;
  action: "inspect" | "patrol" | "capture" | "survey";
  target: { kind: string; label: string; refs: string[] } | null;
  completion_conditions: string[];
  parent_id: string | null;
  depends_on: string[];
};

export type TaskTree = {
  raw_input: string;
  input_format: "json" | "text";
  definition: { version: 1; nodes: TaskNode[] } | null;
  unparsed_fragments: string[];
  status: "parsed" | "needs_clarification";
  source_type: DataSourceType;
  boundary: "draft";
  execution_authorized: false;
  clarifications: { code: string; task_id: string | null; question: string }[];
};

export type TaskDependencies = {
  nodes: string[];
  edges: { prerequisite: string; dependent: string }[];
  topological_order: string[];
  parallel_groups: string[][];
  blocked_tasks: Record<string, string[]>;
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === "string");
}

export function isSource(value: unknown): value is DataSourceType {
  return value === "mock" || value === "simulated" || value === "real";
}

export function isTaskTree(value: unknown): value is TaskTree {
  if (!isRecord(value) || typeof value.raw_input !== "string"
    || !["json", "text"].includes(String(value.input_format))
    || !["parsed", "needs_clarification"].includes(String(value.status))
    || value.boundary !== "draft" || value.execution_authorized !== false
    || !isSource(value.source_type) || !isStringList(value.unparsed_fragments)
    || !Array.isArray(value.clarifications)
    || !value.clarifications.every(q => isRecord(q) && typeof q.code === "string"
      && (q.task_id === null || typeof q.task_id === "string") && typeof q.question === "string")) return false;
  if (value.definition === null) return value.status === "needs_clarification";
  if (!isRecord(value.definition) || value.definition.version !== 1
    || !Array.isArray(value.definition.nodes) || !value.definition.nodes.length) return false;
  const nodes = value.definition.nodes;
  if (!nodes.every(n => isRecord(n) && typeof n.id === "string"
    && ["inspect", "patrol", "capture", "survey"].includes(String(n.action))
    && (n.parent_id === null || typeof n.parent_id === "string")
    && isStringList(n.depends_on) && isStringList(n.completion_conditions)
    && (n.target === null || (isRecord(n.target) && typeof n.target.kind === "string"
      && typeof n.target.label === "string" && isStringList(n.target.refs))))) return false;
  const ids = new Set(nodes.map(n => n.id));
  return ids.size === nodes.length && nodes.every(n =>
    (n.parent_id === null || ids.has(n.parent_id)) && n.depends_on.every((id: string) => ids.has(id)));
}

export function isTaskDependencies(value: unknown): value is TaskDependencies {
  return isRecord(value) && isStringList(value.nodes) && isStringList(value.topological_order)
    && Array.isArray(value.edges) && value.edges.every(e => isRecord(e)
      && typeof e.prerequisite === "string" && typeof e.dependent === "string")
    && Array.isArray(value.parallel_groups) && value.parallel_groups.every(isStringList)
    && isRecord(value.blocked_tasks) && Object.values(value.blocked_tasks).every(isStringList);
}
