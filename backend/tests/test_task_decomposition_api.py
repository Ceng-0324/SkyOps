"""F01 HTTP 与现有场景规划契约集成，全部输入为合成 mock 数据。"""

import json
from copy import deepcopy

import pytest
from fastapi.testclient import TestClient

from app.core.orchestration import build_mission_planning_result
from app.data.scenarios import load_mission_scenario
from app.main import app


def test_json_task_drives_mission_goals_and_serialized_dependencies() -> None:
    raw = json.dumps(
        {
            "nodes": [
                {
                    "id": "capture",
                    "action": "capture",
                    "depends_on": ["inspect"],
                    "target": {"kind": "point", "label": "观察点B", "refs": ["B"]},
                    "completion_conditions": ["取得照片"],
                },
                {
                    "id": "inspect",
                    "action": "inspect",
                    "target": {"kind": "object", "label": "目标A", "refs": ["A"]},
                    "completion_conditions": ["取得四面影像"],
                },
            ]
        },
        ensure_ascii=False,
    )
    with TestClient(app) as client:
        response = client.post("/missions/plan", json={"raw_user_input": raw})
    assert response.status_code == 200
    payload = response.json()
    assert payload["mission_task"]["raw_user_input"] == raw
    assert payload["mission_task"]["operation_object"] == "目标A、观察点B"
    assert payload["mission_task"]["operation_goals"] == [
        "inspect: inspect 目标A",
        "capture: capture 观察点B",
    ]
    assert payload["task_tree"]["status"] == "parsed"
    assert payload["task_tree"]["execution_authorized"] is False
    assert payload["task_tree"]["source_type"] == "mock"
    assert payload["task_dependencies"]["topological_order"] == ["inspect", "capture"]
    assert payload["task_dependencies"]["edges"] == [
        {"prerequisite": "inspect", "dependent": "capture"}
    ]
    assert payload["planning_basis"] == "scenario_template"
    assert "尚未按输入任务生成路径" in payload["mission_plan"]["explanation"]
    assert payload["mission_plan"]["expected_coverage_percent"] == 82
    assert payload["mission_task"]["scenario_type"] == "building_facade_inspection"


@pytest.mark.parametrize("raw", ["检查这里", "不知道该做什么", "先检查A楼，再巡逻B区"])
def test_incomplete_or_unsupported_text_is_explicitly_not_execution_ready(raw: str) -> None:
    with TestClient(app) as client:
        response = client.post("/missions/plan", json={"raw_user_input": raw})
    assert response.status_code == 200
    payload = response.json()
    assert payload["task_tree"]["status"] == "needs_clarification"
    assert payload["task_tree"]["clarifications"]
    assert payload["task_tree"]["execution_authorized"] is False
    confirmations = payload["human_explanation"]["human_confirmation_required"]
    assert len(confirmations) > 3
    assert any("不授予飞行许可" in line for line in confirmations)
    if payload["task_tree"]["definition"] is None:
        assert payload["mission_task"]["operation_goals"] == []
        assert payload["task_dependencies"]["nodes"] == []


@pytest.mark.parametrize(
    "raw",
    [
        " \n ",
        "x" * 16_385,
        "{invalid",
        '{"nodes":[]}',
        '{"nodes":[{"id":"a","action":"inspect","depends_on":["missing"]}]}',
        '{"nodes":[{"id":"a","action":"inspect","depends_on":["a"]}]}',
        '{"nodes":[{"id":"a","action":"inspect","depends_on":["b"]},'
        '{"id":"b","action":"patrol","depends_on":["a"]}]}',
    ],
)
def test_invalid_input_and_dependency_return_422(raw: str) -> None:
    with TestClient(app) as client:
        response = client.post("/missions/plan", json={"raw_user_input": raw})
    assert response.status_code == 422
    assert "mission_plan" not in response.json()
    assert response.json()["detail"]


def test_unknown_scenario_keeps_404() -> None:
    with TestClient(app) as client:
        response = client.post(
            "/missions/plan", json={"raw_user_input": "检查A楼", "scenario_id": "missing"}
        )
    assert response.status_code == 404
    assert response.json()["detail"] == "Mission scenario not found: missing"


def test_task_draft_preserves_unsafe_rule_results_and_scenario_source() -> None:
    scenario = deepcopy(load_mission_scenario("shenzhen_nanshan_highrise_demo"))
    scenario["mission_task"]["source_type"] = "simulated"
    scenario["environment_state"]["wind_speed_mps"] = 20
    result = build_mission_planning_result(scenario, "检查对象[A]；完成条件：取得影像")
    assert result.task_tree.status == "parsed"
    assert result.task_tree.source_type == "simulated"
    assert result.task_tree.execution_authorized is False
    assert any(risk.id == "hard-risk-wind-speed" for risk in result.risks)
    assert "Hard constraint evaluation passed: false." in result.human_explanation.facts
    assert result.mission_plan.safety_thresholds.max_wind_speed_mps == 8
    assert "Airspace approval" in result.human_explanation.human_confirmation_required
