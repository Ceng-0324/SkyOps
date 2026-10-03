"""验证显式执行依赖，生成可复现的 DAG 视图和语义阻塞原因。"""

import networkx as nx

from app.core.models.task import TaskDependencyEdge, TaskDependencyGraph, TaskTree


class TaskDependencyError(ValueError):
    """未知前置任务、自依赖或执行环。"""


def build_dependency_graph(task_tree: TaskTree) -> nx.DiGraph:
    """建立前置任务到后续任务的 DAG；不把父子层级视为执行依赖。"""
    graph = nx.DiGraph()
    if task_tree.definition is None:
        return graph
    nodes = task_tree.definition.nodes
    graph.add_nodes_from(sorted(node.id for node in nodes))
    for node in sorted(nodes, key=lambda item: item.id):
        for prerequisite in sorted(node.depends_on):
            if prerequisite not in graph:
                raise TaskDependencyError(f"Unknown prerequisite {prerequisite} for task {node.id}")
            if prerequisite == node.id:
                raise TaskDependencyError(f"Task {node.id} cannot depend on itself")
            graph.add_edge(prerequisite, node.id)
    if not nx.is_directed_acyclic_graph(graph):
        cycle = nx.find_cycle(graph)
        path = " -> ".join([cycle[0][0], *(edge[1] for edge in cycle)])
        raise TaskDependencyError(f"Task dependency cycle: {path}")
    return graph


def describe_dependencies(task_tree: TaskTree) -> TaskDependencyGraph:
    """序列化 DAG 并传播理解缺口；全局未解析片段使所有节点受阻。"""
    graph = build_dependency_graph(task_tree)
    order = list(nx.lexicographical_topological_sort(graph))
    blocked: dict[str, list[str]] = {}
    for question in task_tree.clarifications:
        affected = [question.task_id] if question.task_id else sorted(graph.nodes)
        for task_id in affected:
            blocked.setdefault(task_id, []).append(question.question)
    for task_id in order:
        for predecessor in sorted(graph.predecessors(task_id)):
            if predecessor in blocked:
                blocked.setdefault(task_id, []).append(f"前置任务 {predecessor} 尚待澄清。")
    return TaskDependencyGraph(
        nodes=sorted(graph.nodes),
        edges=[TaskDependencyEdge(prerequisite=a, dependent=b) for a, b in sorted(graph.edges)],
        topological_order=order,
        parallel_groups=[sorted(group) for group in nx.topological_generations(graph)],
        blocked_tasks={task_id: blocked[task_id] for task_id in sorted(blocked)},
    )
