"""F03 局部几何规划契约；所有路径是仿真草稿，不是飞行许可。"""

from math import ceil, prod
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.core.models.common import DataSourceType
from app.core.models.point_cloud import ObstacleDetectionResult
from app.core.models.task import MAX_TASK_INPUT_LENGTH, TaskID, TaskText, TaskTree
from app.core.rules.models import RuleEvaluationResult

Coordinate = Annotated[float, Field(ge=-10_000, le=10_000, allow_inf_nan=False)]
Position = tuple[Coordinate, Coordinate, Coordinate]
StrategyName = Literal["coverage", "focused_observation", "supplementary_capture"]
MAX_GRID_NODES = 50_000
MAX_GEOMETRY_CHECKS = 1_000_000


class PlanningBounds(BaseModel):
    """A* 有界局部空间；坐标单位为米，不解释为经纬度或海拔。"""

    model_config = ConfigDict(extra="forbid")
    minimum: Position
    maximum: Position

    @model_validator(mode="after")
    def validate_volume(self) -> "PlanningBounds":
        """每个轴必须有正长度。"""
        if any(low >= high for low, high in zip(self.minimum, self.maximum, strict=True)):
            raise ValueError("Planning bounds must have positive extent on every axis")
        return self

    def contains(self, point: Position) -> bool:
        """判断局部点是否位于闭合规划区域内。"""
        return all(
            low <= value <= high
            for low, value, high in zip(self.minimum, point, self.maximum, strict=True)
        )


class TargetGeometry(BaseModel):
    """调用者声明的目标观察点样本；不声称已验证视角或可见性。"""

    model_config = ConfigDict(extra="forbid")
    ref: TaskText
    observation_points: list[Position] = Field(min_length=1, max_length=16)

    @model_validator(mode="after")
    def validate_samples(self) -> "TargetGeometry":
        """重复点不能被重复计入完成度。"""
        if len(set(self.observation_points)) != len(self.observation_points):
            raise ValueError("Observation samples must be unique within a target")
        return self


class PlanningScene(BaseModel):
    """用户提供的同坐标系仿真场景及 F02 检测快照。"""

    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    coordinate_frame: Literal["local_cartesian_m"]
    source: Literal["mock", "simulated"]
    bounds: PlanningBounds
    start: Position
    altitude_origin_m: Coordinate | None = None
    targets: list[TargetGeometry] = Field(max_length=32)
    obstacle_detection: ObstacleDetectionResult
    grid_resolution_m: float = Field(default=1, ge=0.1, le=100)
    clearance_m: float = Field(ge=0, le=100)
    cruise_speed_mps: float = Field(ge=0.1, le=30)
    observation_seconds: float = Field(default=5, ge=0, le=600)

    @model_validator(mode="after")
    def validate_scene(self) -> "PlanningScene":
        """验证有限模型规模、包围盒、坐标域及来源，避免无界图搜索。"""
        if len({target.ref for target in self.targets}) != len(self.targets):
            raise ValueError("Target references must be unique")
        samples = [point for target in self.targets for point in target.observation_points]
        if len(samples) > 64:
            raise ValueError("Scene exceeds 64 observation samples")
        if not all(self.bounds.contains(point) for point in [self.start, *samples]):
            raise ValueError("Start and observation points must be inside planning bounds")
        counts = [
            ceil((high - low) / self.grid_resolution_m) + 1
            for low, high in zip(self.bounds.minimum, self.bounds.maximum, strict=True)
        ]
        if prod(counts) > MAX_GRID_NODES:
            raise ValueError(f"Planning grid exceeds {MAX_GRID_NODES} nodes")
        detection = self.obstacle_detection
        if len(detection.obstacles) > 128:
            raise ValueError("Scene exceeds 128 obstacles")
        if len({item.id for item in detection.obstacles}) != len(detection.obstacles):
            raise ValueError("Obstacle IDs must be unique")
        for item in detection.obstacles:
            if any(size < 0 or size > 20_000 for size in item.size):
                raise ValueError("Obstacle sizes must be non-negative and bounded")
            if any(abs(value) > 10_000 for value in item.position):
                raise ValueError("Obstacle coordinates exceed the supported local domain")
        return self


class CandidatePlanningRequest(BaseModel):
    """增量式候选规划入口；优先级与已完成记录均为调用者声明。"""

    model_config = ConfigDict(extra="forbid")
    raw_user_input: str = Field(min_length=1, max_length=MAX_TASK_INPUT_LENGTH, pattern=r"\S")
    scenario_id: str = Field(default="shenzhen_nanshan_highrise_demo", pattern=r"^[A-Za-z0-9_-]+$")
    scene: PlanningScene
    priority_task_ids: list[TaskID] = Field(default_factory=list, max_length=32)
    completed_task_ids: list[TaskID] = Field(default_factory=list, max_length=32)

    @model_validator(mode="after")
    def validate_task_selections(self) -> "CandidatePlanningRequest":
        """重复选择不隐式改变任务权重。"""
        if len(set(self.priority_task_ids)) != len(self.priority_task_ids):
            raise ValueError("Priority task IDs must be unique")
        if len(set(self.completed_task_ids)) != len(self.completed_task_ids):
            raise ValueError("Completed task IDs must be unique")
        return self


class RoutePath(BaseModel):
    """经分段碰撞检查的局部路径。"""

    points: list[Position]
    distance_m: float = Field(ge=0, allow_inf_nan=False)


class ObservationVisit(BaseModel):
    """一个候选中的观察点访问，保留任务及样本身份。"""

    task_id: TaskID
    target_ref: TaskText
    sample_index: int = Field(ge=0)
    position: Position


class PlanScore(BaseModel):
    """可解释的几何启发式评分，不是实际完成证据或事故概率。"""

    sample_coverage_percent: float = Field(ge=0, le=100)
    estimated_duration_seconds: float = Field(ge=0)
    proximity_risk: float = Field(ge=0, le=1)
    time_score: float = Field(ge=0, le=1)
    total: float = Field(ge=0, le=100)


class CandidatePlan(BaseModel):
    """独立策略候选；失败候选不带可复用的部分路径或评分。"""

    strategy: StrategyName
    status: Literal["feasible", "infeasible", "no_remaining_tasks", "budget_exceeded"]
    task_order: list[TaskID]
    visits: list[ObservationVisit]
    assumed_completed_task_ids: list[TaskID] = Field(default_factory=list)
    path: RoutePath | None = None
    score: PlanScore | None = None
    reasons: list[str] = Field(default_factory=list)
    equivalent_to: StrategyName | None = None
    execution_authorized: Literal[False] = False


class CandidatePlanningResult(BaseModel):
    """F03 完整响应；场景规则、点云来源和几何计划分别溯源。"""

    status: Literal["candidates", "needs_clarification", "blocked", "no_feasible_plan"]
    task_tree: TaskTree
    rule_evaluation: RuleEvaluationResult
    scenario_id: str
    rule_sources: dict[str, DataSourceType]
    candidates: list[CandidatePlan] = Field(default_factory=list)
    clarifications: list[str] = Field(default_factory=list)
    reasons: list[str] = Field(default_factory=list)
    recommended_strategy: StrategyName | None = None
    scene: PlanningScene
    effective_bounds: PlanningBounds | None = None
    source: Literal["simulated"] = "simulated"
    execution_authorized: Literal[False] = False
    limitations: list[str] = Field(
        default_factory=lambda: [
            "局部米制仿真；目标观察点由调用者提供，尚未验证可见性、相机视角或真实完成证据。",
            "只验证已知包围盒与规划边界；未知障碍、地形和受限空域几何需人工复核。",
            "速度和停留时间是估算参数，评分不是飞行批准、校准风险概率或电池模型。",
        ]
    )
