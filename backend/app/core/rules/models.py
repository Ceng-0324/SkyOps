from pydantic import BaseModel, Field

from app.core.models import RiskItem, RiskLevel


class SafetyRuleConfig(BaseModel):
    max_wind_speed_mps: float = Field(ge=0)
    min_battery_percent: int = Field(ge=0, le=100)
    min_gps_confidence: float = Field(ge=0, le=1)
    max_video_latency_ms: int = Field(ge=0)
    blocked_crowd_levels: list[RiskLevel] = Field(default_factory=list)
    require_airspace_flyable: bool = True
    require_approval_when_needed: bool = True


class HardConstraintCheck(BaseModel):
    rule_id: str
    passed: bool
    risk: RiskItem | None = None
    reason: str
    evidence: list[str] = Field(default_factory=list)


class RuleEvaluationResult(BaseModel):
    passed: bool
    checks: list[HardConstraintCheck] = Field(default_factory=list)

    @property
    def risks(self) -> list[RiskItem]:
        return [check.risk for check in self.checks if check.risk is not None]
