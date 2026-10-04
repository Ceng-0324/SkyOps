from pydantic import BaseModel, Field

from app.core.models.common import DataSourceType, RiskLevel


class IncidentEvent(BaseModel):
    id: str
    mission_id: str
    event_type: str
    observed_value: str
    threshold: str
    severity: RiskLevel
    source_type: DataSourceType = DataSourceType.MOCK
    description: str


class ReplanDecision(BaseModel):
    incident_id: str
    decision: str
    actions: list[str] = Field(default_factory=list)
    affected_segments: list[str] = Field(default_factory=list)
    makeup_flight_required: bool
    human_takeover_required: bool
    reason: str
    alternatives_considered: list[str] = Field(default_factory=list)
