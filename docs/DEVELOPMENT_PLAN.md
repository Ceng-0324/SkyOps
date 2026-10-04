# SkyOps 开发推进顺序

**阶段 1：核心功能实现（F01-F10）**

---

## 第 1 步：环境准备 ✅

- [x] 添加后端依赖：NumPy, SciPy, Open3D, NetworkX
- [x] 添加前端依赖：Zustand, D3, Leaflet
- [x] 提交到 `feat/add-stage1-dependencies` 分支

---

## F01–F03 当前落地范围（2026-10-05）

本阶段交付 **mock / simulated 数据下的任务 → 场景 → 候选方案闭环**。
功能与本地验证完成；本分支最新收尾仍需推送、PR CI、审查及合并，不能据本地通过宣称远端验收完成。
后续规划内容与下述已实现功能分开记录。

### F01：任务理解与空间编辑

- [x] JSON DSL、受限中文解析、澄清及前置依赖推导。
- [x] `/missions/plan` 接入任务分解，保留场景参考计划兼容契约。
- [x] 任务树、依赖与澄清展示；对象 A 绑定、观察点和起止点编辑。
- [x] 原文、空间点位与场景输入按任务保存到本机，错误与任务隔离有回归。

入口：`backend/app/core/task_decomposition/`、`frontend/src/features/mission/TaskTreeViewer.tsx`、
`SpatialTaskWorkspace.tsx`、`spatialTaskDraft.ts`。
边界：受限文本解析不等于任意自然语言或语音/图像多模态理解；当前新工作区只绑定对象 A。

### F02：点云障碍检测与空间展示

- [x] 点云加载、阈值过滤、聚类与障碍包围盒检测，受控目录及异常输入校验。
- [x] `/point-cloud/detect-obstacles` 真实 API 接入独立环境状态。
- [x] Leaflet XY/XZ 视图、缩放平移、障碍选择与详情、可调宽面板。
- [x] 配套 mock 校园点云与影像模拟配准，失败时可退回坐标图。
- [x] F02 模块行覆盖率超过 80%：当前 94%（270 条语句，16 条未覆盖）。

入口：`backend/app/core/point_cloud/`、`backend/app/core/models/point_cloud.py`、
`frontend/src/features/environment/`。覆盖率统计包含 F02 路由、schema、模型、加载器和检测器，
不是整个后端的覆盖率。运行命令见下文。
边界：检测类型当前可为 unknown；包围盒与启发式置信度不等于物体语义识别或安全结论。
真实地理配准与通用影像/点云关联不在本阶段交付内。

### F03：局部候选规划与比较

- [x] 全面覆盖、重点观察、补充采集三种策略，任务级优先和完成声明。
- [x] 三维直连检查与 A*、连续碰撞检查、边界/高度/预算/续航约束。
- [x] `/missions/plan-candidates`，可行候选评分、推荐与等价结果。
- [x] 三方案列表、单条对照叠加、路线箭头、访问点联动、评分拆解与当前草案选择。
- [x] 接入任务页点位与 F02 检测快照；修改输入后使旧结果及迟到响应失效。

入口：`backend/app/core/strategy_composer/`、`backend/app/core/planning/path_optimizer.py`、
`frontend/src/features/mission/SpatialPlanPanel.tsx`、`spatialPlanning.ts`、`workspaceStore.ts`。
边界：三种策略不保证三条不同且可行的路线；只有可行候选有路径和评分。
当前规划闭环使用配套 mock 校园和对象 A，规则取自显式参考场景；不是持续多轮对话或飞行授权。
候选、参数、任务声明和草案选择仅保留在当前工作区内存，刷新后重新计算。

### 本地验收与发布门槛

- [x] 后端全套 438 项测试及 Ruff lint。
- [x] 前端 95 项测试、TypeScript 与生产构建。
- [x] 首页、F01 编辑、F02 场景、F03 方案四条浏览器回归；桌面、窄桌面及手机。
- [x] 独立场景参考工具仍可运行任务、风险图表、事件和复盘；不冒充当前候选的执行结果。
- [ ] 最新收尾提交推送后的 PR CI、审查与合并（由推送后实际状态确认）。

复现命令：

```bash
cd backend
uv run pytest
uv run ruff check .
# 临时验证工具，不添加项目核心依赖；按目录采集，避免模块探测提前导入 Pydantic。
uv run --with coverage python -m coverage run --source=app -m pytest
uv run --with coverage python -m coverage report --include='app/core/point_cloud/*,app/core/models/point_cloud.py,app/api/routes/point_cloud.py,app/api/schemas/point_cloud.py' --fail-under=80

cd ../frontend
npm ci
npm test
npm run build
# 真实后端 + Vite 代理已运行；Chrome 使用 --remote-debugging-port=9223。
SKYOPS_UI_BASE_URL=http://127.0.0.1:5173 npm run test:browser
# 自动启动临时后端的客户端/store 集成测试，CI 同样执行。
../backend/.venv/bin/python scripts/smoke-environment.py --workspace
```

当前历史工程债：`ruff format --check .` 有 30 个既有文件不合规；本次前端收尾不混入全仓后端格式重排。
这是独立格式债，不将其标记为通过。UI 截图仅保留根目录 `skyops-workspace-preview.png`，属于本地效果图，不提交。

---

## 第 5 步：F04-F06 风险预演与任务恢复（2 周，优先级 P1）

### 实现内容

#### F04: 风险预演（Day 1-3）
```python
backend/app/core/risk/simulator.py
- simulate_scenario(plan, event) → SimulationResult
- what-if 推演
```

#### F05: 任务进展评价（Day 4-6）
```python
backend/app/core/evaluation/completion_evaluator.py
- evaluate_completion(plan, evidence) → CompletionStatus
```

#### F06: 任务恢复（Day 7-10）
```python
backend/app/core/orchestration/incident_replanner.py
- 改造：保留已完成工作
- 增量重规划
```

**验收标准**：
- [ ] 能模拟不同事件影响
- [ ] 能评价任务完成度
- [ ] 能恢复中断任务

---

## 第 6 步：F07-F08 证据与评测（1 周，优先级 P1）

### 实现内容

#### F07: 决策证据（Day 1-3）
```python
backend/app/core/evidence/tracer.py
- record_decision() → DecisionRecord
- generate_timeline() → Timeline
```

#### F08: 独立评测（Day 4-5）
```python
backend/app/core/evaluation/baseline.py
- 新增评分器
- 基线对比
```

**验收标准**：
- [ ] 所有决策可追溯
- [ ] 时间线可生成
- [ ] 评测系统可运行

---

## 第 7 步：F09-F10 语音协同（2 周，优先级 P2）

### 实现内容

#### F09: 多角色协同（Day 1-5）
```python
backend/app/core/collaboration/rbac.py
- 权限管理
- 状态机
- 冲突检测
```

#### F10: 语音引导（Day 6-10）
```tsx
frontend/src/components/voice/VoiceInput.tsx
- 按键说话
- 语音 → 文字
- 空间指代解析
```

**验收标准**：
- [ ] RBAC 权限生效
- [ ] 语音输入可用
- [ ] 空间指代正确绑定

---

## 并行任务：前端重构

### 已完成：主工作区

- [x] 深色总览工作台、模板入口、创建抽屉与本机任务草稿。
- [x] 任务 / 场景 / 方案工作区，地图与可拖宽面板，手机布局与键盘交互。
- [x] F01–F03 请求状态使用独立 Zustand workspace/environment stores，UI 瞬时状态保留 React hooks。
- [x] 清理未采用的浅色工作区草稿、重复地图/比较组件及失效浏览器脚本。

### 保留边界与后续工作

`ScenarioReferenceConsole.tsx` 仅承载原有场景模板参考能力，从任务页显式打开。
风险、事件、复盘仍是参考演示；F04–F08 接入当前候选路径后再迁入新工作区，
因此不能把本阶段完成等同于全站五视图全部重构。风险图表按需加载，不再使参考入口打包超过 500 kB。

- [ ] Risk：当前候选的风险预演与可视化。
- [ ] Incident：与当前候选关联的事件响应和重规划。
- [ ] Review：真实任务进展、证据与时间线。

---

## 里程碑检查点

### M1.1: F02 完成（Week 2 结束）
- [x] 障碍检测 API 可用
- [x] 2D 地图可视化完成

### M1.2: F01-F03 完成（Week 5 结束）
- [x] 任务分解可用
- [x] 多方案生成可用
- [x] 路径规划可用

### M1.3: F04-F08 完成（Week 9 结束）
- [ ] 风险预演可用
- [ ] 任务恢复可用
- [ ] 证据追溯可用

### M1: 阶段 1 完成（Week 11 结束）
- [ ] F01-F10 全部完成
- [ ] 核心功能有测试
- [ ] API 文档完整
- [ ] 基线评测系统可运行

---

## 总时间估算

| 任务 | 时间 | 状态 |
|------|------|------|
| 环境准备 | 1-2 天 | ✅ 已完成 |
| F02 | 2 周 | ✅ 阶段范围已落地，待分支发布验收 |
| F01 | 1 周 | ✅ 阶段范围已落地，待分支发布验收 |
| F03 | 2 周 | ✅ 阶段范围已落地，待分支发布验收 |
| F04-F06 | 2 周 | 📋 待开始 |
| F07-F08 | 1 周 | 📋 待开始 |
| F09-F10 | 2 周 | 📋 待开始 |
| **总计** | **10-11 周** | |

---

**下一步行动**：开始 F02 后端实现（创建点云数据模型）

**文档版本**：1.0  
**最后更新**：2026年  
**维护者**：SkyOps 团队
