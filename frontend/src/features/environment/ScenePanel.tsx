import { Box, ChevronRight, Crosshair, LoaderCircle, RotateCcw } from "lucide-react";
import type { Obstacle, ObstacleDetectionResult } from "../../api/pointCloud";
import type { EnvironmentState } from "./environmentStore";
import { sceneNumber, sceneRequest, sceneSourceNames, sceneStatusNames, type SceneInput } from "./sceneInput";

export function ScenePanel({ input, state, onChange, onSelect, onShowMap, storageError }: {
  input: SceneInput; state: EnvironmentState; onChange: (input: SceneInput) => void;
  onSelect: (id: string) => void; onShowMap: () => void; storageError: string;
}) {
  const validation = sceneRequest(input);
  const busy = state.status === "loading";
  const result = state.result;
  return <>
    <div className="ws-panel-scroll ws-scene-panel">
      {storageError && <p className="ws-error" role="alert">{storageError}</p>}
      <section className="ws-section">
        <div className="ws-section-heading"><h2>场景数据</h2><span className="ws-muted">PCD 点云</span></div>
        <label className="ws-field-label" htmlFor="scene-dataset">选择数据</label>
        <select id="scene-dataset" className="ws-input" value={input.dataset} disabled={busy} onChange={e => onChange({ ...input, dataset: e.target.value as SceneInput["dataset"], file: e.target.value === "demo" ? "demo.pcd" : "" })}>
          <option value="demo">合成点簇示例 · demo.pcd</option><option value="server">其他已配置点云</option>
        </select>
        {input.dataset === "server" && <><label className="ws-field-label" htmlFor="scene-file">受控目录中的文件路径</label><input id="scene-file" className="ws-input" maxLength={1024} value={input.file} disabled={busy} onChange={e => onChange({ ...input, file: e.target.value })} placeholder="例如：site/scan.pcd" /></>}
        <p className="ws-muted">{input.dataset === "demo" ? "仓库内的合成样本，包含两个相距约 100 m 的点簇；与任务航拍影像未关联。" : "使用服务端已配置的 PCD 文件。此处不上传浏览器本地文件，来源以检测结果为准。"}</p>
        <details className="ws-scene-parameters"><summary>检测参数</summary>
          <p className="ws-muted">用于过滤点和划分点簇，不是飞行安全阈值。</p>
          {([
            ["height", "高度阈值（m）", "0", "any"],
            ["minPoints", "最少点数", "1", "1"],
            ["tolerance", "聚类距离（m）", "0.1", "any"],
          ] as const).map(([key, label, min, step]) => <label key={key} className="ws-scene-parameter" htmlFor={`scene-${key}`}><span>{label}</span><input id={`scene-${key}`} className="ws-input" type="number" min={min} step={step} value={input[key]} disabled={busy} onChange={e => onChange({ ...input, [key]: e.target.value.slice(0, 32) })} /></label>)}
        </details>
        {validation.error && <p className="ws-error" role="status">{validation.error}</p>}
      </section>
      <section className="ws-section">
        <div className="ws-section-heading"><h2>障碍检测</h2><span className={state.status === "error" ? "ws-amber" : "ws-cyan"} role="status">{sceneStatusNames[state.status]}</span></div>
        {state.status === "idle" && <p className="ws-muted">确认数据与参数后开始检测。修改设置或刷新页面后，需要重新检测。</p>}
        {busy && <p className="ws-muted" role="status">正在读取点云并识别点簇，请稍候…</p>}
        {state.status === "error" && <div className="ws-error" role="alert"><strong>检测未完成</strong><p>{state.error}</p><p>检查文件路径、参数或服务连接后重试。</p></div>}
        {result && <>
          <div className="ws-scene-result-heading"><strong>{result.obstacles.length} 个障碍</strong><span>{sceneSourceNames[result.source]}</span></div>
          <div className="ws-obstacle-list" aria-label="检测障碍列表">{result.obstacles.map((o, i) => <button className={`ws-obstacle-row ${state.selectedObstacleId === o.id ? "is-selected" : ""}`} data-obstacle-row={o.id} aria-pressed={state.selectedObstacleId === o.id} key={o.id} onClick={() => onSelect(o.id)}>
            <span className="ws-obstacle-index">{String(i + 1).padStart(2, "0")}</span><span><strong>{o.id}</strong><small>{o.obstacle_type === "unknown" ? "类型未识别" : o.obstacle_type}</small></span><span className="ws-obstacle-height">{sceneNumber(o.size[2])} m<small>垂直尺寸</small></span><ChevronRight size={14} />
          </button>)}</div>
          <p className="ws-muted">{result.obstacles.length ? "选择障碍查看几何范围与详情。" : "本次检测没有保留障碍，不代表空间已确认安全。"}</p>
          <dl className="ws-scene-metadata"><div><dt>检测时间</dt><dd><time dateTime={result.detection_time}>{new Date(result.detection_time).toLocaleString("zh-CN", { hour12: false })}</time></dd></div><div><dt>算法</dt><dd>{result.algorithm}</dd></div></dl>
        </>}
      </section>
      <section className="ws-section"><div className="ws-section-heading"><h2>坐标关联</h2><span className="ws-amber">未配准</span></div><p className="ws-muted">检测坐标为局部米制坐标。尚未与航拍影像、作业对象及观察点建立对应关系。</p><button className="ws-text-button" onClick={onShowMap}><Box size={14} />查看场景空间视图</button></section>
    </div>
    <footer className="ws-task-footer ws-scene-footer"><p>参数保存在本机；检测结果仅保留在当前工作区。</p><button className="ws-primary ws-full" disabled={busy || !validation.request} onClick={() => {
      if (state.status === "error") void state.retry();
      else if (validation.request) void state.detect(validation.request);
    }}>{busy ? <LoaderCircle className="ws-spinner" size={16} /> : <Crosshair size={16} />}{busy ? "正在检测…" : state.status === "error" ? "重试检测" : result ? "重新检测" : "开始检测"}</button>
      {state.status !== "idle" && <button className="ws-text-button ws-clear-detection" onClick={() => state.reset()}><RotateCcw size={13} />{busy ? "取消等待" : "清除检测结果"}</button>}
      {busy && <p className="ws-muted">取消等待会忽略本次结果，服务端计算可能继续。</p>}
    </footer>
  </>;
}

export function ObstacleDetails({ obstacle: o, result }: { obstacle: Obstacle; result: ObstacleDetectionResult }) {
  return <div className="ws-obstacle-details"><p className="ws-muted">{sceneSourceNames[result.source]} · 检测结果</p>
    <dl className="ws-object-fields"><div><dt>类型</dt><dd>{o.obstacle_type === "unknown" ? "未识别" : o.obstacle_type}</dd></div><div><dt>启发式置信度</dt><dd>{sceneNumber(o.confidence)}</dd></div></dl>
    <h3>中心位置 / m</h3><dl className="ws-scene-vector">{o.position.map((value, i) => <div key={i}><dt>{"XYZ"[i]}</dt><dd>{sceneNumber(value)}</dd></div>)}</dl>
    <h3>包围盒尺寸 / m</h3><dl className="ws-scene-vector">{o.size.map((value, i) => <div key={i}><dt>{["X 宽度", "Y 深度", "Z 高度"][i]}</dt><dd>{sceneNumber(value)}</dd></div>)}</dl>
    <p className="ws-inspector-note">Z 相对于点云坐标原点，不是海拔或离地高度。包围盒是几何范围，未识别具体物体。</p><p className="ws-muted">置信度为未经真实传感器校准的启发式分数，不是安全概率。检测结果不构成飞行批准。</p>
  </div>;
}
