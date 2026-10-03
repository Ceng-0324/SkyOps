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
