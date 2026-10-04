from pydantic import BaseModel, Field

from app.core.models.common import DataSourceType, RiskLevel


class AirspaceConstraint(BaseModel):
    source_type: DataSourceType = DataSourceType.MOCK
    is_flyable: bool
    approval_required: bool
    restricted_zones: list[str] = Field(default_factory=list)
    altitude_limit_m: int | None = Field(default=None, ge=0)
    compliance_risk_level: RiskLevel
    explanation: str
