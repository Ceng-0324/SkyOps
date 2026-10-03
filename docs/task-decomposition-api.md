# F01 任务分解契约

任务分解产生草稿，不授予飞行许可。当前使用 mock 来源，未连接真实语言模型、地图对象注册表或飞控。

## JSON DSL v1

结构化输入使用以下 JSON 文本：

```json
{
  "version": 1,
  "nodes": [
    {
      "id": "inspect-a",
      "action": "inspect",
      "target": {"kind": "object", "label": "A楼", "refs": ["building-a"]},
      "completion_conditions": ["取得四面外立面影像"]
    },
    {
      "id": "capture-a",
      "action": "capture",
      "target": {"kind": "point", "label": "观察点A", "refs": ["viewpoint-a"]},
      "completion_conditions": ["取得观察点照片"],
      "depends_on": ["inspect-a"]
    }
  ]
}
```

- `action` 支持 `inspect`、`patrol`、`capture`、`survey`。
- `target.kind` 支持 `point`、`line`、`area`、`object`、`object_set`、`unresolved`。
  前四种最多一个引用，集合允许多个；`unresolved` 不接受引用。未绑定目标保留文字标签并要求澄清。
- `refs` 是调用者声明的对象 ID，本阶段不验证对象存在性，也不生成空间坐标。
- `parent_id` 表达任务分解层级，不自动产生执行先后关系；省略时属于隐式根节点。
- `depends_on` 表示必须先于本节点完成的任务 ID，执行依赖与层级分别验证。
- 缺少目标、目标引用或完成条件时产生澄清项。格式错误、未知字段及非法引用不能被默认任务掩盖。
- 输入最多 16,384 个字符，最多 128 个任务，层级深度最多 16；字符串、目标集合及每节点依赖也有模型限制。

`TaskTree` 保留 `raw_input`、`input_format`、`definition`、未解析片段和来源。
`status=parsed` 仅表示所需语义字段齐备；`needs_clarification` 表示尚有理解缺口。
两者的 `boundary` 都是 `draft`，`execution_authorized` 始终为 `false`。
语法完整并不证明目标引用有效、完成条件可测量、路径可飞或任务已获批准。

## 受限中文文本

动作支持“检查/巡检、巡逻、拍摄、测绘”。例如：

```text
先检查A楼、B楼，同时拍摄C楼，再测绘D区，然后巡逻E区
检查对象[building-a]；完成条件：取得四面影像
拍摄点[viewpoint-a]；完成条件：取得照片
```

“、”展开同一动作的多个目标；“同时/并行”连接同一阶段任务；“再/然后”让下一阶段
依赖前一阶段所有任务。动作需要明确写出，不推断省略动作或条件分支。
普通目标名（如 A楼、“这里”）不绑定空间对象，必须澄清。显式引用可用
`点[id]`、`线[id]`、`区域[id]`、`对象[id]`、`对象集合[id1,id2]`。
每个动作后可用 `；完成条件：描述` 提供一个条件；复杂条件列表用 JSON。
顺序/并行关键词在文本中作为语法保留字；包含这些词的对象名或条件请使用 JSON。

不支持的自由文本整体返回待澄清，不局部执行或套用默认任务。
空白、超限、非法 JSON/重复字段和无效显式引用抛出 `TaskInputError`。
现有 `MockLLMProvider` 只提供扁平关键词草稿且不表达顺序，本解析器不以它的默认目标替代任务树。

## 依赖图

`build_dependency_graph(TaskTree)` 生成 NetworkX DAG，未知引用、自依赖和执行环抛出
`TaskDependencyError`。所有节点（包括独立任务）都保留；父子关系不额外生成执行边。
`describe_dependencies` 提供稳定的节点、边、拓扑顺序与并行分组。
每条边的 `prerequisite` 是前置任务，`dependent` 是后续任务。
`blocked_tasks` 记录理解缺口，并向后继节点传播阻塞原因。
`topological_order` 与 `parallel_groups` 只表示结构关系，不排除受阻节点，也不表示可以执行。

## POST /missions/plan

继续使用已有请求 `{ "raw_user_input": "…", "scenario_id": "…" }`，默认场景不变。
将 JSON DSL 序列化为字符串放入 `raw_user_input`，或传入上述受限中文文本。

响应保留原有字段，并新增：

- `task_tree`：原文、任务定义、来源、澄清问题与 `status`。
- `task_dependencies`：依赖边、拓扑顺序、并行分组和受阻任务。
- `planning_basis: "scenario_template"`：明确当前航线、覆盖率和时长来自场景模板。

存在任务定义时，`mission_task.operation_object` 与 `operation_goals` 按任务图的拓扑顺序
生成；定义无法解析时目标标为待澄清、目标列表为空。其余场景类型、作业区域、时间窗口、
风险偏好和场景约束仍来自原场景模板，不能视为从当前输入解析的事实。
任务的完整结构、完成条件、引用和依赖以 `task_tree` 为准。
`human_explanation` 标注场景事实，增加澄清与人工确认事项；`mission_plan.explanation`
明确尚未按当前任务生成路径。硬约束检查继续使用场景环境并保留原规则结果。

HTTP 200 可以携带 `needs_clarification`，它表示成功返回草稿而非任务可执行；
调用者必须检查状态与澄清项，不能把响应码或拓扑顺序当作飞行批准。
空白/超限输入、非法 DSL、非法依赖返回 422；未知场景仍返回 404。
本阶段不提供会话持久化：澄清后重新提交完整 DSL/文本。
