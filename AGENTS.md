# SkyOps 开发指南

**Development Guidelines for SkyOps**

本文件定义 SkyOps 的开发协作规范、技术栈约束和架构决策边界，面向 AI 编程代理和团队成员。

---

## 1. 产品定位

SkyOps 是**基于空间智能的低空作业自主协同系统**。

### 核心能力

1. **空间智能（Spatial Intelligence）**
   - 3D 场景理解、世界模型预测、主动探索补采

2. **自主协同（Autonomous Coordination）**
   - 多机协同、自适应规划、任务恢复

3. **空间语音协同（Spatial Voice Collaboration）**
   - 语音+地图+角色权限+证据溯源

### 应用场景

巡检、应急响应、物流配送、安防巡逻、测绘建模等低空作业场景。

### 产品边界

- ✅ 任务级自主决策与协同执行
- ✅ 风险预演与可解释规划
- ✅ 证据化复盘与持续优化
- ❌ 不做底层飞控
- ❌ 不做 CV 缺陷识别
- ❌ 不做监管审批替代

---

## 2. 开发协作规范

### 2.1 决策权限

| 决策类型 | 负责人 | 说明 |
|---------|--------|------|
| 产品定位、功能方向 | 组长 | AI 代理不得自主决定 |
| 技术栈变更、核心依赖新增 | 组长 | 需明确批准 |
| 公共数据模型、API 合约 | 组长 | 破坏性变更需批准 |
| 安全规则体系、评测指标 | 组长 | 需明确批准 |
| 单功能局部实现 | 组员/AI 代理 | 在既定接口下实现 |
| 测试用例、Mock 数据补充 | 组员/AI 代理 | 不改变架构 |
| Bug 修复、文档更新 | 组员/AI 代理 | 非架构性变更 |

### 2.2 开发流程

1. **接收任务** → 确认边界、输入输出、验收标准
2. **说明计划** → 说明将执行的内容、影响范围、验证方式
3. **实现功能** → 遵守技术栈约束、代码规范
4. **本地验证** → 运行测试、lint、构建
5. **提交代码** → 每完成一个模块改动创建本地提交
6. **创建 PR** → 推送到功能分支，创建 PR 等待审查

### 2.3 沟通原则

- **透明化利弊**：说明收益与潜在风险
- **只给最优建议**：基于既定目标给出最适合的方案
- **不自行决定**：不确定时暂停，等待组长明确指令
- **小步推进**：每个 PR 只解决一个明确问题

---

## 3. 技术栈约束

### 3.1 已确认技术栈

#### 后端核心

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
ruff>=0.14.0
```

#### 前端核心

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

### 3.2 暂不引入

以下技术当前阶段不引入，除非组长明确批准：

- ❌ **PostgreSQL, Redis, Celery** — 过早引入分布式复杂度
- ❌ **Next.js, SSR** — 前端保持简单
- ❌ **LangChain, LangGraph** — 避免黑盒编排
- ❌ **ROS/ROS2** — 不需要真实无人机控制
- ❌ **Kubernetes** — 初期单机部署
- ❌ **其他大型 UI 框架**（除 Tailwind）

### 3.3 评估中技术

以下技术正在评估，需组长批准后才能引入：

```toml
# 语音识别/合成
# openai-whisper
# azure-cognitiveservices-speech

# 3D 高斯场景重建（阶段 3）
# gsplat
# nerfstudio

# 强化学习（阶段 2）
# stable-baselines3
```

---

## 4. 代码规范

### 4.1 Python 规范

- **类型标注**：所有函数参数和返回值必须有类型标注
- **Pydantic 模型**：公共数据结构使用 Pydantic v2
- **文档字符串**：公共函数/类必须有 docstring
- **Lint**：通过 `ruff check` 和 `ruff format`
- **测试**：核心逻辑必须有单元测试

```python
# ✅ 好的示例
from pydantic import BaseModel

class Point3D(BaseModel):
    """三维空间点。"""
    x: float
    y: float
    z: float

def calculate_distance(p1: Point3D, p2: Point3D) -> float:
    """计算两点间欧氏距离。
    
    Args:
        p1: 第一个点
        p2: 第二个点
        
    Returns:
        欧氏距离
    """
    return ((p1.x - p2.x)**2 + (p1.y - p2.y)**2 + (p1.z - p2.z)**2)**0.5
```

### 4.2 TypeScript 规范

- **严格模式**：启用 TypeScript strict mode
- **类型定义**：避免 `any`，使用明确类型
- **React 组件**：使用函数组件 + hooks
- **样式**：使用 Tailwind CSS，避免内联样式
- **状态管理**：优先使用 Zustand，避免 props drilling

```tsx
// ✅ 好的示例
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
```

### 4.3 提交规范

```bash
# 提交消息格式
feat(module): add feature description
fix(module): fix bug description
docs(module): update documentation
test(module): add test cases
refactor(module): refactor implementation

# 示例
feat(point_cloud): add obstacle detection from point cloud
fix(planning): correct path cost calculation
docs(api): update mission plan schema
test(graph): add spatial reasoning test cases
```

---

## 5. 项目结构

### 5.1 后端目录

```
backend/
├── pyproject.toml              # 依赖管理
├── app/
│   ├── main.py                 # FastAPI 入口
│   ├── api/                    # API 路由
│   │   ├── routes/
│   │   └── schemas/
│   ├── core/                   # 核心功能模块
│   │   ├── models/             # Pydantic 数据模型
│   │   ├── point_cloud/        # 点云处理
│   │   ├── graph/              # 图空间推理
│   │   ├── planning/           # 路径规划
│   │   ├── world_model/        # 世界模型（阶段 3）
│   │   ├── rules/              # 安全规则引擎
│   │   ├── evaluation/         # 评测系统
│   │   └── orchestration/      # 任务编排
│   ├── agents/                 # Agent 实现
│   │   ├── task_understanding/
│   │   ├── environment_sensing/
│   │   ├── mission_planning/
│   │   ├── risk_simulation/
│   │   └── incident_response/
│   ├── data/                   # 数据文件
│   │   ├── mock/               # Mock 数据
│   │   ├── point_clouds/       # 点云数据
│   │   ├── scenes/             # 场景数据
│   │   └── scenarios/          # 评测场景
│   └── integrations/           # 外部集成
│       ├── llm/
│       ├── speech/             # 语音（阶段 2）
│       └── slam/               # SLAM（阶段 2）
└── tests/
    ├── unit/
    ├── integration/
    └── fixtures/
```

### 5.2 前端目录

```
frontend/
├── package.json
├── vite.config.ts
├── tailwind.config.js
└── src/
    ├── main.tsx                # 入口
    ├── api/                    # API 客户端
    ├── components/             # 通用组件
    │   ├── 3d/                 # Three.js 组件
    │   └── spatial/            # 空间可视化
    ├── features/               # 功能模块
    │   ├── mission/            # 任务规划
    │   ├── multi_agent/        # 多机协同
    │   ├── risk/               # 风险展示
    │   ├── incident/           # 异常处置
    │   ├── review/             # 任务复盘
    │   └── world_model/        # 世界模型（阶段 3）
    ├── stores/                 # Zustand 状态
    └── styles/                 # 全局样式
```

---

## 6. 开发路线

详细开发路线见 [PRODUCT_ROADMAP.md](./PRODUCT_ROADMAP.md)。

### 阶段概览

| 阶段 | 核心目标 |
|------|---------|
| **阶段 0** | 需求与基线验证 |
| **阶段 1** | 核心功能实现（F01-F10） |
| **阶段 2** | 扩展功能实现（E01-E09） |
| **阶段 3** | 世界模型集成 |
| **阶段 4** | 商业化准备 |

### 开发原则

1. **Contract first** — 先定义接口，再实现
2. **Mock first** — 使用 mock 数据，不依赖真实外部系统
3. **Rules before LLM** — 硬约束用显式规则，LLM 只做辅助
4. **Tests with features** — 功能与测试同步开发
5. **Small PRs** — 一个 PR 只解决一个问题

---

## 7. PR 完成标准

每个 PR 合并前必须满足：

### 7.1 代码质量

- ✅ 通过 `ruff check` 和 `ruff format`（Python）
- ✅ 通过 `tsc -b`（TypeScript）
- ✅ 通过 `pytest`（如有测试）
- ✅ 无 ESLint 错误（前端）

### 7.2 功能完整性

- ✅ 实现了任务描述中的所有功能点
- ✅ 核心逻辑有单元测试或可验证样例
- ✅ Mock 数据标注了来源（`mock`, `simulated`）
- ✅ 关键决策输出包含解释字段（`reason`, `evidence`）

### 7.3 文档完整性

- ✅ 公共函数/类有 docstring
- ✅ 复杂逻辑有注释说明
- ✅ API 变更更新了 schema 文档

### 7.4 PR 描述

PR 描述必须包含：

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

---

## 8. Git 工作流

### 8.1 分支管理

```bash
# 从 main 创建功能分支
git checkout main
git pull
git checkout -b feat/point-cloud-processing

# 开发...每完成一个模块改动就提交
git add app/core/point_cloud/
git commit -m "feat(point_cloud): add obstacle detection"

# 推送到远程
git push -u origin feat/point-cloud-processing

# 创建 PR
gh pr create --title "feat: add point cloud processing module"
```

### 8.2 提交原则

- ✅ 每完成一个模块改动创建本地提交
- ✅ 提交消息使用规范格式（见 4.3）
- ✅ 一个提交只包含相关变更
- ❌ 不在 main 分支直接提交
- ❌ 不使用 `git add .`（明确指定文件）
- ❌ 不 force push（除非组长明确要求）

---

## 9. 安全边界

### 9.1 LLM 安全边界

详见 [docs/llm-safety-boundary.md](./docs/llm-safety-boundary.md)。

**核心规则**：
```
LLM 可以建议，但不能批准飞行。
```

- ✅ LLM 可以：解析任务、生成解释草稿、建议缺失约束
- ❌ LLM 不能：批准飞行、覆盖安全规则、降低安全阈值

### 9.2 数据标注

所有非真实数据必须标注：

```python
# ✅ 好的示例
class EnvironmentData(BaseModel):
    wind_speed: float
    temperature: float
    source: Literal["mock", "simulated", "real"]  # 必须标注
    timestamp: datetime
```

### 9.3 不确定性处理

信息不足或风险不确定时：

```python
# ✅ 好的示例
if not has_sufficient_data():
    return DecisionResult(
        decision="require_human_review",
        reason="当前信息不足，建议人工复核",
        confidence=0.0
    )
```

---

## 10. 测试规范

### 10.1 测试覆盖

| 模块类型 | 测试要求 |
|---------|---------|
| 核心算法（点云处理、路径规划） | 必须有单元测试 |
| API 路由 | 必须有集成测试 |
| 安全规则引擎 | 必须有边界测试 |
| UI 组件 | 可选测试 |

### 10.2 测试示例

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

---

## 11. 常见问题

### Q1: 需要新增依赖怎么办？

**A**: 先询问组长是否批准，批准后再添加到 `pyproject.toml` 或 `package.json`。

### Q2: 发现现有架构不合理怎么办？

**A**: 先说明问题和改进方案，等待组长决策，不要自行重构。

### Q3: 测试失败怎么办？

**A**: 先在本地修复，确保通过后再推送。如果无法修复，说明问题请求帮助。

### Q4: PR 被要求修改怎么办？

**A**: 在原分支继续提交，推送后 PR 会自动更新。

### Q5: 不确定某个功能该怎么实现？

**A**: 先说明理解的需求和可能的方案，等待组长明确方向后再实现。

---

## 12. 参考文档

- **[PRODUCT_ROADMAP.md](./PRODUCT_ROADMAP.md)** — 产品定位、开发路线
- **[TECHNICAL_PROPOSAL.md](./TECHNICAL_PROPOSAL.md)** — 功能定义、技术路径
- **[README.md](./README.md)** — 项目介绍
- **[docs/evaluation-metrics.md](./docs/evaluation-metrics.md)** — 评测合约
- **[docs/llm-safety-boundary.md](./docs/llm-safety-boundary.md)** — LLM 安全边界

---

**文档版本**：3.1  
**最后更新**：2026年  
**维护者**：SkyOps 团队
