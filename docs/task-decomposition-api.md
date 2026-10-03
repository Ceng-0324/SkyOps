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
