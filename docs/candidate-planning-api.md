# F03 候选路径规划 API

`POST /missions/plan-candidates` 将 F01 任务、调用者提供的观察点和 F02 障碍快照组合为
三种策略的局部仿真候选。返回值始终为 `source: simulated`、`execution_authorized: false`。
现有 `/missions/plan` 继续返回场景参考计划，原请求和响应保持兼容。

## 请求示例

后端启动后可直接执行。示例中的位置、障碍快照和完成声明均为 mock 数据：

```bash
curl -sS http://127.0.0.1:8000/missions/plan-candidates \
  -H 'Content-Type: application/json' \
  --data-binary @- <<'JSON'
{
  "raw_user_input": "{\"nodes\":[{\"id\":\"a\",\"action\":\"inspect\",\"target\":{\"kind\":\"object\",\"label\":\"A楼\",\"refs\":[\"A\"]},\"completion_conditions\":[\"取得影像\"]},{\"id\":\"b\",\"action\":\"capture\",\"target\":{\"kind\":\"point\",\"label\":\"B点\",\"refs\":[\"B\"]},\"completion_conditions\":[\"取得照片\"]}]}",
  "scenario_id": "shenzhen_nanshan_highrise_demo",
  "priority_task_ids": ["b"],
  "completed_task_ids": ["a"],
  "scene": {
    "coordinate_frame": "local_cartesian_m",
    "source": "mock",
    "bounds": {"minimum": [0, 0, 0], "maximum": [10, 10, 4]},
    "start": [1, 1, 1],
    "altitude_origin_m": 0,
    "targets": [
      {"ref": "A", "observation_points": [[2, 1, 1], [2, 2, 1]]},
      {"ref": "B", "observation_points": [[8, 1, 1], [8, 2, 1]]}
    ],
    "obstacle_detection": {
      "source": "mock",
      "obstacles": [],
      "detection_time": "2026-10-03T00:00:00Z",
      "algorithm": "synthetic_mock"
    },
    "grid_resolution_m": 1,
    "clearance_m": 0.2,
    "cruise_speed_mps": 2,
    "observation_seconds": 5
  }
}
JSON
```

`raw_user_input` 接受 [F01 JSON DSL 或受限中文文本](task-decomposition-api.md)。
任务的每个 `target.refs` 必须与 `scene.targets[].ref` 绑定；集合目标展开所有引用。
样本代表预期访问位置，不证明目标存在、相机可见、拍摄成功或完成条件已经满足。
同一目标在多个任务中使用时，按各任务分别访问和计数。

`POST /point-cloud/detect-obstacles` 响应中的 `result` 可直接作为 `obstacle_detection`。
调用者必须保证障碍、观察点、起点和边界位于同一局部米制坐标系。F03 不读取 PCD 文件，
不变换坐标系；保留检测来源和时间，空障碍列表也不代表真实空间已确认无障碍。

## 约束与计算边界

- `scenario_id` 提供已有环境、空域和无人机参考数据；复用原硬约束检查，不修改安全阈值。
  规则失败或无人机不可用时返回 `blocked`，不进入路径搜索。
- 如场景具有高度上限，必须提供 `altitude_origin_m`，表示局部 `z=0` 在该上限的垂直基准中
  对应的高度。缺失时要求澄清；有效最大 z 为 `min(bounds.maximum.z, 上限-origin)`。
  起点或观察点超限、裁剪后没有正体积时阻断。响应同时保留原 `scene` 和 `effective_bounds`。
- 每条候选从 `start` 出发并返回 `start`；用路程/速度加观察停留估算时间。
  超过场景无人机估算续航的候选变为 `infeasible`，清除路径和评分。
- `clearance_m` 是调用者声明的几何膨胀距离（0–100 米），不构成真实安全间隔认证。
  所有已知障碍按轴对齐包围盒处理，不因检测置信度低而忽略。
- 先检查两点直连，遇阻后使用三维六邻接 A*。离网格端点连接所在网格单元的角点。
  每段连续检查碰撞，擦边与零体积障碍也按碰撞处理；网格末层裁到边界。
  当前分辨率找不到路不证明连续空间绝对不可达；策略排序也是启发式，不保证全局最优。
- 场景最多 32 个目标、每目标 16 个不重复观察点、合计 64 个观察点、128 个障碍。
  F03 最多处理 32 个任务，展开后的任务访问最多 256 次。
  坐标限制为 ±10,000 米，网格分辨率 0.1–100 米，网格节点最多 50,000。
  巡航速度 0.1–30 米/秒，单次停留 0–600 秒。
- 每策略共享最多 1,000,000 次路径扩展、几何检查及评分计算预算。预算耗尽显式失败，
  不返回已经算完的部分航线或未经完整评分的航线。

## 策略和评分

所有策略只选择依赖已就绪的任务；`parent_id` 不额外生成执行依赖，每个任务节点都是动作。

| 策略 | 行为 |
| --- | --- |
| `coverage` | 复查全部任务；就绪任务按最小观察点坐标排序，任务内也按坐标排序 |
| `focused_observation` | 复查全部任务；优先处理 `priority_task_ids` 及其前置任务，其余按最近观察点排序 |
| `supplementary_capture` | 跳过 `completed_task_ids`，对剩余就绪任务和样本按最近距离排序 |

优先列表越靠前优先级越高；距离/坐标相同以任务 ID 等稳定键打破平局。
已完成任务必须包含其全部前置任务，未知 ID 或不闭合声明要求澄清。
补采的历史完成记入 `assumed_completed_task_ids`，这是调用者声明，不是系统验证的证据。
全部完成时补采返回 `no_remaining_tasks`，无路径和评分；其他策略仍可生成复查路线。

评分字段及固定公式如下，跨候选使用相同标度：

```text
C = (本次访问样本数 + 补采认可的历史完成样本数) / 全部任务样本数
T = 往返路径长度 / cruise_speed_mps + 本次访问样本数 × observation_seconds
D = 整条路径到膨胀后障碍盒的最小距离（包含线段内部）
R = 无障碍时 0，否则 1 / (1 + D)
S = 1 / (1 + T / 60)
total = 100 × (0.5 × C + 0.3 × S + 0.2 × (1 - R))
```

对应 `sample_coverage_percent=100×C`、`estimated_duration_seconds=T`、
`proximity_risk=R`、`time_score=S`。覆盖率是样本代理指标，风险是几何接近程度，
不是实际完成度、校准事故概率或电池模型。

`recommended_strategy` 选择可行候选中的最高总分；同分按 coverage、focused_observation、
supplementary_capture 顺序选择。候选可以等价：访问、航线及完成声明完全相同时，
`equivalent_to` 指向前一个等价策略，不保证三条互不相同的路线。

## 响应状态

| 顶层 `status` | 含义 |
| --- | --- |
| `candidates` | 至少一个可行候选，或补采声明已无剩余任务；后一种可能无推荐策略 |
| `needs_clarification` | 任务、空间绑定、优先/完成声明或高度基准缺失，查看 `clarifications` |
| `blocked` | 场景硬约束、无人机可用性或高度阻止计算，查看 `reasons` |
| `no_feasible_plan` | 各策略因不可达、续航或预算失败，查看各候选 `reasons` |

各候选 `status` 为 `feasible`、`infeasible`、`budget_exceeded` 或 `no_remaining_tasks`。
只有 `feasible` 带完整 `path` 和 `score`；其余仍保留策略、预期访问与失败原因。
`rule_evaluation` 和 `rule_sources` 保留规则结果与参考数据来源。

以上业务状态返回 HTTP 200；非法 DSL、依赖、请求几何或字段约束返回 422；未知场景返回 404。
调用者必须读取状态，不能把 HTTP 200、推荐策略或 `feasible` 当作执行授权。
系统尚未验证未知障碍、地形、受限空域几何及真实审批；澄清后重新提交完整请求，
本入口不持久化对话，也不调用 LLM 批准飞行。

## 空间工作区前端

「方案」页沿用已确认的交互原型：左侧候选列表，中央主路线及至多一条对照路线，右侧可拖宽详情。
点击候选仅切换查看；「设为当前草案」单独保存本工作区的选择，不批准或执行飞行。
详情提供访问顺序与地图联动、50/30/20 评分分项、等价说明、完成声明与失败原因。
无剩余任务、不可行、预算耗尽和规则阻断均保持后端语义，不生成占位路线或评分。

- `spatialPlanning.ts` 仅将已配对 `mock-campus.pcd` 场景的任务影像点位转换到模拟米制坐标；
  支持当前绑定对象 A，其他引用提示回到任务页补正，不悄悄绑定。
- `SpatialPlanPanel.tsx` 展示候选、参数、任务级优先及完成声明。声明作用于任务，不作用于单个观察点。
- `SceneMap.tsx` 共用 XY/XZ、底图、缩放和面板避让；实线表示当前路线，虚线表示对照路线，箭头表示方向。
  相同投影位置的重复访问合并为带加号标记，详细访问顺序仍完整保留。
- 模拟影像范围为 256 × 256 m。初始规划高度上界 120 m、局部原点基准高度 0 m、
  网格 8 m、几何膨胀 1 m、速度 5 m/s、停留 5 s 均为可编辑演示参数，非实测值或安全阈值。
  规则环境仍来自请求中的参考 scenario，不冒充影像所在地点的环境数据。
- 任务、点位、参数、声明或障碍检测改变时，旧候选、对照及草案选择失效；迟到响应不恢复旧结果。
  参数、声明、结果与草案选择仅在当前工作区内存保留；刷新后需重新理解任务、检测和规划。

验证：`npm test`、`npm run build`，以及运行真实后端和 Chrome CDP 后：
`SKYOPS_UI_BASE_URL=http://127.0.0.1:5173 node scripts/test-spatial-plans-browser.mjs`。
该浏览器回归以真实 F01/F02/F03 验证主链路，另外注入响应覆盖预算耗尽与规则阻断显示。
