# SkyOps 开发执行规范

**AI 编程代理和团队成员执行手册**

---

## 文档定位

本文件是 **SkyOps 项目的开发执行规范**，定义：
- 产品边界与技术栈约束
- 架构决策权限
- 代码规范与工程流程
- AI 代理执行原则

**其他文档**：
- 产品定位和开发路线 → [PRODUCT_ROADMAP.md](./PRODUCT_ROADMAP.md)
- 功能定义和技术路径 → [TECHNICAL_PROPOSAL.md](./TECHNICAL_PROPOSAL.md)

---

## 1. 产品边界

### 1.1 SkyOps 是什么

基于空间智能的低空作业自主协同系统：
- **空间智能**：3D 场景理解、世界模型预测、主动探索
- **自主协同**：多机协作、自适应规划、任务恢复
- **空间语音协同**：语音+地图+角色权限+证据溯源

### 1.2 SkyOps 不是什么

- ❌ 底层飞控系统
- ❌ CV 缺陷识别工具
- ❌ 监管审批替代
- ❌ 真实无人机硬件接口（当前阶段）

### 1.3 应用场景

巡检、应急响应、物流配送、安防巡逻、测绘建模等低空作业。

---

## 2. 执行原则

### 2.1 默认自主执行

- ✅ 任务开始后持续执行到完成标准
- ✅ 能从代码/文档/相邻模式确定的低风险选择自行完成
- ✅ 失败后先定位、修复和复测
- ❌ 不在计划完成、代码写完、测试通过后等"继续"
- ❌ 不为每个小步骤请求批准

### 2.2 人类确认边界

**必须确认**：
- 产品语义歧义（优先级冲突、需求不明）
- 破坏性操作（删除数据、force push、生产变更）
- 不可逆操作（发布、部署、公开 API 变更）
- 高代价技术选型（新增核心依赖、架构重构）

**无需确认**：
- 低风险工程决策（函数命名、文件组织、测试补充）
- 明确 issue 的实现细节
- Bug 修复的具体方案
- 代码格式和 lint 修复

### 2.3 证据优先

结论基于证据，不基于记忆或假设：
1. 当前代码和测试
2. 项目文档（PRODUCT_ROADMAP.md、TECHNICAL_PROPOSAL.md、本文件）
3. 依赖文档和源码
4. 历史 commit、PR、issue

记忆和旧讨论是调查线索，不是当前事实替代品。

### 2.4 最终合理形态

需求明确时，直接实现最终合理形态：
- ✅ 按完整垂直链路交付（数据模型→API→前端→测试）
- ✅ 一次性更新所有调用方，不留半成品兼容层
- ❌ 不以"先能跑，以后再整理"替代已知的正确设计
- ❌ 不为了缩小 diff 留下双轨实现或重复抽象

### 2.5 保护现有工作

- ✅ 保留用户和其他执行者的未提交改动
- ✅ 修改前读取当前代码和相邻模式
- ✅ 优先使用项目已有框架、helper、抽象
- ❌ 不通过 reset、checkout 获得表面干净的工作区
- ❌ 不批量覆盖或无关清理

---

## 3. 技术栈约束

### 3.1 已批准技术栈

#### 后端（Python 3.12）

```toml
# Web 框架
fastapi>=0.124.0
pydantic>=2.12.0
uvicorn[standard]>=0.38.0

# 数据处理
numpy>=1.26.0
scipy>=1.13.0
pyyaml>=6.0.0

# 点云与几何
open3d>=0.18.0

# 图与路径规划
networkx>=3.2.0

# 深度学习
torch>=2.5.0
torchvision>=0.20.0
torch-geometric>=2.6.0

# 数据存储
sqlalchemy>=2.0.0
aiosqlite>=0.20.0

# 实时通信
websockets>=12.0

# 开发工具
pytest>=9.0.0
pytest-asyncio>=0.24.0
ruff>=0.14.0
```

#### 前端（React 19 + TypeScript 5）

```json
{
  "react": "^19.2.3",
  "typescript": "^5.9.3",
  "vite": "^7.3.0",
  "tailwindcss": "^4.1.18",
  
  "three": "^0.170.0",
  "@react-three/fiber": "^9.0.0",
  "@react-three/drei": "^10.0.0",
  
  "zustand": "^5.0.0",
  "recharts": "^3.6.0",
  "lucide-react": "^0.562.0"
}
```

### 3.2 禁止引入

当前阶段禁止以下技术，除非组长明确批准：
- ❌ PostgreSQL, Redis, Celery
- ❌ Next.js, SSR
- ❌ LangChain, LangGraph
- ❌ ROS/ROS2
- ❌ Kubernetes
- ❌ 其他 UI 框架（除 Tailwind）

### 3.3 评估中技术

需组长批准后才能引入：
- 🔍 openai-whisper / azure-cognitiveservices-speech
- 🔍 gsplat / nerfstudio（阶段 3）
- 🔍 stable-baselines3（阶段 2）

---

## 4. 架构决策权限

### 4.1 组长负责

- 产品定位、功能方向
- 技术栈变更、核心依赖新增
- 顶层目录结构变更
- 公共数据模型破坏性变更
- API 总体设计
- 安全规则体系、评测指标
- CI/CD 规则

### 4.2 AI 代理/组员可执行

- 在既定接口下实现单功能局部逻辑
- 补充 mock 数据、测试用例
- 实现前端局部组件
- 修复明确 bug
- 更新非架构性文档

### 4.3 需确认场景

- 新增或删除顶层目录
- 修改公共 Pydantic 模型字段
- 修改 API 路由、请求体、响应体
- 新增核心依赖
- 引入数据库、消息队列、缓存
- 修改 CI/CD、分支保护

---

## 5. 代码规范

### 5.1 Python

```python
# ✅ 类型标注
def calculate_distance(p1: Point3D, p2: Point3D) -> float:
    """计算两点间欧氏距离。
    
    Args:
        p1: 第一个点
        p2: 第二个点
        
    Returns:
        欧氏距离
    """
    return ((p1.x - p2.x)**2 + (p1.y - p2.y)**2 + (p1.z - p2.z)**2)**0.5

# ✅ Pydantic 模型
class Point3D(BaseModel):
    """三维空间点。"""
    x: float
    y: float
    z: float
    
# ❌ 避免
def calc(p1, p2):  # 缺类型标注、缺 docstring
    return math.sqrt((p1[0]-p2[0])**2 + ...)  # 用 tuple 而非结构化模型
```

**强制规则**：
- 所有函数参数和返回值必须有类型标注
- 公共函数/类必须有 docstring
- 通过 `ruff check` 和 `ruff format`
- 核心逻辑必须有单元测试

### 5.2 TypeScript

```tsx
// ✅ 类型定义
interface Point3DProps {
  x: number;
  y: number;
  z: number;
  color?: string;
}

export function Point3D({ x, y, z, color = "blue" }: Point3DProps) {
  return (
    <mesh position={[x, y, z]}>
      <sphereGeometry args={[0.1, 16, 16]} />
      <meshStandardMaterial color={color} />
    </mesh>
  );
}

// ❌ 避免
export function Point3D(props: any) {  // 避免 any
  return <div style={{color: props.color}} />;  // 避免内联样式
}
```

**强制规则**：
- TypeScript strict mode
- 避免 `any`，使用明确类型
- 函数组件 + hooks
- Tailwind CSS，避免内联样式
- Zustand 状态管理

---

## 6. 项目结构

### 6.1 后端

```
backend/
├── pyproject.toml
├── app/
│   ├── main.py
│   ├── api/
│   │   ├── routes/
│   │   └── schemas/
│   ├── core/
│   │   ├── models/              # Pydantic 数据模型
│   │   ├── point_cloud/         # 点云处理
│   │   ├── graph/               # 图空间推理
│   │   ├── planning/            # 路径规划
│   │   ├── world_model/         # 世界模型（阶段 3）
│   │   ├── rules/               # 安全规则
│   │   ├── evaluation/          # 评测系统
│   │   └── orchestration/       # 任务编排
│   ├── agents/                  # Agent 实现
│   ├── data/
│   │   ├── mock/
│   │   ├── point_clouds/
│   │   └── scenarios/
│   └── integrations/
│       ├── llm/
│       ├── speech/              # 阶段 2
│       └── slam/                # 阶段 2
└── tests/
    ├── unit/
    ├── integration/
    └── fixtures/
```

### 6.2 前端

```
frontend/
├── package.json
└── src/
    ├── main.tsx
    ├── api/
    ├── components/
    │   ├── 3d/                  # Three.js 组件
    │   └── spatial/             # 空间可视化
    ├── features/
    │   ├── mission/
    │   ├── multi_agent/         # 多机协同
    │   ├── risk/
    │   └── world_model/         # 阶段 3
    ├── stores/                  # Zustand
    └── styles/
```

---

## 7. Git 工作流

### 7.1 分支策略

```bash
# 从 main 创建功能分支
git checkout main
git pull
git checkout -b feat/point-cloud-processing

# 开发...每完成一个模块改动就提交
git add app/core/point_cloud/
git commit -m "feat(point_cloud): add obstacle detection"

# 本地推送由组长执行
```

### 7.2 提交规范

```
<type>(<scope>): <subject>

type: feat, fix, docs, test, refactor, chore
scope: 模块名（point_cloud, planning, api, etc.）
subject: 简短描述（<70 字符）

示例：
feat(point_cloud): add obstacle detection from point cloud
fix(planning): correct path cost calculation
docs(api): update mission plan schema
test(graph): add spatial reasoning test cases
```

### 7.3 安全原则

- ✅ 每完成一个模块改动创建本地提交
- ✅ 使用 `git add <specific-files>`，不用 `git add .`
- ✅ 保留用户未提交改动
- ❌ 不在 main 分支直接提交
- ❌ 不 force push（除非组长明确要求）
- ❌ 不 reset/checkout 清理工作区

---

## 8. 测试规范

### 8.1 测试覆盖要求

| 模块类型 | 测试要求 |
|---------|---------|
| 核心算法（点云、路径规划） | 必须有单元测试 |
| API 路由 | 必须有集成测试 |
| 安全规则引擎 | 必须有边界测试 |
| UI 组件 | 可选 |

### 8.2 测试示例

```python
# tests/unit/test_obstacle_detection.py
import pytest
from app.core.point_cloud import detect_obstacles

def test_detect_obstacles_from_point_cloud():
    """测试从点云中检测障碍物。"""
    # Arrange
    point_cloud = load_test_point_cloud("tests/fixtures/scene1.pcd")
    
    # Act
    obstacles = detect_obstacles(point_cloud, threshold=0.5)
    
    # Assert
    assert len(obstacles) > 0
    assert all(obs.confidence > 0.5 for obs in obstacles)
```

### 8.3 完成标准

- ✅ 通过 `ruff check` 和 `ruff format`
- ✅ 通过 `pytest`（如有测试）
- ✅ 通过 `tsc -b`（前端）
- ✅ 核心逻辑有单元测试
- ✅ Mock 数据标注来源

---

## 9. PR 标准

### 9.1 PR 描述模板

```markdown
## 改动内容
- 实现了 XXX 功能
- 修复了 XXX bug

## 自测结果
- ✅ 本地运行 pytest 通过
- ✅ 前端页面正常显示

## 风险点
- 修改了 XXX 公共模型，可能影响 YYY

## 需要重点审查
- XXX 函数的边界情况处理
```

### 9.2 合并前检查清单

- [ ] 代码通过 lint 和格式化
- [ ] 测试全部通过
- [ ] 核心逻辑有测试覆盖
- [ ] 公共 API 有文档
- [ ] Mock 数据标注来源
- [ ] PR 描述完整

---

## 10. 安全边界

### 10.1 LLM 安全

详见 [docs/llm-safety-boundary.md](./docs/llm-safety-boundary.md)

**核心规则**：LLM 可以建议，但不能批准飞行。

- ✅ LLM 可以：解析任务、生成解释草稿
- ❌ LLM 不能：批准飞行、覆盖安全规则

### 10.2 数据标注

```python
# ✅ 必须标注来源
class EnvironmentData(BaseModel):
    wind_speed: float
    source: Literal["mock", "simulated", "real"]
    timestamp: datetime
```

### 10.3 不确定性处理

```python
# ✅ 信息不足时明确标注
if not has_sufficient_data():
    return DecisionResult(
        decision="require_human_review",
        reason="当前信息不足，建议人工复核",
        confidence=0.0
    )
```

---

## 11. 开发路线

详见 [PRODUCT_ROADMAP.md](./PRODUCT_ROADMAP.md)

**当前阶段**：阶段 1 - 核心功能实现（F01-F10）

**开发顺序**：
1. F02: 环境属性识别（点云处理基础）
2. F01: 多模态任务理解（任务入口）
3. F03: 对话式规划（核心能力）

**原则**：
- Contract first：先定义接口
- Mock first：不依赖真实外部系统
- Rules before LLM：硬约束用显式规则
- Tests with features：功能与测试同步

---

## 12. 参考文档

- [PRODUCT_ROADMAP.md](./PRODUCT_ROADMAP.md) — 产品定位、开发路线
- [TECHNICAL_PROPOSAL.md](./TECHNICAL_PROPOSAL.md) — 功能定义、技术路径
- [README.md](./README.md) — 项目介绍
- [docs/evaluation-metrics.md](./docs/evaluation-metrics.md) — 评测合约
- [docs/llm-safety-boundary.md](./docs/llm-safety-boundary.md) — LLM 安全边界

---

**文档版本**：4.0  
**最后更新**：2026年  
**维护者**：SkyOps 团队
