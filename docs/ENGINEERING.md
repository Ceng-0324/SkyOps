# SkyOps 工程规范

本文档定义 SkyOps 项目的工程规范，包括 Issue 标签、Milestone、PR 流程等。

---

## Issue 标签体系

### 类型标签（Type）

| 标签 | 描述 | 使用场景 |
|------|------|---------|
| `bug` | Bug 或错误 | 功能异常、崩溃、错误输出 |
| `enhancement` | 功能增强 | 新功能、改进建议 |
| `task` | 开发任务 | 具体实现任务、技术债清理 |
| `documentation` | 文档相关 | 文档缺失、过时、需要补充 |
| `question` | 疑问讨论 | 技术咨询、使用问题 |

### 优先级标签（Priority）

| 标签 | 描述 | SLA |
|------|------|-----|
| `priority/P0` | 紧急阻塞 | 24 小时内响应 |
| `priority/P1` | 高优先级 | 3 天内响应 |
| `priority/P2` | 中优先级 | 1 周内响应 |
| `priority/P3` | 低优先级 | 按排期处理 |

### 状态标签（Status）

| 标签 | 描述 |
|------|------|
| `needs-triage` | 需要分类和优先级评估 |
| `needs-discussion` | 需要讨论方案 |
| `in-progress` | 正在进行中 |
| `blocked` | 被阻塞 |
| `ready-for-review` | 等待审查 |

### 模块标签（Module）

| 标签 | 描述 |
|------|------|
| `module/point-cloud` | 点云处理模块 |
| `module/planning` | 路径规划模块 |
| `module/graph` | 图空间推理模块 |
| `module/world-model` | 世界模型模块 |
| `module/api` | API 层 |
| `module/frontend` | 前端 |
| `module/testing` | 测试相关 |
| `module/ci-cd` | CI/CD 相关 |

### 阶段标签（Stage）

| 标签 | 描述 |
|------|------|
| `stage/0-baseline` | 阶段 0：需求与基线 |
| `stage/1-core` | 阶段 1：核心功能（F01-F10） |
| `stage/2-extension` | 阶段 2：扩展功能（E01-E09） |
| `stage/3-world-model` | 阶段 3：世界模型 |
| `stage/4-commercial` | 阶段 4：商业化 |

### 特殊标签

| 标签 | 描述 |
|------|------|
| `good-first-issue` | 适合新贡献者 |
| `help-wanted` | 需要帮助 |
| `breaking-change` | 破坏性变更 |
| `security` | 安全相关 |
| `dependencies` | 依赖更新 |

---

## Milestone 规划

### 当前 Milestones

#### M1: 阶段 1 核心功能（Stage 1）

**目标**：实现 F01-F10 核心功能

**验收标准**：
- [ ] F01-F10 全部实现
- [ ] 核心功能有单元测试
- [ ] API 文档完整
- [ ] 基线评测系统可运行

**预期时间**：按功能完成进度

---

#### M2: 阶段 2 扩展功能（Stage 2）

**目标**：实现 E01-E09 扩展功能

**验收标准**：
- [ ] 多机协同原型可运行
- [ ] 实时环境建模集成
- [ ] 图空间推理验证通过
- [ ] 跨场景泛化验证完成

**预期时间**：M1 完成后启动

---

#### M3: 阶段 3 世界模型（Stage 3）

**目标**：集成世界模型

**验收标准**：
- [ ] 3DGS 实时重建可运行
- [ ] 动作条件化预测实现
- [ ] 场景补全与主动探索验证
- [ ] 世界模型基线（W0-W3）评测完成

**预期时间**：M2 完成后启动

---

## PR 流程

### PR 创建

1. **从 main 创建功能分支**
   ```bash
   git checkout main
   git pull
   git checkout -b feat/your-feature-name
   ```

2. **开发并提交**
   ```bash
   # 每完成一个模块改动就提交
   git add <specific-files>
   git commit -m "feat(module): description"
   ```

3. **推送分支（由组长执行）**
   ```bash
   git push -u origin feat/your-feature-name
   ```

4. **创建 PR**
   ```bash
   gh pr create --title "feat: your feature" --body "description"
   ```

### PR 审查标准

#### 必须检查项

- [ ] 代码通过 CI（lint + format + test）
- [ ] PR 描述完整（改动内容、自测结果、风险点）
- [ ] 核心逻辑有测试覆盖
- [ ] 公共 API 有文档
- [ ] Mock 数据标注来源
- [ ] 无未解决的 review comments

#### 合并要求

- ✅ 至少 1 个 approve
- ✅ 所有 CI 通过
- ✅ 无冲突
- ✅ 组长最终批准（破坏性变更）

### PR 大小指南

| 大小 | 变更行数 | 建议 |
|------|---------|------|
| **XS** | < 50 行 | ✅ 理想 |
| **S** | 50-200 行 | ✅ 好 |
| **M** | 200-500 行 | ⚠️ 考虑拆分 |
| **L** | 500-1000 行 | ❌ 应该拆分 |
| **XL** | > 1000 行 | ❌ 必须拆分 |

**例外**：
- 自动生成代码（如 OpenAPI schema）
- 大型重构（需提前讨论）
- 初始项目搭建

---

## Branch 保护规则

### main 分支

- ✅ 需要 PR 才能合并
- ✅ 需要至少 1 个 approve
- ✅ 需要通过所有 status checks
- ✅ 需要分支是最新的
- ❌ 禁止 force push
- ❌ 禁止删除

### develop 分支（如启用）

- ✅ 需要 PR 才能合并
- ✅ 需要通过所有 status checks
- ⚠️ 可选 approve
- ❌ 禁止 force push

---

## CI/CD 规范

### CI 触发条件

- `push` 到 `main` 或 `develop`
- 针对 `main` 或 `develop` 的 `pull_request`
- 路径过滤：只在相关文件变更时触发

### CI 检查项

#### 后端（backend-ci.yml）

1. Ruff check
2. Ruff format check
3. pytest
4. pyproject.toml 语法检查

#### 前端（frontend-ci.yml）

1. TypeScript 类型检查
2. 构建测试（`npm run build`）
3. package.json 语法检查

### CI 失败处理

- ❌ CI 失败的 PR 不能合并
- 🔧 修复后自动重新触发 CI
- 💬 CI 失败时在 PR 中添加注释说明原因

---

## 发布流程

### 版本号规范

遵循 [Semantic Versioning 2.0.0](https://semver.org/)

```
MAJOR.MINOR.PATCH

- MAJOR: 破坏性变更
- MINOR: 向后兼容的功能新增
- PATCH: 向后兼容的 Bug 修复
```

**示例**：
- `0.1.0` - 初始版本
- `0.2.0` - 新增核心功能
- `0.2.1` - Bug 修复
- `1.0.0` - 第一个稳定版本

### 发布清单

- [ ] 更新 CHANGELOG.md
- [ ] 更新版本号（pyproject.toml, package.json）
- [ ] 运行完整测试套件
- [ ] 创建 Git tag
- [ ] 推送 tag 触发发布流程
- [ ] 更新文档网站（如有）

---

## 开发环境规范

### 必备工具

- Python 3.12
- Node.js 18+
- uv（Python 包管理器）
- Git

### 推荐工具

- VS Code + Python/TypeScript 插件
- GitHub CLI (`gh`)
- Docker（可选）

### 环境检查

```bash
# 后端环境检查
cd backend
uv sync
uv run pytest tests/
uv run ruff check .

# 前端环境检查
cd frontend
npm install
npm run build
```

---

## 参考文档

- [AGENTS.md](../AGENTS.md) - 开发执行规范
- [PRODUCT_ROADMAP.md](../PRODUCT_ROADMAP.md) - 产品路线图
- [TECHNICAL_PROPOSAL.md](../TECHNICAL_PROPOSAL.md) - 功能规划

---

**文档版本**：1.0  
**最后更新**：2026年  
**维护者**：SkyOps 团队
