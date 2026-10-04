from pydantic import BaseModel, Field


class MissionReview(BaseModel):
    mission_id: str
    completion_rate: int = Field(ge=0, le=100)
    data_quality_score: int = Field(ge=0, le=100)
    risk_trigger_log: list[str] = Field(default_factory=list)
    uncovered_areas: list[str] = Field(default_factory=list)
    makeup_flight_plan: list[str] = Field(default_factory=list)
    human_review_checklist: list[str] = Field(default_factory=list)
    next_mission_optimizations: list[str] = Field(default_factory=list)
