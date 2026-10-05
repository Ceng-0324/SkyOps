<p align="center">
  <img src="./frontend/src/public/skyops_readme_header_1.png" alt="SkyOps" width="100%" />
</p>

<h1 align="center">SkyOps</h1>

<p align="center">
  <strong>Spatial Intelligence-Powered Autonomous Coordination System for Low-Altitude Operations</strong>
</p>

<p align="center">
  From single-task execution to multi-agent collaboration: safer, explainable, and adaptive operations across inspection, emergency response, logistics, and beyond.
</p>

<p align="center">
  <a href="./README.zh-CN.md">中文文档</a>
  ·
  <a href="#overview">Overview</a>
  ·
  <a href="#core-capabilities">Capabilities</a>
  ·
  <a href="#architecture">Architecture</a>
  ·
  <a href="#documentation">Documentation</a>
</p>

<p align="center">
  <img alt="Backend" src="https://img.shields.io/badge/backend-FastAPI-009688?style=flat-square" />
  <img alt="Python" src="https://img.shields.io/badge/python-3.12-3776AB?style=flat-square&logo=python&logoColor=white" />
  <img alt="Frontend" src="https://img.shields.io/badge/frontend-React-61DAFB?style=flat-square&logo=react&logoColor=black" />
  <img alt="TypeScript" src="https://img.shields.io/badge/typescript-5.9-3178C6?style=flat-square&logo=typescript&logoColor=white" />
  <img alt="Status" src="https://img.shields.io/badge/status-active%20development-0F172A?style=flat-square" />
</p>

---

## Current implementation

The dark dashboard and Task / Scene / Plan workspace implement the F01–F03 simulation loop: structured task parsing, point-cloud obstacle detection, and candidate route comparison. The integrated image workflow currently uses a paired mock campus and target A; real registration, full multimodal input, and persistent planning results are future work.

The F04 backend now previews wind changes and added tasks against a selected F03 candidate, with rule evidence, dependency impacts and response comparisons. Its workspace UI is pending design confirmation. Existing risk, incident and review screens remain in an explicitly separate scenario reference tool. This is not completion of the full five-view redesign. See [development status and acceptance gates](docs/DEVELOPMENT_PLAN.md); local verification does not replace PR CI and merge approval.

## Overview

**SkyOps** is a spatial intelligence-powered autonomous coordination system for low-altitude operations. It combines world models, multi-agent collaboration, and spatial voice interaction to enable task-level autonomous decision-making across diverse scenarios.

### What SkyOps Is

SkyOps is the **autonomous coordination layer** between operational requirements and execution systems. It provides:

- **Spatial Intelligence**: 3D scene understanding, world model prediction, and active exploration
- **Autonomous Coordination**: Multi-agent collaboration, adaptive planning, and task recovery
- **Spatial Voice Collaboration**: Voice + map selection with role-based permissions and evidence traceability

### What SkyOps Is NOT

- ❌ A defect detection or CV recognition system
- ❌ A low-level flight controller
- ❌ A real-time drone hardware interface
- ❌ A regulatory approval system

| Traditional Approach | SkyOps Approach |
| --- | --- |
| Pre-set fixed routes | Dynamic planning based on real-time environment |
| Single-drone, manual coordination | Multi-agent autonomous collaboration |
| Abort on obstacles | Real-time replanning with completed work preserved |
| Manual post-flight review | Automated evidence-based review |
| Experience-dependent, hard to generalize | World model prediction, rapid environment adaptation |

---

## Core Capabilities

### 1. Spatial Intelligence

**Understand space, predict future, explore actively**

- **3D Scene Understanding**: Point cloud processing → obstacle detection → spatial relation graph
- **World Model**: Real-time 3D Gaussian Splatting reconstruction + action-conditioned future prediction
- **Scene Completion**: Infer complete 3D scene from limited observations
- **Active Exploration**: Identify under-reconstructed areas and autonomously plan supplementary coverage

**Technologies**: Open3D, PyTorch Geometric, 3DGS, Physically Embodied Gaussian Splatting

---

### 2. Autonomous Coordination

**Coordinate multiple agents, adapt to changes, recover from failures**

- **Multi-Agent Collaboration**: Hierarchical architecture with task allocation and conflict avoidance
- **Adaptive Planning**: Strategy composition, constraint checking, incremental replanning
- **Risk Simulation**: What-if analysis and visualization of different plan outcomes
- **Task Recovery**: Preserve completed work and dynamically adjust remaining tasks

**Technologies**: NetworkX, RRT*, DRL (future), Vertiport scheduling

---

### 3. Spatial Voice Collaboration

**Voice + map + roles = transparent decisions**

- **Multimodal Input**: Voice + text + map selection
- **Spatial Reference Understanding**: "here" and "that obstacle" bind to map objects
- **Multi-Role Coordination**: Separate suggestion / approval / execution with permissions
- **Evidence Traceability**: Complete timeline replay of who decided what, when, and why

**Technologies**: Whisper (eval), Azure Speech (eval), WebSocket, RBAC

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   User Interaction Layer                 │
│         Voice │ Text │ Map │ Touch │ Hybrid             │
└─────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────┐
│              Spatial Voice Collaboration                 │
│  Speech Recognition/Synthesis │ Spatial Reference       │
│  Multi-turn Dialogue │ Role Permissions                 │
└─────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────┐
│            Task Understanding & Decomposition            │
│  Intent Recognition │ Task Breakdown │ Dependency       │
└─────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────┐
│         Environment Sensing & Spatial Reasoning          │
│  Point Cloud │ Obstacle Detection │ Graph Reasoning     │
└─────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────┐
│              Autonomous Coordination Layer               │
│  Multi-Agent │ Task Allocation │ Adaptive Planning      │
└─────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────┐
│        Spatial Intelligence (World Model, Stage 3)       │
│  3DGS Reconstruction │ Future Prediction │ Exploration  │
└─────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────┐
│               Evidence & Review Layer                    │
│  Evidence Linking │ Timeline │ Spatial Replay │ Audit   │
└─────────────────────────────────────────────────────────┘
```

---

## Application Scenarios

| Scenario | Core Requirements | SkyOps Value |
|----------|------------------|--------------|
| **Building & Facility Inspection** | Handle occlusion, temporary obstacles, ensure coverage | Real-time environment modeling, world model occlusion prediction |
| **Solar Farm Inspection** | Coordinate distributed targets, handle temporary changes | Multi-agent collaboration, dynamic task allocation |
| **Infrastructure Inspection** | Organize tasks by asset distribution, adjust on constraint changes | Graph spatial reasoning, incremental replanning |
| **Emergency Response** | Rapid scene understanding, dynamic search path adjustment | Real-time environment modeling, risk simulation |
| **Logistics & Delivery** | Multi-drone scheduling, conflict avoidance, battery management | Vertiport scheduling, multi-agent coordination |
| **Security Patrol** | Cover key areas, respond to anomalies | Adaptive planning, task recovery |
| **Mapping & Surveying** | Efficient coverage, active supplementary capture | Active exploration, scene completion |

---

## Technology Stack

### Backend
- **Language**: Python 3.12
- **Web Framework**: FastAPI, Pydantic v2, uvicorn
- **Point Cloud & Geometry**: Open3D, NumPy, SciPy
- **Graph & Planning**: NetworkX, RRT*, A*
- **Deep Learning**: PyTorch, PyTorch Geometric
- **World Model**: 3DGS (gsplat, nerfstudio)
- **Database**: SQLite (initial), PostgreSQL (eval)
- **Testing**: pytest, Ruff

### Frontend
- **Framework**: React 19, TypeScript 5, Vite
- **Styling**: Tailwind CSS 4
- **3D Visualization**: Three.js, React Three Fiber, @react-three/drei
- **State Management**: Zustand
- **Charts**: Recharts
- **Icons**: lucide-react

---

## Documentation

- **[PRODUCT_ROADMAP.md](./PRODUCT_ROADMAP.md)**: Product positioning, development roadmap, stages 0-4
- **[TECHNICAL_PROPOSAL.md](./TECHNICAL_PROPOSAL.md)**: Core functions (F01-F10), extension roadmap (E01-E09), world model tech path
- **[AGENTS.md](./AGENTS.md)**: Development guidelines for AI agents and team members
- **[docs/evaluation-metrics.md](./docs/evaluation-metrics.md)**: Phase 3 evaluation contracts (legacy reference)
- **[docs/llm-safety-boundary.md](./docs/llm-safety-boundary.md)**: LLM adapter safety boundary (long-term design principle)
- **[docs/point-cloud-api.md](./docs/point-cloud-api.md)**: F02 point-cloud API, directory configuration, and error contract
- **[docs/risk-simulation-api.md](./docs/risk-simulation-api.md)**: F04 candidate risk simulation, event inputs, response comparisons, and limitations

---

## Getting Started

### Prerequisites

- Python 3.12
- Node.js 18+
- uv (Python package manager)

### Installation

On Linux (Ubuntu/Debian, including headless servers), install Open3D's native runtime first:

```bash
sudo apt-get update
sudo apt-get install -y --no-install-recommends libegl1 libgl1 libgomp1 libidn2-0 libgfortran5
```

`uv sync` does not install these shared libraries. macOS uses the platform wheel and does not need apt.
After installing Python dependencies, run `uv run --frozen python -c "import open3d; import app.main"`
from `backend/` to verify the environment. No display or GPU is required. If the native runtime is
missing, point-cloud detection returns 503 while other APIs can still start.

```bash
# Clone the repository
git clone https://github.com/yourusername/SkyOps.git
cd SkyOps

# Backend setup
cd backend
uv sync
uv run pytest

# Frontend setup
cd ../frontend
npm install
npm run dev
```

### Running the System

```bash
# Start backend
cd backend
uv run uvicorn app.main:app --reload

# Start frontend (in another terminal)
cd frontend
npm run dev
```

Open http://localhost:5173 in your browser.

---

## Current Status

**Active Development** - Core functions (F01-F10) implementation in progress.

- ✅ Backend engineering foundation (FastAPI, Pydantic, pytest)
- ✅ Frontend engineering foundation (React, TypeScript, Vite, Tailwind)
- ✅ Task planning framework (YAML-based, transitioning to computed)
- ✅ Safety rules framework (explicit, configurable)
- ✅ Incident handling (event-driven templates)
- ✅ Mission review (heuristic-based, upgrading to evidence-based)
- ✅ Evaluation framework (39 mock cases, upgrading to independent validation)
- 🚧 Point cloud processing & spatial reasoning
- 🚧 Multi-agent coordination
- 🚧 Spatial voice collaboration
- 📋 World model integration (Stage 3, after extension functions)

---

## Safety Boundary

SkyOps operates under strict safety principles:

- **LLM can suggest, but cannot approve flight** - AI assists, rules decide
- **All safety rules are explicit, configurable, testable** - No black-box safety decisions
- **Mock/simulated data clearly labeled** - No pretending to be real data
- **Outputs distinguish fact, inference, suggestion, and human confirmation required** - Transparency first
- **When uncertain, recommend human review, pause, or conservative approach** - Safety over efficiency

---

## Contributing

See [AGENTS.md](./AGENTS.md) for development guidelines.

All contributions must:
- Follow the existing code style (Ruff for Python, TypeScript strict mode)
- Include tests for new features
- Not break existing evaluation cases
- Obtain team lead approval for architectural changes

---

## License

See [LICENSE](./LICENSE).

---

**Version**: 3.1  
**Last Updated**: 2026  
**Maintained by**: SkyOps Team
