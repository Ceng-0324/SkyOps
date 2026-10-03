"""合成 mock 任务的 DSL、层级和澄清边界。"""

import pytest
from pydantic import ValidationError

from app.core.models.task import MAX_TASK_DEPTH, TargetReference, TaskDefinition, TaskNode, TaskTree


def test_definition_round_trip_preserves_hierarchy_and_independent_dependencies() -> None:
    definition = TaskDefinition(
        nodes=[
            TaskNode(id="parent", action="inspect"),
            TaskNode(id="child", action="capture", parent_id="parent"),
            TaskNode(id="other", action="survey", depends_on=["child"]),
        ]
    )
    assert TaskDefinition.model_validate_json(definition.model_dump_json()) == definition
    assert definition.nodes[1].depends_on == []


@pytest.mark.parametrize(
    "nodes,match",
    [
        ([{"id": "a"}, {"id": "a"}], "unique"),
        ([{"id": "a", "parent_id": "missing"}], "Unknown parent"),
        ([{"id": "a", "parent_id": "a"}], "Hierarchy cycle"),
        ([{"id": "a", "parent_id": "b"}, {"id": "b", "parent_id": "a"}], "Hierarchy cycle"),
        ([{"id": "a", "depends_on": ["b", "b"]}], "Duplicate dependencies"),
    ],
)
def test_invalid_structure_is_rejected(nodes: list[dict[str, object]], match: str) -> None:
    with pytest.raises(ValidationError, match=match):
        TaskDefinition.model_validate({"nodes": [{"action": "inspect", **node} for node in nodes]})


def test_depth_is_bounded() -> None:
    nodes = [TaskNode(id="n0", action="inspect")]
    for index in range(1, MAX_TASK_DEPTH):
        nodes.append(TaskNode(id=f"n{index}", action="inspect", parent_id=f"n{index - 1}"))
    assert len(TaskDefinition(nodes=nodes).nodes) == MAX_TASK_DEPTH
    nodes.append(TaskNode(id="last", action="inspect", parent_id=nodes[-1].id))
    with pytest.raises(ValidationError, match="depth"):
        TaskDefinition(nodes=nodes)


@pytest.mark.parametrize("kind", ["point", "line", "area", "object", "object_set"])
def test_typed_reference_is_a_draft_not_flight_authorization(kind: str) -> None:
    node = TaskNode.model_validate(
        {
            "id": "a",
            "action": "inspect",
            "target": {"kind": kind, "label": "A", "refs": ["A"]},
            "completion_conditions": ["取得目标影像"],
        }
    )
    tree = TaskTree(
        raw_input="mock sample", input_format="json", definition=TaskDefinition(nodes=[node])
    )
    assert tree.status == "parsed"
    assert tree.execution_authorized is False
    assert tree.source_type == "mock"
    assert tree.model_dump(mode="json")["status"] == "parsed"


def test_unresolved_target_and_missing_conditions_require_clarification() -> None:
    node = TaskNode(
        id="a", action="inspect", target=TargetReference(kind="unresolved", label="这里")
    )
    tree = TaskTree(
        raw_input="检查这里", input_format="text", definition=TaskDefinition(nodes=[node])
    )
    assert tree.status == "needs_clarification"
    assert {q.code for q in tree.clarifications} == {"unresolved_target", "missing_completion"}
    assert all(q.task_id == "a" for q in tree.clarifications)


@pytest.mark.parametrize(
    "payload",
    [
        {"kind": "object", "label": "A", "refs": ["A", "B"]},
        {"kind": "unresolved", "label": "这里", "refs": ["A"]},
        {"kind": "object_set", "label": "A", "refs": ["A", "A"]},
        {"kind": "point", "label": "A", "refs": [" "]},
        {"kind": "point", "label": "A", "coordinates": [1, 2]},
    ],
)
def test_invalid_target_contract(payload: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        TargetReference.model_validate(payload)


def test_dsl_rejects_unknown_fields_empty_nodes_and_unsafe_output() -> None:
    for payload in [
        {"nodes": []},
        {"nodes": [{"id": "a", "action": "approve"}]},
        {"nodes": [{"id": "a", "action": "inspect"}], "approve": True},
    ]:
        with pytest.raises(ValidationError):
            TaskDefinition.model_validate(payload)
    with pytest.raises(ValidationError):
        TaskTree(raw_input="x", input_format="text", definition=None)
    with pytest.raises(ValidationError):
        TaskTree.model_validate(
            {
                "raw_input": "x",
                "input_format": "text",
                "definition": None,
                "unparsed_fragments": ["x"],
                "execution_authorized": True,
            }
        )
