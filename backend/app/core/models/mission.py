from pydantic import BaseModel, Field

from app.core.models.common import DataSourceType


class MissionTask(BaseModel):
    id: str
    raw_user_input: str
    scenario_type: str
    operation_object: str
    operation_area: str
    operation_goals: list[str] = Field(default_factory=list)
    requested_time_window: str
    risk_preference: str
    special_constraints: list[str] = Field(default_factory=list)
    source_type: DataSourceType = DataSourceType.MOCK
