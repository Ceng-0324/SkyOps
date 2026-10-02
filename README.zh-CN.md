<p align="center">
  <img src="./frontend/src/public/skyops_readme_header_1.png" alt="SkyOps" width="100%" />
</p>

<h1 align="center">SkyOps</h1>

<p align="center">
  <strong>基于空间智能的低空作业自主协同系统</strong>
</p>

<p align="center">
  从单任务执行到多智能体协同：更安全、可解释、自适应的巡检、应急、物流等低空作业场景。
</p>

<p align="center">
  <a href="./README.md">English</a>
  ·
  <a href="#项目概览">项目概览</a>
  ·
  <a href="#核心能力">核心能力</a>
  ·
  <a href="#系统架构">系统架构</a>
  ·
  <a href="#文档索引">文档索引</a>
</p>

<p align="center">
  <img alt="Backend" src="https://img.shields.io/badge/backend-FastAPI-009688?style=flat-square" />
  <img alt="Python" src="https://img.shields.io/badge/python-3.12-3776AB?style=flat-square&logo=python&logoColor=white" />
  <img alt="Frontend" src="https://img.shields.io/badge/frontend-React-61DAFB?style=flat-square&logo=react&logoColor=black" />
  <img alt="TypeScript" src="https://img.shields.io/badge/typescript-5.9-3178C6?style=flat-square&logo=typescript&logoColor=white" />
  <img alt="Status" src="https://img.shields.io/badge/status-active%20development-0F172A?style=flat-square" />
</p>

---

## 项目概览

**SkyOps** 是基于空间智能的低空作业自主协同系统。融合世界模型、多智能体协同和空间语音交互，为多种低空作业场景提供任务级自主决策能力。

### SkyOps 是什么

SkyOps 是作业需求与执行系统之间的**自主协调层**，提供：

- **空间智能**：3D 场景理解、世界模型预测、主动探索
- **自主协同**：多机协作、自适应规划、任务恢复
- **空间语音协同**：语音+地图选择+角色权限+证据溯源

### SkyOps 不是什么

- ❌ 缺陷检测或 CV 识别系统
- ❌ 底层飞控系统
- ❌ 实时无人机硬件接口
- ❌ 监管审批系统

| 传统方案 | SkyOps 方案 |
| --- | --- |
| 预设固定航线 | 根据实时环境动态规划 |
| 单机执行，人工协调 | 多机自主协同 |
| 遇到障碍中止任务 | 实时重规划，保留已完成工作 |
| 执行后人工复盘 | 自动生成证据化复盘报告 |
| 经验依赖，难以泛化 | 世界模型预测，快速适应新环境 |

---

## 核心能力

### 1. 空间智能

**理解空间、预测未来、主动探索**

- **3D 场景理解**：点云处理 → 障碍识别 → 空间关系图
- **世界模型**：实时 3DGS 重建 + 动作条件化未来预测
- **场景补全**：从有限观测推断完整 3D 场景
- **主动探索**：识别未充分重建区域，自动规划补拍路径

**技术栈**：Open3D、PyTorch Geometric、3DGS、Physically Embodied Gaussian Splatting

---

### 2. 自主协同

**协调多机、适应变化、故障恢复**

- **多机协同**：分层架构，任务分配、冲突避让
- **自适应规划**：策略组合、约束检查、增量重规划
- **风险预演**：what-if 推演，可视化不同方案的预期结果
- **任务恢复**：保留已完成工作，动态调整剩余任务

**技术栈**：NetworkX、RRT*、DRL（规划中）、Vertiport 调度

---

### 3. 空间语音协同

**语音+地图+角色=透明决策**

- **多模态输入**：语音 + 文字 + 地图圈选
- **空间指代理解**："这里""那个障碍"绑定地图对象
- **多角色协同**：建议/批准/执行分开记录，权限控制
- **证据追溯**：完整时间线回放，谁在何时决定了什么

**技术栈**：Whisper（评估中）、Azure Speech（评估中）、WebSocket、RBAC

---

## 系统架构

```
┌─────────────────────────────────────────────────────────┐
│                   用户交互层                              │
│         语音 │ 文字 │ 地图 │ 触屏 │ 混合交互             │
└─────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────┐
│              空间语音协同层                               │
│  语音识别/合成 │ 空间指代解析 │ 多轮对话 │ 角色权限      │
└─────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────┐
│            任务理解与分解层                               │
│  意图识别 │ 任务分解 │ 依赖分析 │ 完成条件 │ 约束提取    │
└─────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────┐
│          环境感知与空间推理层                             │
│  点云处理 │ 障碍识别 │ 遮挡分析 │ 图推理 │ 动态地图更新  │
└─────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────┐
│              自主协同层                                   │
│  多机协同 │ 任务分配 │ 冲突避让 │ 自适应规划 │ 任务恢复  │
└─────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────┐
│        空间智能层（世界模型，阶段 3，扩展功能完成后）     │
│  3DGS重建 │ 世界模型 │ 未来预测 │ 场景补全 │ 主动探索    │
└─────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────┐
│              证据与复盘层                                 │
│  证据关联 │ 时间线生成 │ 空间复盘 │ 交接记录 │ 审计支持  │
└─────────────────────────────────────────────────────────┘
```

---

## 应用场景

| 场景 | 核心需求 | SkyOps 价值 |
|------|---------|-----------|
| **建筑及设施巡检** | 应对遮挡、临时障碍，保证覆盖质量 | 实时环境建模，世界模型预测遮挡 |
| **园区光伏巡检** | 协调分布目标，处理临时变化 | 多机协同，动态任务分配 |
| **基础设施巡检** | 根据资产分布组织任务，约束变化后调整 | 图空间推理，增量重规划 |
| **应急响应** | 快速理解现场，动态调整搜救路径 | 实时环境建模，风险预演 |
| **物流配送** | 多机调度，避让冲突，电池管理 | Vertiport 调度，多机协同 |
| **安防巡逻** | 覆盖重点区域，响应异常事件 | 自适应规划，任务恢复 |
| **测绘与建模** | 高效覆盖，主动补采 | 主动探索，场景补全 |

---

## 技术栈

### 后端
- **语言**：Python 3.12
- **Web 框架**：FastAPI、Pydantic v2、uvicorn
- **点云与几何**：Open3D、NumPy、SciPy
- **图与规划**：NetworkX、RRT*、A*
- **深度学习**：PyTorch、PyTorch Geometric
- **世界模型**：3DGS（gsplat、nerfstudio）
- **数据库**：SQLite（初期）、PostgreSQL（评估）
- **测试**：pytest、Ruff

### 前端
- **框架**：React 19、TypeScript 5、Vite
- **样式**：Tailwind CSS 4
- **3D 可视化**：Three.js、React Three Fiber、@react-three/drei
- **状态管理**：Zustand
- **图表**：Recharts
- **图标**：lucide-react

---

## 文档索引

- **[PRODUCT_ROADMAP.md](./PRODUCT_ROADMAP.md)**：产品定位、开发路线、阶段 0-4
- **[TECHNICAL_PROPOSAL.md](./TECHNICAL_PROPOSAL.md)**：核心功能（F01-F10）、扩展路线图（E01-E09）、世界模型技术路径
- **[AGENTS.md](./AGENTS.md)**：AI 代理和团队成员开发指南
- **[docs/evaluation-metrics.md](./docs/evaluation-metrics.md)**：Phase 3 评测合约（历史参考）
- **[docs/llm-safety-boundary.md](./docs/llm-safety-boundary.md)**：LLM 适配器安全边界（长期设计原则）

---

## 快速开始

### 环境要求

- Python 3.12
- Node.js 18+
- uv（Python 包管理器）

### 安装

Linux（Ubuntu/Debian，包括无显示器服务器）先安装 Open3D 的原生依赖：

```bash
sudo apt-get update
sudo apt-get install -y --no-install-recommends libegl1 libgl1 libgomp1
```

这些动态库不由 `uv sync` 安装。macOS 使用 Open3D 的平台 wheel，无需执行 apt。
安装 Python 依赖后，在 `backend/` 运行 `uv run --frozen python -c "import open3d; import app.main"`
检查环境；无需显示器或 GPU。缺少原生依赖时点云检测返回 503，其他 API 仍可启动。

```bash
# 克隆仓库
git clone https://github.com/yourusername/SkyOps.git
cd SkyOps

# 后端设置
cd backend
uv sync
uv run pytest

# 前端设置
cd ../frontend
npm install
npm run dev
```

### 运行系统

```bash
# 启动后端
cd backend
uv run uvicorn app.main:app --reload

# 启动前端（另一个终端）
cd frontend
npm run dev
```

在浏览器中打开 http://localhost:5173

---

## 当前状态

**正在积极开发** - 核心功能（F01-F10）实现中

- ✅ 后端工程基础（FastAPI、Pydantic、pytest）
- ✅ 前端工程基础（React、TypeScript、Vite、Tailwind）
- ✅ 任务规划框架（基于 YAML，正在迁移到可计算规划）
- ✅ 安全规则框架（显式、可配置）
- ✅ 异常处置（事件驱动模板）
- ✅ 任务复盘（基于启发式，升级为证据化）
- ✅ 评测框架（39 个 mock 用例，升级为独立验证）
- 🚧 点云处理与空间推理
- 🚧 多机协同
- 🚧 空间语音协同
- 📋 世界模型集成（阶段 3，扩展功能完成后）

---

## 安全边界

SkyOps 遵循严格的安全原则：

- **LLM 可以建议，但不能批准飞行** - AI 辅助，规则决策
- **所有安全规则显式、可配置、可测试** - 没有黑盒安全决策
- **Mock/模拟数据明确标注** - 不伪装成真实数据
- **输出区分事实、推理、建议和需要人工确认的事项** - 透明优先
- **不确定时，建议人工复核、暂停或保守方案** - 安全高于效率

---

## 贡献

参见 [AGENTS.md](./AGENTS.md) 了解开发指南。

所有贡献必须：
- 遵循现有代码风格（Python 用 Ruff，TypeScript 严格模式）
- 为新功能包含测试
- 不破坏现有评测用例
- 架构变更需获得团队负责人批准

---

## 许可证

见 [LICENSE](./LICENSE)。

---

**版本**：3.1  
**最后更新**：2026年  
**维护者**：SkyOps 团队
