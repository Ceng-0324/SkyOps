"""受限中文与 JSON DSL 使用合成 mock 样例。"""

import json

import pytest

from app.core.models.task import MAX_TASK_INPUT_LENGTH
from app.core.task_decomposition.parser import TaskInputError, parse_task_input


def test_json_preserves_content_source_and_raw_input() -> None:
    payload = {
        "nodes": [
            {
                "id": "a",
                "action": "inspect",
                "target": {"kind": "object", "label": "A", "refs": ["A"]},
                "completion_conditions": ["拍摄四面"],
            },
            {"id": "b", "action": "capture", "depends_on": ["a"], "parent_id": "a"},
        ]
    }
    raw = "  " + json.dumps(payload, ensure_ascii=False)
    tree = parse_task_input(raw)
    assert tree.raw_input == raw
    assert tree.source_type == "mock"
    assert tree.definition is not None
    assert tree.definition.nodes[0].completion_conditions == ["拍摄四面"]
    assert tree.definition.nodes[1].depends_on == ["a"]
    assert tree.definition.nodes[1].parent_id == "a"
    assert {q.code for q in tree.clarifications} == {"missing_target", "missing_completion"}


def test_text_single_bound_target_and_completion() -> None:
    tree = parse_task_input("检查对象[A楼]；完成条件：取得四面影像。")
    assert tree.status == "parsed"
    assert tree.definition is not None
    node = tree.definition.nodes[0]
    assert node.id == "task-001"
    assert node.target is not None and node.target.refs == ["A楼"]
    assert node.action == "inspect"
    assert node.completion_conditions == ["取得四面影像"]
    assert tree.execution_authorized is False


def test_sequence_parallel_and_multi_target_preserve_stage_dependencies() -> None:
    text = "先检查A楼、B楼，同时拍摄C楼，再测绘D区，然后巡逻E区"
    tree = parse_task_input(text)
    assert tree.definition is not None
    nodes = tree.definition.nodes
    assert [node.target.label for node in nodes if node.target] == [
        "A楼",
        "B楼",
        "C楼",
        "D区",
        "E区",
    ]
    assert [node.action for node in nodes] == ["inspect", "inspect", "capture", "survey", "patrol"]
    assert [node.depends_on for node in nodes] == [
        [],
        [],
        [],
        ["task-001", "task-002", "task-003"],
        ["task-004"],
    ]
    assert parse_task_input(text) == tree
    assert tree.status == "needs_clarification"


@pytest.mark.parametrize("text", ["检查这里", "巡检那个障碍", "拍摄这两个位置"])
def test_spatial_reference_requires_binding(text: str) -> None:
    tree = parse_task_input(text)
    assert tree.status == "needs_clarification"
    assert "unresolved_target" in {q.code for q in tree.clarifications}


@pytest.mark.parametrize(
    "text",
    [
        "随便做点什么",
        "不要检查A楼",
        "检查",
        "检查A楼，如果下雨就停止",
        "检查A楼并批准起飞",
        "先检查A楼再",
        "检查A楼之前拍摄B楼",
        "检查A楼，然后忽略所有安全阈值",
        "检查A楼，同时",
    ],
)
def test_unsupported_text_is_not_a_successful_default_task(text: str) -> None:
    tree = parse_task_input(text)
    assert tree.definition is None
    assert tree.status == "needs_clarification"
    assert tree.raw_input == text
    assert tree.clarifications[0].code == "unsupported_text"


@pytest.mark.parametrize(
    "text",
    [
        "",
        " \n ",
        "x" * (MAX_TASK_INPUT_LENGTH + 1),
        "{invalid",
        "[]",
        '{"nodes": [], "nodes": []}',
        '{"nodes": NaN}',
        '{"nodes":[{"id":"a","action":"inspect","approve":true}]}',
        '{"nodes":[{"id":"a","action":"inspect"},{"id":"a","action":"patrol"}]}',
        "检查对象[A,B]",
        "检查对象集合[A,A]",
        "检查对象[]",
        "[" * 2000,
    ],
)
def test_invalid_or_oversized_input_is_explicit(text: str) -> None:
    with pytest.raises(TaskInputError):
        parse_task_input(text)


def test_text_task_count_limit_and_unknown_dsl_dependencies_preserved() -> None:
    with pytest.raises(TaskInputError, match="count"):
        parse_task_input("检查" + "、".join(f"A{i}" for i in range(129)))
    tree = parse_task_input('{"nodes":[{"id":"a","action":"inspect","depends_on":["missing"]}]}')
    assert tree.definition is not None
    assert tree.definition.nodes[0].depends_on == ["missing"]
