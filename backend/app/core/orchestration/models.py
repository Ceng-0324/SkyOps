from typing import Literal

from pydantic import BaseModel

from app.core.models import (
    AirspaceConstraint,
    DroneState,
    EnvironmentState,
    Explanation,
    MissionPlan,
    MissionTask,
    RiskItem,
)
from app.core.models.task import TaskDependencyGraph, TaskTree


class MissionPlanningResult(BaseModel):
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
