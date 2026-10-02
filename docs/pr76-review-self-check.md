# PR #76 review 修复自检

审查基线：`f5bbd03f9b7b8892bc5f8050fa10b5a59bd45df2`。
功能修复截至 `eb4482628adb32a84e3062c7774e98895d39cc10`；本报告所在提交另补损坏压缩数据回归与文档索引。
验证日期：2026-10-03。所有场景为合成 mock 数据。

## 逐条核验

| Review 项 | 修复与验证证据 | 结果 |
| --- | --- | --- |
| [P1 原生依赖](https://github.com/Ceng-0324/SkyOps/pull/76#discussion_r4168754136) | CI/README 补 EGL、GL、OpenMP、IDN2、Fortran 动态库；干净 Linux 容器按锁文件安装后成功导入 Open3D/app.main；全量测试真实解析 PCD；独立进程验证缺 Open3D 时 health 可用，检测返回 503 | 通过 |
| [P1 聚类错误](https://github.com/Ceng-0324/SkyOps/pull/76#discussion_r4168754145) | 使用 SciPy cKDTree 欧氏连通聚类；相隔 100 米的两簇分离，容差增大才连接；孤立噪声被过滤；10/20/50 点采样保持簇数；顺序稳定且无 20 障碍截断 | 通过 |
| [P1 失败伪装空场景](https://github.com/Ceng-0324/SkyOps/pull/76#discussion_r4168754153) | 模型验证有限 N×3 实数与颜色；三种真实 PCD 编码混入 NaN/Inf 均返回 400；算法抛异常返回 500；合法低点场景才返回 200 空结果；损坏压缩流被拒绝 | 通过 |
| [P2 文件边界](https://github.com/Ceng-0324/SkyOps/pull/76#discussion_r4168754164) | 配置根目录，解析后拒绝路径/符号链接越界；非阻塞打开并检查普通文件；FIFO 在有超时保护的子进程中验证；文件、头部点数、声明解码大小受限，再解析有界快照 | 通过 |
| [P2 来源丢失](https://github.com/Ceng-0324/SkyOps/pull/76#discussion_r4168754168) | loader 与 detector 分别覆盖 mock/simulated/real；有障碍和空结果均保留来源；HTTP 固定 mock 并序列化到 result.source | 通过 |
| Ruff 8 项错误 | 修复 UTC 别名和未使用 import；全后端 Ruff 检查通过 | 通过 |
| 成功加载/颜色/来源测试缺失 | 使用合成 ASCII PCD 样本和临时生成的 ASCII/binary/binary_compressed 彩色 PCD；移除跳过测试 | 通过 |
| API 与测试断言不足 | 加入完整 PCD→HTTP 测试、参数校验和错误状态断言；置信度测试先断言恰好一个障碍 | 通过 |
| 整体覆盖率 >80% | 明确六文件范围，248/264 条语句覆盖，报告四舍五入为 94% | 通过 |

## 实际执行结果

- **macOS ARM64 / Python 3.12.13**：`.venv/bin/pytest -q` → **209 passed**，无跳过。
- **干净 Debian Linux ARM64 容器 / Python 3.12.14**：按 `uv.lock` 安装 80 个包，Open3D 0.20.0；安装文档列出的原生依赖后导入成功；全量 pytest → **209 passed**，无跳过。
- `.venv/bin/ruff check .` → **通过**。
- 本次涉及的 13 个 Python 文件执行 Ruff 格式化/格式检查 → **通过**。未将基线遗留格式差异混入修复。
- `npm run build` → **通过**，仍有既有 bundle 大小提示；未改前端功能。
- `git diff --check` → **通过**。

Linux 覆盖率使用临时验证环境中的 coverage 7.16.2，未改项目依赖或锁文件。
按 `app/` 目录收集，报告限定以下范围，避免只用 detector 的覆盖率代表整个增量：

| 文件 | 语句 | 未覆盖 | 覆盖率 |
| --- | ---: | ---: | ---: |
| app/api/routes/point_cloud.py | 29 | 0 | 100% |
| app/api/schemas/point_cloud.py | 10 | 0 | 100% |
| app/core/models/point_cloud.py | 42 | 0 | 100% |
| app/core/point_cloud/__init__.py | 3 | 0 | 100% |
| app/core/point_cloud/detector.py | 48 | 0 | 100% |
| app/core/point_cloud/loader.py | 132 | 16 | 88% |
| **合计** | **264** | **16** | **94%** |

在已安装 coverage 的独立验证环境、`backend/` 目录中可复现：

```bash
python -m coverage run --source=app -m pytest -q -p no:cacheprovider
python -m coverage report -m \
  --include='app/core/point_cloud/*,app/core/models/point_cloud.py,app/api/routes/point_cloud.py,app/api/schemas/point_cloud.py' \
  --fail-under=81
```

## 边界与后续复核

- GitHub Ubuntu x86_64 CI 需要用户推送后运行；本报告没有将本地 Linux 结果表述为远端 CI 已通过。
- 检测仍是基础几何算法，连通链可能连接相邻物体；置信度是启发式，未验证真实传感器精度。
- 受控输入目录由可信操作人员管理；接口不提供不可信用户上传或任意目录读权限。
- 当前 HTTP 来源固定 mock；新增来源字段、配置目录及错误契约详见 [点云 API](point-cloud-api.md)。
- 没有修改安全规则、F03、前端地图或旧评测框架，也没有推送、回复/关闭 review thread 或合并 PR。
