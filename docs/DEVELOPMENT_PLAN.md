# SkyOps 开发推进顺序

**阶段 1：核心功能实现（F01-F10）**

---

## 第 1 步：环境准备 ✅

- [x] 添加后端依赖：NumPy, SciPy, Open3D, NetworkX
- [x] 添加前端依赖：Zustand, D3, Leaflet
- [x] 提交到 `feat/add-stage1-dependencies` 分支

---

## 第 2 步：F02 环境属性识别（2 周，优先级 P0）

**原因**：F02 是基础，F03 路径规划依赖障碍检测。

### Week 1: 后端实现

#### 1. 创建数据模型（Day 1）
```python
backend/app/core/models/point_cloud.py
- PointCloud: 点云数据模型
- Obstacle: 障碍物模型
- ObstacleDetectionResult: 检测结果
```

#### 2. 实现点云加载器（Day 1-2）
```python
backend/app/core/point_cloud/loader.py
- load_point_cloud_from_file() → PointCloud
- 支持 mock .pcd 文件
```

#### 3. 实现障碍检测（Day 2-3）
```python
backend/app/core/point_cloud/detector.py
- detect_obstacles(point_cloud, threshold) → list[Obstacle]
- 基于高度阈值的简单算法
```

#### 4. API 端点（Day 3-4）
```python
backend/app/api/routes/point_cloud.py
POST /point-cloud/detect-obstacles
```

#### 5. 单元测试（Day 4-5）
```python
backend/tests/unit/test_point_cloud_detector.py
- test_detect_obstacles_from_mock_data()
- test_threshold_filtering()
```

**验收标准**：
- [ ] API 端点可调用
- [ ] 测试覆盖率 >80%
- [ ] 通过 CI

---

### Week 2: 前端实现

#### 1. 创建 2D 地图组件（Day 1-2）
```tsx
frontend/src/components/map/MapContainer.tsx
- 基于 Leaflet 的 2D 地图
- 支持缩放、平移
```

#### 2. 障碍物标记组件（Day 2-3）
```tsx
frontend/src/components/map/ObstacleMarkers.tsx
- 在地图上标记障碍物位置
- 悬停显示详情
```

#### 3. 集成到 Plan 视图（Day 3-4）
```tsx
frontend/src/features/mission/MissionPlanPanel.tsx
- 嵌入 MapContainer
- 调用障碍检测 API
- 显示检测结果
```

#### 4. Zustand 状态管理（Day 4-5）
```tsx
frontend/src/stores/environmentStore.ts
- 管理障碍物状态
- 管理点云元数据
```

**验收标准**：
- [ ] 地图可正常显示
- [ ] 障碍物标记可见
- [ ] 与后端 API 集成成功

---

## 第 3 步：F01 多模态任务理解（1 周，优先级 P0）

**原因**：任务分解是所有功能的入口。

### 实现内容

#### 1. 任务分解 DSL（Day 1-2）
```python
backend/app/core/task_decomposition/parser.py
- parse_task_input(raw_input: str) → TaskTree
- 支持简单的结构化输入解析
```

#### 2. 依赖关系推导（Day 2-3）
```python
backend/app/core/task_decomposition/dependency.py
- build_dependency_graph(task_tree: TaskTree) → nx.DiGraph
```

#### 3. 改造 mission_planner（Day 3-4）
```python
backend/app/core/orchestration/mission_planner.py
- 集成任务分解逻辑
- 保持向后兼容
```

#### 4. 前端任务树可视化（Day 4-5）
```tsx
frontend/src/components/task/TaskTreeViewer.tsx
- 使用 Recharts 或 D3.js 展示任务树
```

**验收标准**：
- [ ] 能解析自然语言任务
- [ ] 能生成任务树和依赖图
- [ ] 前端能可视化任务树

---

## 第 4 步：F03 对话式任务与路径规划（2 周，优先级 P0）

**原因**：核心规划能力。

### Week 1: 策略组合框架

#### 1. 策略定义（Day 1-2）
```python
backend/app/core/strategy_composer/strategies.py
- CoverageStrategy
- FocusedObservationStrategy
- SupplementaryCaptureStrategy
```

#### 2. 方案生成器（Day 2-4）
```python
backend/app/core/strategy_composer/generator.py
- generate_candidate_plans() → list[MissionPlan]
- 结合 F02 障碍数据
```

#### 3. 路径优化（Day 4-5）
```python
backend/app/core/planning/path_optimizer.py
- optimize_path(waypoints, obstacles) → Path
- 使用 RRT* 或 A*
```

### Week 2: 方案比较与前端

#### 1. 方案评分（Day 1-2）
```python
backend/app/core/strategy_composer/scorer.py
- score_plan(plan) → PlanScore
- 多目标：完成度、时间、风险
```

#### 2. 改造 plan_mission（Day 2-3）
```python
backend/app/core/orchestration/mission_planner.py
- 返回 list[MissionPlanningResult]
- 支持多方案
```

#### 3. 前端方案比较界面（Day 3-5）
```tsx
frontend/src/features/mission/PlanComparisonPanel.tsx
- 并排展示多个方案
- 差异高亮
- 用户选择
```

**验收标准**：
- [ ] 能生成 ≥3 个候选方案
- [ ] 每个方案有评分
- [ ] 前端能比较方案

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

### 持续进行

#### 1. 五视图重构
- Task 视图：集成任务树
- Plan 视图：集成地图 + 方案比较
- Risk 视图：集成热力图
- Incident 视图：集成重规划可视化
- Review 视图：集成时间线

#### 2. 状态管理迁移
- 从组件 state → Zustand stores
- 统一数据流

---

## 里程碑检查点

### M1.1: F02 完成（Week 2 结束）
- [ ] 障碍检测 API 可用
- [ ] 2D 地图可视化完成

### M1.2: F01-F03 完成（Week 5 结束）
- [ ] 任务分解可用
- [ ] 多方案生成可用
- [ ] 路径规划可用

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
| F02 | 2 周 | 📋 下一步 |
| F01 | 1 周 | 📋 待开始 |
| F03 | 2 周 | 📋 待开始 |
| F04-F06 | 2 周 | 📋 待开始 |
| F07-F08 | 1 周 | 📋 待开始 |
| F09-F10 | 2 周 | 📋 待开始 |
| **总计** | **10-11 周** | |

---

**下一步行动**：开始 F02 后端实现（创建点云数据模型）

**文档版本**：1.0  
**最后更新**：2026年  
**维护者**：SkyOps 团队
