"""mock 任务依赖的方向、稳定性、非法输入与澄清传播。"""

import json

import networkx as nx
import pytest

from app.core.task_decomposition.dependency import (
    TaskDependencyError,
    build_dependency_graph,
    describe_dependencies,
)
from app.core.task_decomposition.parser import parse_task_input


def _task(task_id: str, dependencies: list[str] | None = None) -> dict[str, object]:
    return {
        "id": task_id,
        "action": "inspect",
        "target": {"kind": "object", "label": task_id, "refs": [task_id]},
        "completion_conditions": ["取得影像"],
        "depends_on": dependencies or [],
    }


def test_fork_join_and_isolated_nodes_are_preserved_deterministically() -> None:
    nodes = [_task("d", ["b", "c"]), _task("c", ["a"]), _task("z"), _task("b", ["a"]), _task("a")]
    tree = parse_task_input(json.dumps({"nodes": nodes}))
    graph = build_dependency_graph(tree)
    assert isinstance(graph, nx.DiGraph)
    assert set(graph.edges) == {("a", "b"), ("a", "c"), ("b", "d"), ("c", "d")}
    view = describe_dependencies(tree)
    assert view.nodes == ["a", "b", "c", "d", "z"]
    assert view.topological_order == ["a", "b", "c", "d", "z"]
    assert view.parallel_groups == [["a", "z"], ["b", "c"], ["d"]]
    assert view.blocked_tasks == {}
    reverse = parse_task_input(json.dumps({"nodes": list(reversed(nodes))}))
    assert describe_dependencies(reverse) == view
    assert view.model_dump(mode="json")["edges"][0] == {"prerequisite": "a", "dependent": "b"}


def test_hierarchy_does_not_invent_execution_edges() -> None:
    tree = parse_task_input(json.dumps({"nodes": [_task("a"), {**_task("b"), "parent_id": "a"}]}))
    assert describe_dependencies(tree).parallel_groups == [["a", "b"]]
    assert list(build_dependency_graph(tree).edges) == []


@pytest.mark.parametrize(
    "nodes,message",
    [
        ([_task("a", ["missing"])], "Unknown prerequisite missing for task a"),
        ([_task("a", ["a"])], "cannot depend on itself"),
        ([_task("a", ["b"]), _task("b", ["a"])], "a -> b -> a"),
        ([_task("a", ["c"]), _task("b", ["a"]), _task("c", ["b"])], "cycle"),
    ],
)
def test_invalid_dependencies_fail_with_task_identity(
    nodes: list[dict[str, object]], message: str
) -> None:
    tree = parse_task_input(json.dumps({"nodes": nodes}))
    with pytest.raises(TaskDependencyError, match=message):
        describe_dependencies(tree)


def test_missing_information_blocks_descendants_but_not_independent_nodes() -> None:
    tree = parse_task_input(
        json.dumps(
            {
                "nodes": [
                    {**_task("a"), "target": None},
                    _task("b", ["a"]),
                    _task("c", ["b"]),
                    _task("d"),
                ]
            }
        )
    )
    view = describe_dependencies(tree)
    assert set(view.blocked_tasks) == {"a", "b", "c"}
    assert view.blocked_tasks["b"] == ["前置任务 a 尚待澄清。"]
    assert view.blocked_tasks["c"] == ["前置任务 b 尚待澄清。"]


def test_empty_parse_is_not_a_fabricated_task_and_single_node_has_no_edges() -> None:
    tree = parse_task_input("不知道执行什么")
    assert tree.status == "needs_clarification"
    assert describe_dependencies(tree).topological_order == []
    view = describe_dependencies(parse_task_input(json.dumps({"nodes": [_task("one")]})))
    assert view.topological_order == ["one"]
    assert view.edges == []


def test_text_sequence_creates_only_explicit_stage_edges() -> None:
    view = describe_dependencies(parse_task_input("先检查A楼，同时拍摄B楼，再巡逻C区"))
    assert [(edge.prerequisite, edge.dependent) for edge in view.edges] == [
        ("task-001", "task-003"),
        ("task-002", "task-003"),
    ]
    assert view.parallel_groups == [["task-001", "task-002"], ["task-003"]]
