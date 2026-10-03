"""有界 JSON DSL 与明确限定的中文任务语法解析。"""

import json
import re
from typing import Any

from pydantic import ValidationError

from app.core.models.task import (
    MAX_TASK_INPUT_LENGTH,
    MAX_TASKS,
    TargetReference,
    TaskDefinition,
    TaskNode,
    TaskTree,
)

_ACTIONS = {
    "检查": "inspect",
    "巡检": "inspect",
    "巡逻": "patrol",
    "拍摄": "capture",
    "测绘": "survey",
}
_KINDS = {"点": "point", "线": "line", "区域": "area", "对象": "object", "对象集合": "object_set"}
_CLAUSE = re.compile(
    r"(?P<action>检查|巡检|巡逻|拍摄|测绘)(?P<target>[^；;：:]+?)"
    r"(?:[；;]完成条件[：:](?P<completion>[^；;]+))?"
)
_REFERENCE = re.compile(r"(点|线|区域|对象|对象集合)\[([^\[\]]+)\]")
# 文本入口只接受已定义的完成描述；开放尾部字符串无法区分成果与新的指令。
# 复杂条件由 JSON 字段显式划定边界，不靠关键词黑名单猜测语义。
_TEXT_COMPLETIONS = frozenset({"取得影像", "取得四面影像", "取得照片", "覆盖全区"})


class TaskInputError(ValueError):
    """任务输入格式或资源限制不合法；可向调用者返回明确的 422。"""


def _unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise TaskInputError(f"Duplicate JSON field: {key}")
        result[key] = value
    return result


def _reject_constant(value: str) -> None:
    raise TaskInputError(f"Invalid JSON constant: {value}")


def parse_task_input(raw_input: str) -> TaskTree:
    """解析完整 JSON DSL 或受限中文；不支持的文本返回待澄清草稿。"""
    if not raw_input.strip():
        raise TaskInputError("Task input must not be blank")
    if len(raw_input) > MAX_TASK_INPUT_LENGTH:
        raise TaskInputError(f"Task input exceeds {MAX_TASK_INPUT_LENGTH} characters")
    normalized = raw_input.strip()
    if normalized.startswith(("{", "[")):
        try:
            payload = json.loads(
                normalized, object_pairs_hook=_unique_object, parse_constant=_reject_constant
            )
            definition = TaskDefinition.model_validate(payload)
        except (ValueError, RecursionError) as exc:
            if isinstance(exc, ValidationError):
                # 不回传完整输入或内部异常对象，错误只包含字段位置和原因。
                errors = exc.errors(include_url=False, include_input=False, include_context=False)
                detail = "; ".join(f"{error['loc']}: {error['msg']}" for error in errors[:8])
            else:
                detail = str(exc)[:512]
            raise TaskInputError(f"Invalid task DSL: {detail}") from exc
        return TaskTree(raw_input=raw_input, input_format="json", definition=definition)

    definition = _parse_text(normalized)
    return TaskTree(
        raw_input=raw_input,
        input_format="text",
        definition=definition,
        # 限长仅影响展示，raw_input 始终保留完整原文。
        unparsed_fragments=[] if definition else [normalized[:512]],
    )


def _parse_target(value: str) -> TargetReference | None:
    match = _REFERENCE.fullmatch(value)
    if match:
        kind, raw_refs = match.groups()
        refs = [ref.strip() for ref in raw_refs.split(",")]
        return TargetReference.model_validate({"kind": _KINDS[kind], "label": value, "refs": refs})
    if "[" in value or "]" in value:
        raise TaskInputError("Invalid target reference syntax")
    # 未绑定的标签仅允许简单名称；不能把条件、否定或额外动作吞进目标。
    if not re.fullmatch(r"[\w\- ]{1,128}", value):
        return None
    if any(
        word in value
        for word in [
            *_ACTIONS,
            "不要",
            "不许",
            "禁止",
            "忽略",
            "然后",
            "之前",
            "之后",
            "如果",
            "否则",
            "并",
            "再",
            "先",
            "完成条件",
        ]
    ):
        return None
    return TargetReference(kind="unresolved", label=value)


def _parse_text(text: str) -> TaskDefinition | None:
    text = text.removesuffix("。").strip()
    text = re.sub(r"^先\s*", "", text)
    stages = re.split(r"[，,]?\s*(?:然后|再)\s*", text)
    nodes: list[TaskNode] = []
    previous_stage: list[str] = []
    try:
        for stage in stages:
            stage_ids: list[str] = []
            clauses = re.split(r"[，,]?\s*(?:同时|并行)\s*", stage)
            for clause in clauses:
                match = _CLAUSE.fullmatch(clause.strip())
                if not match:
                    return None
                action, targets, completion = match.group("action", "target", "completion")
                if completion is not None and completion.strip() not in _TEXT_COMPLETIONS:
                    return None
                for value in targets.split("、"):
                    target = _parse_target(value.strip())
                    if target is None:
                        return None
                    if len(nodes) >= MAX_TASKS:
                        raise TaskInputError(f"Task count exceeds {MAX_TASKS}")
                    node_id = f"task-{len(nodes) + 1:03d}"
                    nodes.append(
                        TaskNode.model_validate(
                            {
                                "id": node_id,
                                "action": _ACTIONS[action],
                                "target": target,
                                "completion_conditions": [completion.strip()] if completion else [],
                                "depends_on": list(previous_stage),
                            }
                        )
                    )
                    stage_ids.append(node_id)
            previous_stage = stage_ids
        return TaskDefinition(nodes=nodes)
    except ValidationError as exc:
        raise TaskInputError(
            "Text task fields exceed limits or contain invalid references"
        ) from exc
