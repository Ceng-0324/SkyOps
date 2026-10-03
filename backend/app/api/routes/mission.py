from fastapi import APIRouter, HTTPException

from app.api.schemas import (
    MissionPlanRequest,
    MissionPlanResponse,
    MissionReplanRequest,
    MissionReplanResponse,
    MissionReviewRequest,
    MissionReviewResponse,
)
from app.core.orchestration import plan_mission, replan_mission, review_mission
from app.core.task_decomposition.dependency import TaskDependencyError
from app.core.task_decomposition.parser import TaskInputError
from app.data.scenarios import ScenarioNotFoundError

router = APIRouter(prefix="/missions", tags=["missions"])


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
