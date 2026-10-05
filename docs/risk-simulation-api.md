# F04 风险预演 API

`POST /missions/simulate-risk` 使用原 [F03 规划请求](candidate-planning-api.md)及选中的策略，
在同一份场景参考快照上计算事件前后差异。所有返回均为 `source: simulated`、
`execution_authorized: false`、`requires_human_confirmation: true`。
本入口不调用旧场景模板 `/missions/replan` 或 `/missions/review`，也不修改其契约。

## 请求

`planning_request` 是生成候选时的完整 F03 请求，`selected_strategy` 是用户选中的策略，
不是服务端推荐策略。基线会在服务器重算，不接受客户端直接传入路径或安全结论。
事件必须有唯一业务标识 `id`、`source`（mock/simulated）和带时区 `timestamp`。
接口无状态，不存储事件、不执行去重或调度；同一输入产生相同计算结果。

以下示例可在启动后端后直接运行；点位与风速均为模拟数据：

```bash
curl -sS http://127.0.0.1:8000/missions/simulate-risk \
  -H 'Content-Type: application/json' --data-binary @- <<'JSON'
{
  "planning_request": {
    "raw_user_input": "检查对象[A]；完成条件：取得影像",
    "scenario_id": "shenzhen_nanshan_highrise_demo",
    "scene": {
      "coordinate_frame": "local_cartesian_m",
      "source": "mock",
      "bounds": {"minimum": [0, 0, 0], "maximum": [10, 10, 4]},
      "start": [1, 1, 1],
      "altitude_origin_m": 0,
      "targets": [{"ref": "A", "observation_points": [[2, 1, 1], [2, 2, 1]]}],
      "obstacle_detection": {
        "source": "mock", "obstacles": [],
        "detection_time": "2026-10-05T12:00:00Z", "algorithm": "synthetic_mock"
      },
      "grid_resolution_m": 1,
      "clearance_m": 0.2,
      "cruise_speed_mps": 2,
      "observation_seconds": 5
    }
  },
  "selected_strategy": "coverage",
  "event": {
    "id": "wind-1", "type": "wind_change", "source": "simulated",
    "timestamp": "2026-10-05T12:00:00Z", "wind_speed_mps": 8
  }
}
JSON
```

### 风速变化

`wind_change.wind_speed_mps` 是全场景的假设绝对风速（m/s），不是增量。
必须显式提供；`null` 表示未知并要求澄清。负数、非有限数及未知字段返回 422。
当前例子在 8 m/s 触及现有规则阈值，继续原计划返回 `blocked`，建议暂停复核。
阈值由既有规则配置决定，事件不能传入或覆盖阈值。

比较 `continue_original` 和 `pause_for_review`。风速低于阈值时只说明既有规则通过，
几何路线和静态时长估算不变；不声称无风险，不生成风场、漂移、能耗或事故概率预测。
风速未知时 `rules_after` 为 null，不把原场景数值冒充事件观测。

### 新增任务

将 `event` 替换为如下对象，可在既有 A 目标之外添加新的 D 目标任务：

```json
{
  "id": "task-1", "type": "task_added", "source": "mock",
  "timestamp": "2026-10-05T12:00:00Z",
  "task": {
    "id": "new", "action": "capture",
    "target": {"kind": "object", "label": "D", "refs": ["D"]},
    "completion_conditions": ["取得影像"], "depends_on": []
  },
  "geometry": [{"ref": "D", "observation_points": [[6, 6, 1]]}],
  "before_task_ids": []
}
```

- `task` 遵守 F01 DSL；`depends_on` 指定新任务的前置任务。
- `before_task_ids` 可指定必须在新任务之后执行的**既有**任务，系统追加依赖并传播影响。
  例如插入到 a 之前，且 c 依赖 a，则 a、c 均属于依赖影响；独立任务 b 不因此获得依赖。
- `geometry` 只补充新任务引用的新目标，并与原场景共用局部米制坐标系。
  复用既有目标时不重复提交几何；禁止覆盖已有目标、提交无关几何或超出原规划边界。
- 新 ID 不得重复；未知依赖、依赖环或新任务成为已声明完成任务的前置条件返回 422。
  系统不会悄悄删除完成声明。缺少目标、完成条件或目标几何则返回 `needs_clarification`。
- 比较继续原方案、暂停复核和重新规划。继续原方案没有新增任务和依赖，因此不可满足变更。
  重新规划复用 F03，并保持用户选中的规划策略；不会静默切换到另一个可行策略。
- 新旧候选分别有界计算，沿用 F03 的任务、几何、搜索预算、续航与高度约束。
  最多计算两批、每批三个候选；每个候选保留 F03 的 1,000,000 次预算。
  新任务导致失败时仍保留原始基线，但响应策略不返回虚构的新路线或差值。

## 响应与状态

| 字段 | 含义 |
| --- | --- |
| `baseline` | 原 F03 请求重算结果，保留规则、场景、任务树与所有候选 |
| `selected_strategy` | 本次比较所用的明确策略，基线不可用时不代选 |
| `event` | 原事件及来源、时间 |
| `rules_after` | 事件后的规则证据；尚未评估时为 null |
| `projected` | 新任务加入后的 F03 结果；风速事件不改变几何，因此为 null |
| `impact.direct_task_ids` | 风速事件下所选候选的全部访问任务，或新增任务 ID |
| `impact.dependent_task_ids` | 新增任务沿执行依赖传播到的所有后继 |
| `impact.rescheduled_task_ids` | 原任务在新候选中的访问序号变化，不是执行时刻变化 |
| `alternatives` | 各响应策略的状态、理由、延期任务与可计算的候选/差值 |
| `recommended_response` | 建议比较的响应策略，需要人工确认，不是飞行命令 |

顶层 `status`：

- `simulated`：预演完成；可能发现规则阻断、路线不可达或预算耗尽，不等于可以继续。
- `needs_clarification`：风速未知或新任务信息不完整；建议暂停，补充后重新预演。
- `baseline_unavailable`：所选原候选没有可行路线（包括待澄清、阻断、无剩余任务等）。
  不进行事件后推演，`alternatives` 为空；查看 `baseline` 和 `reasons`。

响应策略 `status` 为 `eligible`、`blocked`、`requires_review`、`infeasible` 或
`budget_exceeded`。只有 `eligible` 返回 `projected_plan` 与相对原候选的
`distance_delta_m`、`duration_delta_seconds`；负值表示该启发式候选更短。
暂停没有等待、悬停或返航模型，差值为 null，不能解释为 0 成本。

以上业务状态返回 HTTP 200。未知参考场景返回 404；非法 DSL、事件、依赖和结构约束返回 422。
新增 API 通过 OpenAPI 暴露事件联合类型。

## 接入边界

前端应提交生成当前候选时的完整请求，核对响应基线与当前草案一致；任务、场景、参数、
策略或事件变化都应使旧预演失效，并隔离迟到响应。当前 API 不持久化候选，不提供历史快照 ID。
原始场景参考数据若变更，重算基线也可能变化，调用者不能把旧预演套到新草案。

首批是原起点处的预演：不接收实时位置，不验证已采集证据，不执行 F06 的在途恢复。
F03 的样本覆盖率和本次时长仍是代理指标。真实地理配准、真实遥测、返航安全性、审批、
完成证据及等待后环境恢复均未由本接口证明。

验证：`uv run pytest tests/unit/test_risk_simulator.py tests/test_risk_simulation_api.py`。
