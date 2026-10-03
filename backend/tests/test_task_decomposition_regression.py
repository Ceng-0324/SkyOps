"""F01 跨层验收：全部场景与目标为合成 mock 数据，不调用外部模型。"""

import json
from copy import deepcopy

import pytest
from fastapi.testclient import TestClient

from app.core.models.task import MAX_TASK_DEPTH, MAX_TASK_INPUT_LENGTH, MAX_TASKS
from app.core.orchestration import build_mission_planning_result
from app.core.task_decomposition.dependency import describe_dependencies
from app.core.task_decomposition.parser import parse_task_input
from app.data.scenarios import load_mission_scenario
from app.main import app


def _node(task_id: str, **changes: object) -> dict[str, object]:
    return {
        "id": task_id,
        "action": "inspect",
        "target": {"kind": "object", "label": task_id, "refs": [task_id]},
        "completion_conditions": ["取得影像"],
        **changes,
    }


@pytest.mark.parametrize(
    "raw",
    [
        "检查对象[A]；完成条件：取得四面影像",
        "先检查A、B，同时拍摄C，再巡逻D",
        "先检查对象[A]；完成条件：取得影像，再拍摄点[B]；完成条件：取得照片",
        json.dumps({"nodes": [_node("a"), _node("b", depends_on=["a"])]}),
        json.dumps({"nodes": [_node("a", target=None), _node("b", depends_on=["a"]), _node("c")]}),
        "如果风太大就先等等",
    ],
)
def test_raw_input_to_api_preserves_every_node_edge_and_clarification(raw: str) -> None:
    expected_tree = parse_task_input(raw)
    expected_graph = describe_dependencies(expected_tree)
    with TestClient(app) as client:
        payloads = [client.post("/missions/plan", json={"raw_user_input": raw}) for _ in range(2)]
    assert all(response.status_code == 200 for response in payloads)
    first, second = [response.json() for response in payloads]
    assert first == second
    assert first["task_tree"] == expected_tree.model_dump(mode="json")
    assert first["task_dependencies"] == expected_graph.model_dump(mode="json")
    assert first["mission_task"]["raw_user_input"] == raw
    if expected_tree.definition:
        by_id = {node.id: node for node in expected_tree.definition.nodes}
        assert first["mission_task"]["operation_goals"] == [
            f"{task_id}: {by_id[task_id].action} "
            f"{by_id[task_id].target.label if by_id[task_id].target else '待确认目标'}"
            for task_id in expected_graph.topological_order
        ]


def test_requests_do_not_mutate_cached_scenario_or_leak_previous_task() -> None:
    scenario = load_mission_scenario("shenzhen_nanshan_highrise_demo")
    before = deepcopy(scenario)
    with TestClient(app) as client:
        responses = [
            client.post("/missions/plan", json={"raw_user_input": raw}).json()
            for raw in [
                "检查对象[A]；完成条件：取得影像",
                "巡逻区域[B]；完成条件：覆盖全区",
                "无法理解的指令",
            ]
        ]
    assert responses[0]["mission_task"]["operation_object"] == "对象[A]"
    assert responses[1]["mission_task"]["operation_object"] == "区域[B]"
    assert responses[2]["mission_task"]["operation_goals"] == []
    assert scenario == before
    assert all(len(payload["human_explanation"]["facts"]) == 4 for payload in responses)


@pytest.mark.parametrize(
    "payload",
    [
        {"nodes": [_node("a", action="approve_flight")]},
        {"nodes": [_node("a")], "execution_authorized": True},
        {"nodes": [_node("a")], "source_type": "real"},
        {"nodes": [_node("a")], "safety_thresholds": {"max_wind_speed_mps": 100}},
        {"nodes": [_node("a", depends_on=["unknown"])]},
        {"nodes": [_node("a", parent_id="unknown")]},
        {"nodes": [_node("a", parent_id="b"), _node("b", parent_id="a")]},
        {"nodes": [_node(f"n{i}") for i in range(MAX_TASKS + 1)]},
        {
            "nodes": [
                _node("n0"),
                *[_node(f"n{i}", parent_id=f"n{i - 1}") for i in range(1, MAX_TASK_DEPTH + 1)],
            ]
        },
    ],
)
def test_invalid_dsl_cannot_become_a_successful_plan(payload: dict[str, object]) -> None:
    with TestClient(app) as client:
        response = client.post("/missions/plan", json={"raw_user_input": json.dumps(payload)})
    assert response.status_code == 422
    assert "mission_plan" not in response.json()


def test_maximum_input_is_preserved_and_one_character_over_is_rejected() -> None:
    raw = json.dumps({"nodes": [_node("a")]})
    at_limit = raw + " " * (MAX_TASK_INPUT_LENGTH - len(raw))
    with TestClient(app) as client:
        valid = client.post("/missions/plan", json={"raw_user_input": at_limit})
        invalid = client.post("/missions/plan", json={"raw_user_input": at_limit + " "})
    assert valid.status_code == 200
    assert valid.json()["task_tree"]["raw_input"] == at_limit
    assert invalid.status_code == 422


def test_all_hard_rule_failures_survive_even_a_complete_draft() -> None:
    scenario = deepcopy(load_mission_scenario("shenzhen_nanshan_highrise_demo"))
    scenario["environment_state"].update(wind_speed_mps=9, gps_confidence=0.4, crowd_level="high")
    scenario["drone_state"].update(battery_percent=30, video_latency_ms=900)
    scenario["airspace_constraint"]["is_flyable"] = False
    before = deepcopy(scenario)
    result = build_mission_planning_result(scenario, json.dumps({"nodes": [_node("a")]}))
    assert result.task_tree.status == "parsed"
    assert result.task_tree.execution_authorized is False
    assert {risk.id for risk in result.risks if risk.id.startswith("hard-risk-")} >= {
        "hard-risk-wind-speed",
        "hard-risk-gps-confidence",
        "hard-risk-crowd-level",
        "hard-risk-battery-margin",
        "hard-risk-video-latency",
        "hard-risk-airspace-flyable",
    }
    assert (
        result.mission_plan.safety_thresholds.model_dump()
        == before["mission_plan"]["safety_thresholds"]
    )
    assert "Hard constraint evaluation passed: false." in result.human_explanation.facts
    assert scenario == before


def test_dsl_size_and_depth_boundaries_are_supported() -> None:
    nodes = [{"id": f"n{i}", "action": "inspect"} for i in range(MAX_TASKS)]
    tree = parse_task_input(json.dumps({"nodes": nodes}))
    assert len(describe_dependencies(tree).nodes) == MAX_TASKS
    nodes = [
        _node("n0"),
        *[_node(f"n{i}", parent_id=f"n{i - 1}") for i in range(1, MAX_TASK_DEPTH)],
    ]
    tree = parse_task_input(json.dumps({"nodes": nodes}))
    assert len(describe_dependencies(tree).nodes) == MAX_TASK_DEPTH


def test_json_task_schema_is_available_in_openapi() -> None:
    with TestClient(app) as client:
        response = client.get("/openapi.json")
    assert response.status_code == 200
    schemas = response.json()["components"]["schemas"]
    properties = schemas["MissionPlanResponse"]["properties"]
    assert {"task_tree", "task_dependencies", "planning_basis"} <= properties.keys()
    assert schemas["TaskTree"]["properties"]["execution_authorized"]["const"] is False
