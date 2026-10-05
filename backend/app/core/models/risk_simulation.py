"""F04 风险预演契约：事件假设与候选比较不构成执行授权。"""

from typing import Annotated, Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator

from app.core.models.candidate_planning import (
    CandidatePlan,
    CandidatePlanningRequest,
    CandidatePlanningResult,
    StrategyName,
    TargetGeometry,
)
from app.core.models.task import TaskID, TaskNode
from app.core.rules.models import RuleEvaluationResult


class SimulationEvent(BaseModel):
    """调用者声明的事件假设及其来源；时间不表示真实遥测已验证。"""

    model_config = ConfigDict(extra="forbid")

    id: TaskID
    source: Literal["mock", "simulated"]
    timestamp: AwareDatetime


class WindChangeEvent(SimulationEvent):
    """全场景风速假设，使用绝对值；null 表示风速未知。"""

    type: Literal["wind_change"]
    wind_speed_mps: Annotated[float, Field(ge=0, allow_inf_nan=False)] | None


class TaskAddedEvent(SimulationEvent):
    """新增一个任务，可声明插入到哪些现有任务之前；禁止覆盖既有几何。"""

    type: Literal["task_added"]
    task: TaskNode
    geometry: list[TargetGeometry] = Field(default_factory=list, max_length=32)
    before_task_ids: list[TaskID] = Field(default_factory=list, max_length=32)

    @model_validator(mode="after")
    def validate_unique_inputs(self) -> "TaskAddedEvent":
        """拒绝重复插入点与重复几何，不隐式合并用户意图。"""
        if len(set(self.before_task_ids)) != len(self.before_task_ids):
            raise ValueError("Insertion task IDs must be unique")
        if len({item.ref for item in self.geometry}) != len(self.geometry):
            raise ValueError("Event geometry references must be unique")
        return self


RiskEvent = Annotated[WindChangeEvent | TaskAddedEvent, Field(discriminator="type")]
ResponseStrategy = Literal["continue_original", "pause_for_review", "replan"]


class RiskSimulationRequest(BaseModel):
    """重算指定 F03 请求和策略作为比较基线，不接受客户端伪造的可行结论。"""

    model_config = ConfigDict(extra="forbid")

    planning_request: CandidatePlanningRequest
    selected_strategy: StrategyName
    event: RiskEvent


class TaskImpact(BaseModel):
    """直接影响与执行依赖传播分开记录；排程变化不冒充依赖关系。"""

    direct_task_ids: list[TaskID] = Field(default_factory=list)
    dependent_task_ids: list[TaskID] = Field(default_factory=list)
    rescheduled_task_ids: list[TaskID] = Field(default_factory=list)
    reasons: list[str] = Field(default_factory=list)


class SimulationAlternative(BaseModel):
    """一个响应策略的可计算后果；缺少依据时不返回虚构路径或时间。"""

    strategy: ResponseStrategy
    status: Literal["eligible", "blocked", "requires_review", "infeasible", "budget_exceeded"]
    reasons: list[str]
    deferred_task_ids: list[TaskID] = Field(default_factory=list)
    projected_plan: CandidatePlan | None = None
    distance_delta_m: float | None = None
    duration_delta_seconds: float | None = None
    execution_authorized: Literal[False] = False


class RiskSimulationResult(BaseModel):
    """规则证据、影响链与响应比较；所有计算均为起点处的仿真预演。"""

    status: Literal["simulated", "needs_clarification", "baseline_unavailable"]
    baseline: CandidatePlanningResult
    selected_strategy: StrategyName
    event: RiskEvent
    rules_after: RuleEvaluationResult | None = None
    projected: CandidatePlanningResult | None = None
    impact: TaskImpact = Field(default_factory=TaskImpact)
    alternatives: list[SimulationAlternative] = Field(default_factory=list)
    recommended_response: ResponseStrategy = "pause_for_review"
    reasons: list[str] = Field(default_factory=list)
    source: Literal["simulated"] = "simulated"
    execution_authorized: Literal[False] = False
    requires_human_confirmation: Literal[True] = True
    limitations: list[str] = Field(
        default_factory=lambda: [
            "基线由原 F03 请求与所选策略重算；请核对与工作区当前草案一致。",
            "预演从原规划起点开始，不接收实时位置，不代表在途恢复或真实执行结果。",
            "风速仅参与既有硬约束检查；未模拟风场、漂移、能耗、事故概率或等待时长。",
            "新增任务使用调用者声明的观察点；排程和几何可行不证明采集质量或完成条件。",
            "完成记录仍是调用者声明；已完成证据验证和在途增量恢复分别属于 F05、F06。",
            "所有建议需要人工确认；规则通过、候选可行和推荐响应均不授予飞行许可。",
        ]
    )
