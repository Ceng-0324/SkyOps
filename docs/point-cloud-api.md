# F02 点云障碍检测 API

此接口处理本地 **mock PCD**，为后续规划提供几何障碍。当前不接真实传感器，也不批准飞行。
Linux/macOS 环境准备见 [README](../README.zh-CN.md#安装)。

## 请求与响应

`POST /point-cloud/detect-obstacles`，服务默认地址 `http://127.0.0.1:8000`。

```json
{
  "point_cloud_file": "demo.pcd",
  "height_threshold": 0.5,
  "min_points": 10,
  "cluster_tolerance": 0.1
}
```

仓库自带 `backend/app/data/point_clouds/demo.pcd`，是两个相隔约 100 米的合成点簇。
上述请求返回 `result` 对象，包含两个障碍、`detection_time`、
`algorithm: "height_threshold_euclidean"` 和 `source: "mock"`。
`obstacles` 中的每个对象包含 `id`、`position`、`size`、`confidence`、`obstacle_type`。

- 坐标是局部笛卡尔坐标，单位为米；Z 表示相对于输入坐标原点的高度。
- 高度过滤保留 `z > height_threshold`，这不是地面拟合或海拔转换。
- `cluster_tolerance` 是欧氏邻接半径，边界包含在内；通过邻接链相连的点组成一个簇。
- `min_points` 是每个连通簇的最少点数。噪声簇被丢弃，不预设障碍物数量。
- `confidence` 仅为点数与包围盒密度的启发式分数，未经真实传感器数据校准。
- 所有有效响应（包括空结果）均带来源。当前 HTTP 入口固定为 mock；核心 loader/detector
  可传递调用方提供的 mock/simulated/real 标记，不能据文件名自动认定为真实观测。
- `detection_time` 是检测时间，PCD 不提供可靠采集时间；内部点云默认时间为加载时刻。

## 文件与资源配置

| 环境变量 | 默认值 | 用途 |
| --- | --- | --- |
| `SKYOPS_POINT_CLOUD_DATA_DIR` | 仓库 `backend/app/data/point_clouds` | 运维配置的受控输入目录 |
| `SKYOPS_POINT_CLOUD_MAX_BYTES` | 16777216（16 MiB） | 文件及声明解码载荷大小上限 |
| `SKYOPS_POINT_CLOUD_MAX_POINTS` | 100000 | 声明和解析点数上限 |

相对路径从配置目录解析；绝对路径和符号链接解析后也必须位于该目录内。
目录应由可信操作人员管理，不能向不可信用户开放写入；接口不提供文件上传能力。
FIFO、目录及其他非普通文件一律拒绝。

支持 `.pcd` 的 `ascii`、`binary` 和 `binary_compressed` 编码。加载器先读取有大小上限的快照，
验证字段、维度、声明点数及载荷长度，再让 Open3D 解析快照。NaN、Inf、非法形状、损坏或
不完整的载荷都会拒绝，不能以丢点清洗或成功空场景掩盖数据错误。

坐标字段 `x/y/z` 的类型和宽度还须符合当前 Open3D 原生解析能力：

| 编码 | 坐标 TYPE / SIZE（字节） |
| --- | --- |
| `binary`、`binary_compressed` | `F/4`、`I/1,2,4`、`U/1,2,4` |
| `ascii` | 沿用文本格式校验，不套用二进制宽度限制 |

任一坐标轴使用不支持的二进制组合（包括 `F/8`、`I/8`、`U/8`）会在原生解析前返回
HTTP 400，错误信息指出编码、坐标轴及类型宽度。Open3D 0.20.0 会把这些坐标静默读成零，
所以不能只检查解析点数和有限性。该限制按字段名判断，不禁止非坐标辅助字段使用 64 位。

聚类另有 500 万次邻域连接的计算预算（包含自连接及双向连接），避免极密点云或巨大容差
触发过量计算。超预算会显式拒绝；可下采样输入或降低容差后重试，不会返回截断的结果。

## 错误契约

| HTTP 状态 | 意义 |
| --- | --- |
| 400 | 无效 PCD、非普通文件、非法格式或聚类预算超限 |
| 403 | 目录越界或不可访问的路径 |
| 404 | 受控目录内的文件不存在 |
| 413 | 文件、解码载荷或点数超限 |
| 422 | 请求参数校验失败，包括 NaN/Inf、非正整数点数或空路径 |
| 500 | 检测内部计算失败；详情写入服务端日志 |
| 503 | Open3D 或所需原生动态库不可用 |

消费者必须把错误视为“检测未完成”。只有有效数据成功检测后，才可能返回 HTTP 200 和空障碍。
无障碍检测结果也不代表已经完成飞行安全审批。

## 验证

```bash
cd backend
uv run --frozen pytest
uv run --frozen ruff check .
```

`tests/test_point_cloud_api.py` 使用临时 PCD 验证完整 HTTP 链路；
`tests/unit/test_point_cloud_loader.py` 覆盖三种编码、颜色和来源；
`tests/unit/test_obstacle_detector.py` 覆盖多簇、噪声、采样密度、顺序稳定性和显式失败；
`tests/test_point_cloud_runtime.py` 验证缺少 Open3D 时应用仍启动且检测返回 503。
`tests/test_point_cloud_binary_contract.py` 独立手工编码 PCD，覆盖普通/压缩二进制类型矩阵、
坐标轴重排、辅助字段和 ASCII 对照，不依赖 Open3D writer 生成样本。
