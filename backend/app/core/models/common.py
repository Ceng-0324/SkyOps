from enum import StrEnum

from pydantic import BaseModel, Field


class DataSourceType(StrEnum):
    MOCK = "mock"
    SIMULATED = "simulated"
    REAL = "real"


class RiskLevel(StrEnum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class Explanation(BaseModel):
    facts: list[str] = Field(default_factory=list)
    inferences: list[str] = Field(default_factory=list)
    recommended_actions: list[str] = Field(default_factory=list)
    human_confirmation_required: list[str] = Field(default_factory=list)
