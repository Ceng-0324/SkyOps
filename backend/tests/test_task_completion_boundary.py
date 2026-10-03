"""合成 mock 输入：文本完成条件不能吞掉未建模的后续指令。"""

import json

import pytest
from fastapi.testclient import TestClient

from app.core.task_decomposition.parser import parse_task_input
from app.main import app


@pytest.mark.parametrize(
    "completion",
    [
        "取得影像。运输物资到B区。",
        "取得影像\n运输物资到B区",
        "取得影像\r\n运输物资到B区",
        "取得影像，如果下雨就停止",
        "取得影像,如果下雨就停止",
        "取得影像，并拍摄对象[B]",
        "取得影像并拍摄对象[B]",
        "取得影像运输物资到B区",
        "取得影像 停止作业",
        "取得影像！运输物资到B区",
        "取得影像;运输物资到B区",
        "取得影像；运输物资到B区",
        "天气允许时取得影像",
        "取得符合条件的其他成果",
    ],
)
def test_unknown_completion_tail_requires_whole_input_clarification(completion: str) -> None:
    raw = f"先检查对象[A]；完成条件：{completion}"
    tree = parse_task_input(raw)
    assert tree.status == "needs_clarification"
    assert tree.definition is None
    assert tree.raw_input == raw
    assert tree.unparsed_fragments == [raw]
    assert [question.code for question in tree.clarifications] == ["unsupported_text"]
    with TestClient(app) as client:
        response = client.post("/missions/plan", json={"raw_user_input": raw})
    assert response.status_code == 200
    payload = response.json()
    assert payload["task_tree"] == tree.model_dump(mode="json")
    assert payload["task_dependencies"]["nodes"] == []
    assert payload["task_dependencies"]["edges"] == []
    assert payload["mission_task"]["operation_goals"] == []
    assert payload["task_tree"]["execution_authorized"] is False


@pytest.mark.parametrize("completion", ["取得影像", "取得四面影像", "取得照片", "覆盖全区"])
def test_supported_completion_is_preserved_with_stage_dependencies(completion: str) -> None:
    raw = f"先检查对象[A]；完成条件：{completion}，再拍摄点[B]；完成条件：取得照片。"
    with TestClient(app) as client:
        response = client.post("/missions/plan", json={"raw_user_input": raw})
    assert response.status_code == 200
    tree = response.json()["task_tree"]
    assert tree["status"] == "parsed"
    assert tree["clarifications"] == []
    nodes = tree["definition"]["nodes"]
    assert len(nodes) == 2
    assert nodes[0]["completion_conditions"] == [completion]
    assert nodes[1]["depends_on"] == [nodes[0]["id"]]
    assert nodes[1]["target"]["refs"] == ["B"]


def test_unsupported_later_stage_does_not_return_successful_prefix() -> None:
    raw = "先检查对象[A]；完成条件：取得影像，再拍摄点[B]；完成条件：取得照片并运输物资"
    tree = parse_task_input(raw)
    assert tree.definition is None
    assert tree.status == "needs_clarification"
    assert tree.unparsed_fragments == [raw]


def test_structured_dsl_retains_explicit_completion_description() -> None:
    completion = "取得四面外立面影像，分辨率达到人工指定标准"
    raw = json.dumps(
        {
            "nodes": [
                {
                    "id": "a",
                    "action": "inspect",
                    "target": {"kind": "object", "label": "A", "refs": ["A"]},
                    "completion_conditions": [completion],
                }
            ]
        },
        ensure_ascii=False,
    )
    tree = parse_task_input(raw)
    assert tree.status == "parsed"
    assert tree.definition is not None
    assert tree.definition.nodes[0].completion_conditions == [completion]
