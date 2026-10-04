from pydantic import BaseModel, Field

from app.core.models.common import RiskLevel


class RiskItem(BaseModel):
    id: str
    category: str
    description: str
    severity: RiskLevel
    probability: RiskLevel
    risk_level: RiskLevel
    trigger_condition: str
    mitigation: str
    evidence: list[str] = Field(default_factory=list)
    requires_human_confirmation: bool = False
