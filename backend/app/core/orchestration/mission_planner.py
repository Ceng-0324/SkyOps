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
from app.core.models.candidate_planning import (
    CandidatePlanningRequest,
    CandidatePlanningResult,
    PlanningBounds,
)
from app.core.orchestration.models import MissionPlanningResult
from app.core.rules import evaluate_hard_constraints
from app.core.strategy_composer.generator import (
    CandidateInputError,
    generate_candidate_plans,
    prepare_task_visits,
)
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


def plan_mission_candidates(request: CandidatePlanningRequest) -> CandidatePlanningResult:
    """生成基于输入几何的仿真候选，保留规则证据、澄清和各策略失败原因。"""
    scenario = load_mission_scenario(request.scenario_id)
    tree = parse_task_input(request.raw_user_input)
    # 即使随后被硬约束阻止，也不把非法依赖变成合法任务草稿。
    describe_dependencies(tree)
    environment = EnvironmentState.model_validate(scenario["environment_state"])
    airspace = AirspaceConstraint.model_validate(scenario["airspace_constraint"])
    drone = DroneState.model_validate(scenario["drone_state"])
    rules = evaluate_hard_constraints(environment, airspace, drone)
    result = CandidatePlanningResult(
        status="blocked",
        task_tree=tree,
        rule_evaluation=rules,
        scene=request.scene,
        scenario_id=request.scenario_id,
        rule_sources={
            "environment": environment.source_type,
            "airspace": airspace.source_type,
            "drone": drone.source_type,
        },
    )
    result.limitations.append(
        "场景环境与空域规则是参考数据，不证明调用者局部空间具备真实作业许可。"
    )
    if airspace.approval_required:
        result.limitations.append("场景要求空域审批；候选计算不代表审批已经完成。")
    if not rules.passed or not drone.available_for_mission:
        result.reasons = [check.reason for check in rules.checks if not check.passed]
        if not drone.available_for_mission:
            result.reasons.append("Drone is not available for this mission")
        return result
    if tree.status != "parsed":
        result.status = "needs_clarification"
        result.clarifications = [question.question for question in tree.clarifications]
        return result
    try:
        prepare_task_visits(tree, request)
    except CandidateInputError as exc:
        result.status, result.clarifications = "needs_clarification", [str(exc)]
        return result

    active_request = request.model_copy(deep=True)
    bounds = active_request.scene.bounds
    if airspace.altitude_limit_m is not None:
        origin = active_request.scene.altitude_origin_m
        if origin is None:
            result.status = "needs_clarification"
            result.clarifications = [
                "Provide altitude_origin_m in the same vertical reference "
                "as the scenario altitude limit"
            ]
            return result
        ceiling = min(bounds.maximum[2], airspace.altitude_limit_m - origin)
        if ceiling <= bounds.minimum[2]:
            result.reasons = ["Planning bounds contain no volume below the scenario altitude limit"]
            return result
        effective = PlanningBounds(minimum=bounds.minimum, maximum=(*bounds.maximum[:2], ceiling))
        points = [
            active_request.scene.start,
            *(
                point
                for target in active_request.scene.targets
                for point in target.observation_points
            ),
        ]
        if any(not effective.contains(point) for point in points):
            result.reasons = ["Start or observation sample exceeds the scenario altitude limit"]
            return result
        active_request.scene.bounds = effective
    result.effective_bounds = active_request.scene.bounds
    result.candidates = generate_candidate_plans(tree, active_request)
    for candidate in result.candidates:
        if (
            candidate.score
            and candidate.score.estimated_duration_seconds > drone.estimated_endurance_minutes * 60
        ):
            candidate.status = "infeasible"
            candidate.path, candidate.score, candidate.equivalent_to = None, None, None
            candidate.reasons = [
                "Estimated round-trip duration exceeds the scenario drone endurance"
            ]
    feasible = [candidate for candidate in result.candidates if candidate.status == "feasible"]
    if feasible:
        result.status = "candidates"
        result.recommended_strategy = max(
            feasible, key=lambda candidate: candidate.score.total if candidate.score else -1
        ).strategy
    elif any(candidate.status == "no_remaining_tasks" for candidate in result.candidates):
        result.status = "candidates"
        result.reasons = [
            "No supplementary flight is needed according to the declared completion record"
        ]
    else:
        result.status = "no_feasible_plan"
        result.reasons = [
            "No strategy produced a complete route within the given constraints and budget"
        ]
    return result
