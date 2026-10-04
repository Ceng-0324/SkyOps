from pydantic import BaseModel, Field


class LaunchLandingPoint(BaseModel):
    id: str
    name: str
    description: str
    safety_notes: list[str] = Field(default_factory=list)


class SafetyThresholds(BaseModel):
    max_wind_speed_mps: float = Field(ge=0)
    min_battery_percent: int = Field(ge=0, le=100)
    min_gps_confidence: float = Field(ge=0, le=1)
    max_video_latency_ms: int = Field(ge=0)


class MissionPlan(BaseModel):
    mission_id: str
    recommended_time_window: str
    launch_landing_points: list[LaunchLandingPoint] = Field(default_factory=list)
    route_strategy: str
    flight_segments: list[str] = Field(default_factory=list)
    safety_thresholds: SafetyThresholds
    abort_conditions: list[str] = Field(default_factory=list)
    contingency_plan: list[str] = Field(default_factory=list)
    expected_coverage_percent: int = Field(ge=0, le=100)
    estimated_duration_minutes: int = Field(ge=0)
    explanation: str
