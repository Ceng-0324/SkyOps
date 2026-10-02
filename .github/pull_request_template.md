## 改动内容

<!-- 简要描述这个 PR 做了什么 -->

- 

## 改动类型

<!-- 选择适用的类型 -->

- [ ] ✨ 新功能 (feat)
- [ ] 🐛 Bug 修复 (fix)
- [ ] 📝 文档更新 (docs)
- [ ] ♻️ 代码重构 (refactor)
- [ ] ✅ 测试补充 (test)
- [ ] 🔧 配置变更 (chore)

## 相关 Issue

<!-- 关联的 Issue，使用 Closes #123 会自动关闭 Issue -->

Closes #

## 自测结果

<!-- 本地验证情况 -->

- [ ] 通过 `ruff check` 和 `ruff format`（后端）
- [ ] 通过 `tsc -b`（前端）
- [ ] 通过 `pytest`（如有测试）
- [ ] 手动测试通过

## 风险点

<!-- 这个 PR 可能影响的模块或引入的风险 -->

- 

## 需要重点审查

<!-- 希望 reviewer 重点关注的部分 -->

- 

## 测试计划

<!-- 如何验证这个 PR -->

```bash
# 后端测试
cd backend
uv run pytest tests/

# 前端测试
cd frontend
npm run build
```

## 截图（如适用）

<!-- 如果是 UI 变更，提供截图 -->

## Checklist

- [ ] 代码遵守项目规范
- [ ] 核心逻辑有测试覆盖
- [ ] 公共 API 有文档
- [ ] Mock 数据标注了来源
- [ ] PR 描述完整
