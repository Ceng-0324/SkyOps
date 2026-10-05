from fastapi import APIRouter, HTTPException

from app.api.schemas import (
    MissionPlanRequest,
    MissionPlanResponse,
    MissionReplanRequest,
    MissionReplanResponse,
    MissionReviewRequest,
    MissionReviewResponse,
)
from app.core.models.candidate_planning import CandidatePlanningRequest, CandidatePlanningResult
from app.core.models.risk_simulation import RiskSimulationRequest, RiskSimulationResult
from app.core.orchestration import plan_mission, replan_mission, review_mission
from app.core.orchestration.mission_planner import plan_mission_candidates
from app.core.risk.simulator import RiskSimulationInputError, simulate_scenario
from app.core.task_decomposition.dependency import TaskDependencyError
from app.core.task_decomposition.parser import TaskInputError
from app.data.scenarios import ScenarioNotFoundError

router = APIRouter(prefix="/missions", tags=["missions"])


@router.post(
    "/simulate-risk",
    responses={
        404: {"description": "Mission scenario not found"},
        422: {"description": "Invalid planning input, event or task dependency change"},
    },
)
def create_risk_simulation(request: RiskSimulationRequest) -> RiskSimulationResult:
    """基于所选 F03 候选预演事件影响与响应后果，不下发执行指令。"""
    try:
        return simulate_scenario(request)
    except ScenarioNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except (TaskInputError, TaskDependencyError, RiskSimulationInputError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post(
    "/plan-candidates",
    responses={
        404: {"description": "Mission scenario not found"},
        422: {"description": "Invalid task DSL, dependencies or planning geometry"},
    },
)
def create_mission_candidates(request: CandidatePlanningRequest) -> CandidatePlanningResult:
    """返回局部空间的三策略候选或显式澄清/阻塞；不授予飞行许可。"""
    try:
        return plan_mission_candidates(request)
    except ScenarioNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except (TaskInputError, TaskDependencyError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/plan")
def create_mission_plan(request: MissionPlanRequest) -> MissionPlanResponse:
    try:
        planning_result = plan_mission(
            scenario_id=request.scenario_id,
            raw_user_input=request.raw_user_input,
        )
    except ScenarioNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except (TaskInputError, TaskDependencyError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    return MissionPlanResponse.model_validate(
        planning_result.model_dump(exclude_computed_fields=True)
    )


@router.post("/replan")
def create_replan_decision(request: MissionReplanRequest) -> MissionReplanResponse:
    try:
        replan_decision = replan_mission(
            scenario_id=request.scenario_id,
            incident_event=request.incident_event,
        )
    except ScenarioNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    return MissionReplanResponse(replan_decision=replan_decision)


@router.post("/review")
def create_mission_review(request: MissionReviewRequest) -> MissionReviewResponse:
    try:
        mission_review = review_mission(
            scenario_id=request.scenario_id,
            incident_events=request.incident_events,
        )
    except ScenarioNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    return MissionReviewResponse(mission_review=mission_review)
