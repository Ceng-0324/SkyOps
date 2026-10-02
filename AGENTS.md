# SkyOps AI 代理开发合约

**面向 AI 编程代理的执行规范 | AI Coding Agent Execution Contract**

本文件定义 AI 代理在 SkyOps 项目中的工作方式、行为边界和完成标准。

---

## 快速命令 | Quick Commands

```bash
# 安装依赖
cd backend && uv sync          # 后端
cd frontend && npm ci          # 前端

# 运行测试
cd backend && uv run pytest    # 后端测试
cd backend && uv run ruff check .  # 后端 lint

# 格式化代码
cd backend && uv run ruff format .

# 启动开发环境
cd backend && uv run uvicorn app.main:app --reload  # 后端
cd frontend && npm run dev     # 前端

# 构建
cd frontend && npm run build   # 前端构建
```

---

## 项目定位 | Project Identity

### SkyOps 是什么

基于空间智能的低空作业自主协同系统：
- **空间智能**：3D 场景理解、世界模型预测、主动探索
- **自主协同**：多机协作、自适应规划、任务恢复
- **空间语音协同**：语音+地图+角色权限+证据溯源

**应用场景**：巡检、应急响应、物流配送、安防巡逻、测绘建模

### SkyOps 不是什么

- ❌ 底层飞控系统
- ❌ CV 缺陷识别工具
- ❌ 监管审批替代
- ❌ 真实无人机硬件接口（当前阶段使用 mock 数据）

---

## 项目结构 | Project Structure

### 后端（Backend）

```
backend/
├── pyproject.toml          # 依赖管理
├── app/
│   ├── main.py             # FastAPI 入口
│   ├── api/                # API 路由和 schemas
│   ├── core/               # 核心功能模块
│   │   ├── models/         # Pydantic 数据模型
│   │   ├── evaluation/     # 评测系统
│   │   ├── orchestration/  # 任务编排
│   │   └── rules/          # 安全规则引擎
│   ├── data/               # Mock 数据和评测场景
│   └── integrations/       # 外部集成（LLM 等）
└── tests/                  # 测试
```

### 前端（Frontend）

```
frontend/
├── package.json
├── src/
│   ├── main.tsx            # 入口
│   ├── api/                # API 客户端
│   ├── features/           # 功能模块
│   │   ├── mission/        # 任务规划
│   │   └── evaluation/     # 评测展示
│   ├── public/             # 静态资源
│   └── styles/             # 样式
└── vite.config.ts
```

---

## 技术栈 | Tech Stack

### 已确认依赖（Approved）

从 `backend/pyproject.toml` 和 `frontend/package.json` 读取：

**后端**：
- Python 3.12
- FastAPI, Pydantic v2, uvicorn
- PyYAML（配置）
- pytest, Ruff（测试和 lint）

**前端**：
- React 19, TypeScript 5
- Vite 7（需要 Node.js ≥22）
- Tailwind CSS 4
- lucide-react, Recharts

### 规划中依赖（Planned, Not Yet Approved）

以下依赖在 [TECHNICAL_PROPOSAL.md](./TECHNICAL_PROPOSAL.md) 规划中，需组长批准后才能添加：

- NumPy, SciPy, Open3D（点云处理）
- PyTorch, PyTorch Geometric（深度学习和图推理）
- NetworkX（图算法）
- Three.js, React Three Fiber（3D 可视化）
- Zustand（状态管理）
- SQLAlchemy, aiosqlite（数据存储）

### 禁止引入（Forbidden）

- ❌ PostgreSQL, Redis, Celery（过早分布式复杂度）
- ❌ Next.js, SSR
- ❌ LangChain, LangGraph
- ❌ ROS/ROS2
- ❌ Kubernetes

---

## 开发工作流 | Development Workflow

### 分支策略

- `main` 是主分支，受保护
- 功能开发在 `feat/` 分支，Bug 修复在 `fix/` 分支
- 禁止直接推送到 `main`，必须通过 PR

### 提交规范

```
<type>(<scope>): <subject>

type:
  feat     - 新功能
  fix      - Bug 修复
  docs     - 文档更新
  test     - 测试补充
  refactor - 代码重构
  chore    - 配置/工具变更

scope: 模块名（api, core, frontend, etc.）
subject: 简短描述（<70 字符，中文或英文）

示例：
feat(api): add mission planning endpoint
fix(core): correct path cost calculation
docs: update AGENTS.md with quick commands
```

### PR 流程

1. 从 `main` 创建功能分支
2. 本地开发并提交（每完成一个模块改动就提交）
3. 推送分支（由组长执行 `git push`）
4. 创建 PR，填写模板
5. 等待 CI 通过 + 代码审查
6. 获得 approve 后由组长合并

---

## 代码规范 | Code Standards

### Python

```python
# ✅ 正确示例
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

# ❌ 避免
def calc(p1, p2):  # 缺类型标注、缺 docstring
    return math.sqrt((p1[0]-p2[0])**2 + ...)  # 用 tuple 而非结构化模型
```

**强制规则**：
- 类型标注：所有函数参数和返回值
- Docstring：公共函数/类必须有
- 通过：`ruff check .` 和 `ruff format .`
- 测试：核心逻辑必须有单元测试

### TypeScript

```tsx
// ✅ 正确示例
interface MissionProps {
  id: string;
  status: "pending" | "running" | "completed";
  onStart?: () => void;
}

export function MissionCard({ id, status, onStart }: MissionProps) {
  return (
    <div className="p-4 border rounded">
      <span>Mission {id}</span>
      <span className="ml-2 text-gray-500">{status}</span>
    </div>
  );
}

// ❌ 避免
export function MissionCard(props: any) {  // 避免 any
  return <div style={{padding: "16px"}} />;  // 避免内联样式，用 Tailwind
}
```

**强制规则**：
- TypeScript strict mode
- 避免 `any`
- 函数组件 + hooks
- Tailwind CSS（不用内联样式）

---

## 测试要求 | Testing Requirements

### 测试位置

- 后端：`backend/tests/` 目录
- 测试文件命名：`test_*.py`

### 测试覆盖要求

| 模块类型 | 测试要求 |
|---------|---------|
| 核心算法（规划、推理） | 必须有单元测试 |
| API 路由 | 必须有集成测试 |
| 安全规则引擎 | 必须有边界测试 |
| UI 组件 | 可选 |

### 运行测试

```bash
cd backend
uv run pytest              # 运行所有测试
uv run pytest tests/unit/  # 只运行单元测试
uv run pytest -v           # 详细输出
```

---

## AI 代理行为边界 | Agent Autonomy Levels

### 🟢 绿灯 - 自主执行（Proceed Autonomously）

以下场景无需询问，直接完成：

- **Bug 修复**：有明确复现步骤的 Bug
- **测试补充**：为已有功能添加测试
- **文档更新**：README、注释、docstring
- **Lint/格式化**：`ruff format`、`ruff check --fix`
- **Mock 数据补充**：添加评测场景数据

**完成后**：提交代码，说明修复了什么、如何验证。

---

### 🟡 黄灯 - 说明计划后执行（State Plan, Then Proceed）

以下场景先简要说明计划（1-2 句），然后执行：

- **新功能实现**：实现 F01-F10 核心功能或 E01-E09 扩展功能
- **代码重构**：改进现有代码结构
- **依赖版本更新**：更新已批准依赖的小版本
- **API 路由变更**：新增或修改 API（非破坏性）

**说明格式**：
```
计划：为 F02 环境属性识别添加点云处理模块
- 在 app/core/ 新增 point_cloud/ 目录
- 实现 load_point_cloud() 和 detect_obstacles()
- 添加单元测试
即将开始实现...
```

---

### 🔴 红灯 - 停止并询问（Stop and Ask）

以下场景必须停止并等待组长明确批准：

- **破坏性 API 变更**：修改已有 API 的请求/响应格式
- **新增核心依赖**：添加 `pyproject.toml` 或 `package.json` 中未列出的依赖
- **架构变更**：顶层目录结构变更、模块拆分/合并
- **安全规则修改**：修改硬约束、安全阈值
- **数据库 schema 变更**
- **生产部署**
- **删除核心功能或模块**

**停止格式**：
```
⚠️ 需要人工决策

当前任务需要 XXX（例：新增 PyTorch 依赖），这属于红灯场景。

建议方案：YYY
影响范围：ZZZ

请确认是否继续。
```

---

## 证据优先原则 | Evidence-First Development

### 修改代码前（Before Changing Code）

1. **读取当前实现**
   ```bash
   # 读取相关文件
   cat backend/app/core/models/mission.py
   ```

2. **运行现有测试**
   ```bash
   # 了解当前行为
   cd backend && uv run pytest tests/test_mission.py -v
   ```

3. **说明修改依据**
   ```
   当前 Mission.status 只支持 ["pending", "running"]
   需要新增 "completed" 状态
   依据：TECHNICAL_PROPOSAL.md F05 任务进展评价
   ```

4. **定位修改位置**
   ```
   需要修改：
   - backend/app/core/models/mission.py (添加状态)
   - backend/tests/test_mission.py (测试新状态)
   ```

### 修改代码后（After Changing Code）

1. **运行受影响的测试**
   ```bash
   uv run pytest tests/test_mission.py
   ```

2. **运行 lint**
   ```bash
   uv run ruff check .
   ```

3. **验证修改**
   ```
   ✅ 验证结果：
   - 测试通过：tests/test_mission.py::test_mission_completed
   - Lint 通过：无错误
   - 手动验证：POST /api/missions/123/complete 返回 200
   ```

4. **说明已验证内容**
   ```
   已验证：
   - Mission.status 可以设置为 "completed"
   - 状态转换符合业务逻辑
   - API 响应格式正确
   ```

---

## 任务完成定义 | Task Completion Definition

任务在满足**所有**以下条件时才算完成：

- [ ] 代码已编写并符合代码规范
- [ ] 测试通过：`uv run pytest`（后端）
- [ ] Lint 通过：`uv run ruff check .`（后端）
- [ ] 格式化：`uv run ruff format .`（后端）
- [ ] 构建成功：`npm run build`（前端，如有前端改动）
- [ ] 代码已提交（每完成一个模块改动创建本地提交）
- [ ] 如是破坏性变更：已获得组长批准

**不要**在完成以下步骤后停下来等待"继续"指令：
- ❌ "代码已写完，要我继续吗？"
- ❌ "测试已通过，需要提交吗？"

**应该**直接完成所有步骤，然后汇报：
- ✅ "已完成 F02 点云处理模块，测试通过，已提交。"

---

## Git 工作流 | Git Workflow

### 本地提交规范

```bash
# 每完成一个模块改动就提交
git add app/core/point_cloud/
git commit -m "feat(core): add point cloud processing module"

# 不要使用 git add .（明确指定文件）
# 不要在 main 分支直接提交（创建功能分支）
```

### 推送由组长执行

AI 代理**只创建本地提交**，不执行 `git push`。

组长会统一审查本地提交后推送。

---

## 安全边界 | Safety Boundary

### LLM 安全

详见 [docs/llm-safety-boundary.md](./docs/llm-safety-boundary.md)

**核心规则**：LLM 可以建议，但不能批准飞行。

- ✅ LLM 可以：解析任务、生成解释
- ❌ LLM 不能：批准飞行、覆盖安全规则

### 数据标注

所有 mock/simulated 数据必须标注来源：

```python
class EnvironmentData(BaseModel):
    wind_speed: float
    source: Literal["mock", "simulated", "real"]
    timestamp: datetime
```

### 不确定性处理

信息不足时明确标注：

```python
if not has_sufficient_data():
    return DecisionResult(
        decision="require_human_review",
        reason="当前信息不足，建议人工复核",
        confidence=0.0
    )
```

---

## 参考文档 | References

- [PRODUCT_ROADMAP.md](./PRODUCT_ROADMAP.md) — 产品定位、开发路线
- [TECHNICAL_PROPOSAL.md](./TECHNICAL_PROPOSAL.md) — 功能定义、技术路径
- [docs/ENGINEERING.md](./docs/ENGINEERING.md) — Issue 标签、Milestone、PR 流程
- [docs/evaluation-metrics.md](./docs/evaluation-metrics.md) — 评测合约
- [docs/llm-safety-boundary.md](./docs/llm-safety-boundary.md) — LLM 安全边界

---

## 当前开发阶段 | Current Stage

**阶段 1**：核心功能实现（F01-F10）

详见 [PRODUCT_ROADMAP.md](./PRODUCT_ROADMAP.md) 第六章。

---

**文档版本**：5.0  
**最后更新**：2026年  
**维护者**：SkyOps 团队 | @DXL-0702
