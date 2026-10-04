# F02 前端数据与交互接口

工作区「场景」页已接入点云检测客户端和独立的 Zustand 状态；F01 mission 环境摘要不受影响。
左侧选择点云与检测参数，中央显示局部米制坐标的 XY/XZ 投影，右侧查看选中障碍详情。
默认「建筑巡检演示」使用 `mock-campus.pcd` 与共享场景清单，按人工设定的 0.2 m/px、X 向右/Y 向上关系叠加现有航拍影像。
它是**模拟配准**，不是实测地理配准；影像不提供真实尺度、高程或测绘精度。三处演示障碍由实际 F02 检测合成点云生成，
作业对象、P1–P3 与 S 则是清单中的人工演示标记，不覆盖用户任务页的观察点或起降点。
可切换「坐标核验」或 XZ 投影；其他点云只展示局部坐标图，不套用此配准。F03 尚未接入这套场景。
共享清单位于 `backend/app/data/point_clouds/mock-campus.json`；前端和点云生成器共同读取。
修改清单后运行 `python backend/app/data/point_clouds/generate_mock_campus.py` 重建 PCD。
后端回归验证生成结果可复现，并将实际检测包围盒反算回清单中的影像范围。

参数修改会清除旧结果，失败可重试，取消等待会忽略迟到响应但不承诺停止后端计算。
每份任务草稿保存自己的数据选择与参数；检测结果仅保留在当前工作区，刷新或切换任务后需重新检测。
返回首页再进入同一当前工作区会保留内存中的结果。
后端字段、单位、安全与错误语义见 [点云 API 合同](point-cloud-api.md)。

## 模块入口

- `frontend/src/api/pointCloud.ts`：请求、结果、障碍类型及 `detectObstacles(request)`。
  复用共享 `apiRequest`，不维护另一套 base URL、HTTP 错误处理或 fetch 客户端。
  网络响应先按 unknown 校验：结果/障碍结构、唯一且非空的 ID、有限三维坐标、非负尺寸、
  0–1 置信度、障碍类型、来源枚举、算法和带时区的可解析检测时间。允许额外字段，
  不替无效字段补默认值；违反契约时抛出 `PointCloudResponseError`，store 进入 error、
  result 保持 null，仍可 retry。HTTP 200 或合法 JSON 本身不代表检测成功。
- `frontend/src/features/environment/environmentStore.ts`：`createEnvironmentStore(detector?)`。
  每个实例独立；默认使用真实 API，测试可注入相同签名的异步 detector。
- `frontend/src/features/environment/useEnvironmentStore.ts`：共享 `environmentStore`、
  `useEnvironmentStore(selector, store?)`、`selectSelectedObstacle(state)`。
  导入模块和调用 hook 都不会自动发起检测。

请求的 `point_cloud_file` 是**后端受控目录内的路径**，不是浏览器本地文件，也不是上传入口。
数值参数省略时使用后端默认值：`height_threshold=0.5`、`min_points=10`、
`cluster_tolerance=1.0`；仓库 demo 也可显式使用 `cluster_tolerance=0.1`。
不在前端悄悄更正路径、来源或非法参数，后端校验失败进入错误态。

## 状态语义

`EnvironmentState` 是按 `status` 区分的联合类型：

| 状态 | result | error | 消费语义 |
| --- | --- | --- | --- |
| `idle` | `null` | `null` | 尚未检测或已经 reset，不能称为“无障碍” |
| `loading` | `null` | `null` | 检测中，禁用重复提交；旧结果已清除 |
| `success` 且 `result.obstacles.length === 0` | 完整结果 | `null` | 成功检测、没有保留的障碍，仍有来源和时间 |
| `success` 且障碍非空 | 完整结果 | `null` | 可以选择当前障碍 |
| `error` | `null` | 字符串 | 检测未完成，允许重试，不能当成成功空场景 |

结果完整保留服务端的 `source`、`detection_time`、`algorithm`、障碍坐标、尺寸、
置信度与类型。当前 HTTP 入口返回 `mock`，类型也容纳 `simulated` / `real`，
不能由文件名或页面模式覆盖来源。检测时间不等于采集时间，局部米制坐标不等于经纬度；
空结果、启发式 confidence 均不构成飞行安全审批。

## Actions 与竞态约定

- `detect(request): Promise<void>`：接受一次检测并保存独立请求快照。
  loading 时所有 detect（包括不同参数）都是立即完成的 no-op，不排队也不覆盖原请求。
  要替换进行中的检测，显式 `reset()` 后再 detect。
- `retry(): Promise<void>`：只在 error 时用最近失败的请求快照再试一次；其他状态 no-op。
  调用方之后修改原请求对象不影响 retry。没有自动重试循环。
- `selectObstacle(id | null): void`：仅选择当前成功结果中存在的 ID；未知 ID、非成功状态或
  `null` 均清空选择。每次接受新检测和 reset 都清空选择，即使下一次检测复用了相同 ID。
- `reset(): void`：恢复 idle、清空结果/错误/选择及重试请求，并使所有旧请求失效。
  请求代次在实例内管理，旧成功和旧失败都不能覆盖 idle、新 loading 或新结果。
  共享 client 当前不支持 AbortSignal，因此 reset **不承诺取消网络或后端计算**。

检测失败通过 store 的 error 暴露，detect/retry 的 Promise 正常完成；不要用 Promise
是否 resolved 判断检测成功，必须读取 status。直接调用 API 的 `detectObstacles` 则仍会 reject。
通过 actions 修改状态，不直接调用 Zustand 的 `setState` 绕过不变量。

## React 消费示例（无 UI）

```ts
import {
  useEnvironmentStore,
  selectSelectedObstacle,
} from "./features/environment/useEnvironmentStore";

// 在函数组件或自定义 hook 内：
const status = useEnvironmentStore(state => state.status);
const result = useEnvironmentStore(state => state.result);
const error = useEnvironmentStore(state => state.error);
const selected = useEnvironmentStore(selectSelectedObstacle);
const detect = useEnvironmentStore(state => state.detect);
const retry = useEnvironmentStore(state => state.retry);
const selectObstacle = useEnvironmentStore(state => state.selectObstacle);
const reset = useEnvironmentStore(state => state.reset);

// 由用户动作调用，而非在 render 中执行：
void detect({ point_cloud_file: "demo.pcd", cluster_tolerance: 0.1 });
```

Zustand 5 selector 应返回稳定引用或原始值；不要每次创建新的 `{ status, result }` 对象。
需要整个联合类型进行类型收窄时可用 `useEnvironmentStore(state => state)`。
独立工作区用稳定的 `createEnvironmentStore()` 实例作为 hook 第二参数；不要每次 render
新建 store。卸载组件不自动 reset 共享状态，应由拥有该工作区生命周期的调用方决定何时清除。

开发时 Vite 将 `/point-cloud` 代理至 `http://127.0.0.1:8000`，与其他 API 一致。
生产使用共享 client 的 `VITE_API_BASE_URL` 或同源反向代理；Vite dev proxy 不是生产代理。

## 页面入口

- `ScenePanel.tsx`：数据设置、检测状态、障碍列表与详情。
- `SceneMap.tsx`：基于 Leaflet `CRS.Simple` 的局部坐标图；包围盒保持实际尺寸，中心编号便于选择退化或微小障碍。
- `sceneInput.ts` / `obstacleGeometry.ts`：参数校验和局部坐标投影。视口边距不改变障碍几何；超出可可靠绘制范围的坐标显式提示，仍可查看列表数值。
- `SpatialTaskWorkspace.tsx`：复用工作区自己的 `environment` store、可调宽面板和移动端切换。

## 验证与可复现 smoke

```bash
cd frontend
npm ci
npm test
npm run build

# 已运行前端和真实 backend，Chrome 开启 CDP（默认端口 9223）：
SKYOPS_UI_BASE_URL=http://127.0.0.1:5173 node scripts/test-scene-browser.mjs

# 已运行真实 backend 时（只测试数据层，不验证 UI）：
SKYOPS_TEST_API_BASE_URL=http://127.0.0.1:8000 npm run test:environment:smoke

# 或在仓库根目录，使用已经安装后端依赖的 Python，自动启动并关闭 backend：
backend/.venv/bin/python frontend/scripts/smoke-environment.py
```

自动 smoke harness 使用 Unix socket FD（Linux/macOS）、临时端口及有界等待；finally 中回收
后端进程，不改点云文件。用仓库 demo 验证真实 HTTP → client → store → subscribe 状态链，
包括两个障碍、选择、提高阈值后的成功空结果、缺失文件错误、重试和 reset。

普通测试使用 Node 内置 test runner 和项目现有 Vite 打包 TypeScript，`tsc -b` 先检查类型；
没有新增依赖。只替换 HTTP 边界或注入 detector，不复制生产 client/store 实现。
React hook 有服务端渲染消费测试；状态通知由 store 订阅测试覆盖，这不等于浏览器 UI 集成测试。
产物放在被忽略的 `node_modules/.tmp/environment-tests`，不影响应用构建目录。
