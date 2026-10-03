"""F01 任务 DSL 与解析草稿；目标引用不代表已验证的空间坐标或飞行许可。"""

from typing import Annotated, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    computed_field,
    model_validator,
)

from app.core.models.common import DataSourceType

MAX_TASK_INPUT_LENGTH = 16_384
MAX_TASKS = 128
MAX_TASK_DEPTH = 16

TaskID = Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")]
TaskText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=512)]


class TargetReference(BaseModel):
    """显式目标引用；refs 由调用者提供，本模块不验证其对应的真实场景对象。"""

    model_config = ConfigDict(extra="forbid")

    kind: Literal["point", "line", "area", "object", "object_set", "unresolved"]
    label: TaskText
    refs: list[TaskText] = Field(default_factory=list, max_length=MAX_TASKS)

    @model_validator(mode="after")
    def validate_references(self) -> "TargetReference":
        """拒绝重复引用与不符合目标类型的基数。"""
        if len(self.refs) != len(set(self.refs)):
            raise ValueError("Target references must be unique")
        if self.kind == "unresolved" and self.refs:
            raise ValueError("Unresolved targets cannot contain bound references")
        if self.kind not in {"unresolved", "object_set"} and len(self.refs) > 1:
            raise ValueError("This target kind accepts only one reference")
        return self


class TaskNode(BaseModel):
    """一个有独立完成条件的动作；父子层级不自动产生执行顺序。"""

    model_config = ConfigDict(extra="forbid")

    id: TaskID
    action: Literal["inspect", "patrol", "capture", "survey"]
    target: TargetReference | None = None
    completion_conditions: list[TaskText] = Field(default_factory=list, max_length=16)
    parent_id: TaskID | None = None
    depends_on: list[TaskID] = Field(default_factory=list, max_length=MAX_TASKS)

    @model_validator(mode="after")
    def validate_unique_dependencies(self) -> "TaskNode":
        """重复依赖是无效声明；引用存在性和执行环由图模块检查。"""
        if len(self.depends_on) != len(set(self.depends_on)):
            raise ValueError(f"Duplicate dependencies for task {self.id}")
        return self


class TaskDefinition(BaseModel):
    """JSON DSL v1；nodes 是以隐式任务根为父节点的扁平树表示。"""

    model_config = ConfigDict(extra="forbid")

    version: Literal[1] = 1
    nodes: list[TaskNode] = Field(min_length=1, max_length=MAX_TASKS)

    @model_validator(mode="after")
    def validate_hierarchy(self) -> "TaskDefinition":
        """验证唯一 ID、父节点引用、层级环及最大深度。"""
        by_id = {node.id: node for node in self.nodes}
        if len(by_id) != len(self.nodes):
            raise ValueError("Task IDs must be unique")
        for node in self.nodes:
            seen: set[str] = set()
            current: TaskNode | None = node
            while current is not None:
                if current.id in seen:
                    raise ValueError(f"Hierarchy cycle at task {current.id}")
                seen.add(current.id)
                if len(seen) > MAX_TASK_DEPTH:
                    raise ValueError(f"Task hierarchy exceeds depth {MAX_TASK_DEPTH}")
                if current.parent_id is not None and current.parent_id not in by_id:
                    raise ValueError(f"Unknown parent {current.parent_id} for task {current.id}")
                current = by_id.get(current.parent_id) if current.parent_id is not None else None
        return self


class TaskClarification(BaseModel):
    """任务理解缺口，供调用者补充信息后重新提交完整输入。"""

    model_config = ConfigDict(extra="forbid")

    code: Literal["unsupported_text", "missing_target", "unresolved_target", "missing_completion"]
    task_id: TaskID | None = None
    question: TaskText


class TaskTree(BaseModel):
    """任务解析产物；parsed 仅表示语义字段齐备，不表示安全或可执行。"""

    model_config = ConfigDict(extra="forbid")

    raw_input: str = Field(min_length=1, max_length=MAX_TASK_INPUT_LENGTH)
    input_format: Literal["json", "text"]
    definition: TaskDefinition | None
    unparsed_fragments: list[TaskText] = Field(default_factory=list, max_length=MAX_TASKS)
    source_type: DataSourceType = DataSourceType.MOCK
    boundary: Literal["draft"] = "draft"
    execution_authorized: Literal[False] = False

    @model_validator(mode="after")
    def require_parse_evidence(self) -> "TaskTree":
        """不允许把空树伪装成成功解析。"""
        if not self.raw_input.strip():
            raise ValueError("Task input must not be blank")
        if self.definition is None and not self.unparsed_fragments:
            raise ValueError("Missing task definition requires an unparsed fragment")
        return self

    @computed_field
    @property
    def clarifications(self) -> list[TaskClarification]:
        """从未解析片段和节点缺口派生问题，避免状态与数据不一致。"""
        questions = [
            TaskClarification(
                code="unsupported_text",
                question=f"无法完整解析“{fragment[:400]}”，请按支持语法或 JSON DSL 重新描述。",
            )
            for fragment in self.unparsed_fragments
        ]
        for node in self.definition.nodes if self.definition else []:
            if node.target is None:
                questions.append(
                    TaskClarification(
                        code="missing_target",
                        task_id=node.id,
                        question="请提供任务目标及其对象引用。",
                    )
                )
            elif not node.target.refs:
                questions.append(
                    TaskClarification(
                        code="unresolved_target",
                        task_id=node.id,
                        question=f"请为“{node.target.label[:400]}”绑定明确的场景对象引用。",
                    )
                )
            if not node.completion_conditions:
                questions.append(
                    TaskClarification(
                        code="missing_completion",
                        task_id=node.id,
                        question="请明确该任务的完成条件。",
                    )
                )
        return questions

    @computed_field
    @property
    def status(self) -> Literal["parsed", "needs_clarification"]:
        """只评价任务理解完整性；安全检查由规则引擎承担。"""
        return "needs_clarification" if self.clarifications else "parsed"
