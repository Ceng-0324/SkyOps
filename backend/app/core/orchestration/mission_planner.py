from typing import Any

from app.core.models import (
    AirspaceConstraint,
    DroneState,
    EnvironmentState,
    Explanation,
    MissionPlan,
    MissionTask,
    RiskItem,
)
from app.core.orchestration.models import MissionPlanningResult
from app.core.rules import evaluate_hard_constraints
from app.core.task_decomposition.dependency import describe_dependencies
from app.core.task_decomposition.parser import parse_task_input
from app.data.scenarios import load_mission_scenario


def plan_mission(scenario_id: str, raw_user_input: str) -> MissionPlanningResult:
    """解析用户任务，并在 mock 场景参考计划上执行确定性规则检查。"""
    scenario = load_mission_scenario(scenario_id)
    return build_mission_planning_result(
        scenario=scenario,
        raw_user_input=raw_user_input,
    )


def build_mission_planning_result(
    scenario: dict[str, Any],
    raw_user_input: str,
) -> MissionPlanningResult:
    """集成任务草稿与依赖；场景航线不冒充按输入生成的飞行计划。"""
    mission_task_data = scenario["mission_task"] | {"raw_user_input": raw_user_input}
    task_tree = parse_task_input(raw_user_input)
    task_dependencies = describe_dependencies(task_tree)
    mission_task = MissionTask.model_validate(mission_task_data)
    task_tree.source_type = mission_task.source_type
    if task_tree.definition:
        nodes = {node.id: node for node in task_tree.definition.nodes}
        ordered_nodes = [nodes[task_id] for task_id in task_dependencies.topological_order]
        mission_task.operation_object = (
            "、".join(dict.fromkeys(node.target.label for node in ordered_nodes if node.target))
            or "待确认任务目标"
        )
        mission_task.operation_goals = [
            f"{node.id}: {node.action} {node.target.label if node.target else '待确认目标'}"
            for node in ordered_nodes
        ]
    else:
        mission_task.operation_object = "待澄清输入任务；场景对象仅供参考"
        mission_task.operation_goals = []
    environment_state = EnvironmentState.model_validate(scenario["environment_state"])
    airspace_constraint = AirspaceConstraint.model_validate(scenario["airspace_constraint"])
    drone_state = DroneState.model_validate(scenario["drone_state"])
    scenario_risks = [RiskItem.model_validate(risk) for risk in scenario["risks"]]
    rule_evaluation = evaluate_hard_constraints(
        environment_state=environment_state,
        airspace_constraint=airspace_constraint,
        drone_state=drone_state,
    )
    human_explanation = Explanation.model_validate(scenario["human_explanation"])
    human_explanation.facts = [
        f"场景参考（并非输入解析结论）：{fact}" for fact in human_explanation.facts
    ]
    human_explanation.facts.append(
        f"Task understanding status: {task_tree.status}; source={task_tree.source_type.value}."
    )
    planning_note = (
        "当前航线、覆盖率、时长及环境仅为场景参考；尚未按输入任务生成路径。"
        "任务树是待审核草稿，不授予飞行许可。"
    )
    human_explanation.human_confirmation_required.append(planning_note)
    human_explanation.human_confirmation_required.extend(
        f"{question.task_id or '输入'}: {question.question}"
        for question in task_tree.clarifications
    )
    human_explanation.recommended_actions.insert(0, planning_note)
    human_explanation.facts.append(
        f"Hard constraint evaluation passed: {str(rule_evaluation.passed).lower()}."
    )
    human_explanation.inferences.extend(check.reason for check in rule_evaluation.checks)

    mission_plan = MissionPlan.model_validate(scenario["mission_plan"])
    mission_plan.explanation = f"{planning_note} {mission_plan.explanation}"
    return MissionPlanningResult(
        mission_task=mission_task,
        environment_state=environment_state,
        airspace_constraint=airspace_constraint,
        drone_state=drone_state,
        risks=[*scenario_risks, *rule_evaluation.risks],
        mission_plan=mission_plan,
        human_explanation=human_explanation,
        task_tree=task_tree,
        task_dependencies=task_dependencies,
    )
