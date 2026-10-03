from typing import Literal

from pydantic import BaseModel, Field

from app.core.models import (
    AirspaceConstraint,
    DroneState,
    EnvironmentState,
    Explanation,
    IncidentEvent,
    MissionPlan,
    MissionReview,
    MissionTask,
    ReplanDecision,
    RiskItem,
)
from app.core.models.task import MAX_TASK_INPUT_LENGTH, TaskDependencyGraph, TaskTree


class MissionPlanRequest(BaseModel):
    raw_user_input: str = Field(min_length=1, max_length=MAX_TASK_INPUT_LENGTH, pattern=r"\S")
    scenario_id: str = "shenzhen_nanshan_highrise_demo"


class MissionPlanResponse(BaseModel):
    mission_task: MissionTask
    environment_state: EnvironmentState
    airspace_constraint: AirspaceConstraint
    drone_state: DroneState
    risks: list[RiskItem]
    mission_plan: MissionPlan
    human_explanation: Explanation
    task_tree: TaskTree
    task_dependencies: TaskDependencyGraph
    planning_basis: Literal["scenario_template"] = "scenario_template"


class MissionReplanRequest(BaseModel):
    scenario_id: str = "shenzhen_nanshan_highrise_demo"
    incident_event: IncidentEvent


class MissionReplanResponse(BaseModel):
    replan_decision: ReplanDecision


class MissionReviewRequest(BaseModel):
    scenario_id: str = "shenzhen_nanshan_highrise_demo"
    incident_events: list[IncidentEvent] = Field(default_factory=list)


class MissionReviewResponse(BaseModel):
    mission_review: MissionReview
