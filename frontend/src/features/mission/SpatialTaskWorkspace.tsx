import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import { ArrowLeft, ArrowRight, Building2, ChevronRight, FileText, Folders, GitBranch, Layers, LayoutDashboard, LoaderCircle, MapPin, PanelLeftClose, PanelLeftOpen, Pencil, Plus, Route, Trash2, X } from "lucide-react";
import type { MissionDraft } from "./missionDrafts";
import { createWorkspace } from "./workspaceStore";
import { actionNames, addMapPoint, initialSpatialDraft, moveMapPoint, taskInputFor, type SpatialTaskDraft } from "./spatialTaskDraft";
import { ReferenceImageMap, type MapMode, type MapSelection } from "./ReferenceImageMap";
import { WorkspaceResizer } from "./WorkspaceResizer";
import { TaskTreeViewer } from "./TaskTreeViewer";
import { ScenePanel, ObstacleDetails } from "../environment/ScenePanel";
import { SceneMap } from "../environment/SceneMap";
import { defaultSceneInput, sceneStatusNames, type SceneInput } from "../environment/sceneInput";
import "../../styles/spatial-workspace.css";
import "../../styles/scene-workspace.css";

const ReferenceConsole = lazy(() => import("./MissionConsole").then(m => ({ default: m.MissionConsole })));
type DraftUpdate = Pick<MissionDraft, "rawInput" | "spatial" | "scene">;

export function SpatialTaskWorkspace({ draft, storageError, onChange, onBack, visible }: {
  draft: MissionDraft; storageError: string; onChange: (update: DraftUpdate) => void; onBack: () => void; visible: boolean;
}) {
  const [spatial, setSpatial] = useState(() => initialSpatialDraft(draft));
  const [rawInput, setRawInput] = useState(draft.rawInput);
  const [sceneInput, setSceneInput] = useState<SceneInput>(() => draft.scene ?? { ...defaultSceneInput });
  const [section, setSection] = useState<"task" | "scene">("task");
  const [workspace] = useState(() => {
    const w = createWorkspace();
    w.store.getState().setTaskInput(taskInputFor(initialSpatialDraft(draft), draft.rawInput));
    w.store.getState().setGeometry({ ...w.store.getState().geometry, targets: [] });
    return w;
  });
  const task = useStore(workspace.store, state => state.task);
  const environment = useStore(workspace.environment);
  const obstacle = environment.result?.obstacles.find(o => o.id === environment.selectedObstacleId);
  const [collapsed, setCollapsed] = useState(() => window.innerWidth <= 760);
  const [panelWidth, setPanelWidth] = useState(356);
  const [detailWidth, setDetailWidth] = useState(300);
  const [viewport, setViewport] = useState(window.innerWidth);
  const [selected, setSelected] = useState<MapSelection>(null);
  const showInspector = section === "scene" ? Boolean(obstacle) : Boolean(selected);
  const [mode, setMode] = useState<MapMode>(null);
  const [editing, setEditing] = useState(false);
  const [height, setHeight] = useState("");
  const [heightError, setHeightError] = useState("");
  const [reference, setReference] = useState(false);
  const [notice, setNotice] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const inspectorHeading = useRef<HTMLHeadingElement>(null);
  const inspectorOpener = useRef<HTMLElement | SVGElement | null>(null);
  const taskInputRef = useRef<HTMLTextAreaElement>(null);
  const point = selected === "start" ? spatial.start : spatial.points.find(p => p.id === selected);
  const leftWidth = Math.min(panelWidth, Math.max(300, Math.min(560, viewport * .45)));
  const rightWidth = Math.min(detailWidth, Math.max(270, Math.min(420, viewport - 160)));
  const narrow = viewport <= 760;

  useEffect(() => {
    workspace.connect();
    return () => workspace.dispose();
  }, [workspace]);
  useEffect(() => {
    const resize = () => setViewport(window.innerWidth);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  useEffect(() => {
    if (visible && !reference) { document.documentElement.lang = "zh-CN"; heading.current?.focus({ preventScroll: true }); }
  }, [visible, reference]);
  useEffect(() => { if (editing) taskInputRef.current?.focus(); }, [editing]);
  useEffect(() => { setHeight(point ? String(point.z) : ""); setHeightError(""); }, [point?.id, point?.z]);
  useEffect(() => { if (showInspector) inspectorHeading.current?.focus({ preventScroll: true }); }, [selected, environment.selectedObstacleId, showInspector]);

  function update(next: SpatialTaskDraft, input = rawInput) {
    setSpatial(next); setRawInput(input);
    const nextInput = taskInputFor(next, input);
    if (workspace.store.getState().taskInput !== nextInput) workspace.store.getState().setTaskInput(nextInput);
    onChange({ rawInput: input, spatial: next, scene: sceneInput });
  }
  function changeSection(next: "task" | "scene") {
    setSection(next); setSelected(null); setMode(null); setNotice("");
    environment.selectObstacle(null); setCollapsed(false);
  }
  function updateScene(next: SceneInput) {
    environment.reset(); setSceneInput(next);
    onChange({ rawInput, spatial, scene: next });
  }
  function selectObstacle(id: string) {
    inspectorOpener.current = document.activeElement as HTMLElement | null;
    environment.selectObstacle(id);
    if (narrow) setCollapsed(true);
  }
  function select(id: MapSelection) {
    if (!selected && document.activeElement instanceof Element) inspectorOpener.current = document.activeElement as HTMLElement | SVGElement;
    setSelected(id); setMode(null); setNotice("");
    if (narrow && id) setCollapsed(true);
  }
  function closeDetails() {
    setSelected(null); environment.selectObstacle(null);
    const opener = inspectorOpener.current;
    if (opener?.isConnected && opener.getClientRects().length) opener.focus({ preventScroll: true });
    else heading.current?.focus({ preventScroll: true });
  }
  function editMode(next: MapMode) { setMode(next); setSelected(null); setNotice(""); if (narrow) setCollapsed(true); }
  async function parse() {
    setSelected("tree"); setMode(null); if (narrow) setCollapsed(true);
    await workspace.store.getState().parse();
  }
  const status = task.status === "loading" ? "解析中" : task.status === "error" ? "解析失败" : task.data?.task_tree.status === "parsed" ? "已理解" : task.data ? "待澄清" : "待理解";

  return <div className="ws-root" hidden={!visible}>
    <style>{`@media(min-width:761px){.ws-shell{grid-template-columns:68px ${collapsed ? 0 : leftWidth}px minmax(0,1fr)}.ws-shell .ws-inspector{width:${rightWidth}px}.ws-scene-map.has-detail{right:${rightWidth + 90}px}}`}</style>
    {reference ? <div className="ws-reference"><header><button className="ws-button" onClick={() => setReference(false)}><ArrowLeft size={16} />返回任务编辑</button><p>独立场景参考工具 · 此处示例坐标与当前影像点位未关联</p></header><Suspense fallback={<p className="ws-loading">加载参考工具…</p>}><ReferenceConsole initialTaskInput={rawInput} /></Suspense></div>
      : <div className={`ws-shell ${collapsed ? "ws-collapsed" : ""}`}>
        <aside className="ws-rail"><Layers size={28} /><nav aria-label="工作区导航"><button aria-label="返回总览工作台" onClick={onBack}><LayoutDashboard size={19} /></button><button aria-label="当前任务" aria-current="page" onClick={() => changeSection("task")}><Folders size={19} /></button></nav><span className="ws-rail-source">SIM</span></aside>
        <header className="ws-header"><button className="ws-icon" onClick={onBack} aria-label="返回工作台"><ArrowLeft size={18} /></button><span className="ws-header-project">个人工作区</span><h1 ref={heading} tabIndex={-1}>{draft.name}</h1><span className="ws-draft-tag">草稿</span><span className="ws-header-source">模拟作业</span><button className="ws-collapse" aria-label={collapsed ? "展开任务面板" : "收起任务面板"} aria-expanded={!collapsed} aria-controls="ws-task-panel" onClick={() => { setCollapsed(!collapsed); if (narrow) { setSelected(null); environment.selectObstacle(null); } }}>{collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}<span>{collapsed ? "展开任务面板" : "收起任务面板"}</span></button></header>
        <aside className="ws-task-panel" id="ws-task-panel" inert={collapsed}>
          <nav className="ws-tabs" aria-label="任务准备阶段"><button aria-current={section === "task" ? "page" : undefined} onClick={() => changeSection("task")}><FileText size={15} />任务</button><button aria-current={section === "scene" ? "page" : undefined} onClick={() => changeSection("scene")}><Layers size={15} />场景</button><button disabled title="方案比较将在后续模块接入"><Route size={15} />方案</button></nav>
          {section === "scene" ? <ScenePanel input={sceneInput} state={environment} onChange={updateScene} onSelect={selectObstacle} onShowMap={() => { setCollapsed(true); requestAnimationFrame(() => document.querySelector<HTMLElement>(".ws-scene-canvas")?.focus()); }} storageError={storageError} /> : <>
          <div className="ws-panel-scroll">
            {storageError && <p className="ws-error" role="alert">{storageError}</p>}
            <section className="ws-section"><div className="ws-section-heading"><h2>任务内容</h2><button onClick={() => setEditing(!editing)} className="ws-text-button"><Pencil size={13} />{editing ? "完成编辑" : "编辑"}</button></div>
              {editing ? <><label className="ws-field-label" htmlFor="ws-task-input">任务描述与完成条件</label><textarea ref={taskInputRef} id="ws-task-input" className="ws-input ws-task-textarea" maxLength={16384} value={rawInput} onChange={e => update({ ...spatial, inputMode: "text" }, e.target.value)} /><p className="ws-muted">修改原文后需重新理解任务。</p></> : <p className="ws-task-description">{rawInput || "尚未填写任务描述。"}</p>}
              <div className="ws-input-modes" role="group" aria-label="任务理解方式"><button aria-pressed={spatial.inputMode === "text"} onClick={() => update({ ...spatial, inputMode: "text" })}>解析原文</button><button aria-pressed={spatial.inputMode === "fields"} onClick={() => update({ ...spatial, inputMode: "fields" })}>明确任务字段</button></div>
              {spatial.inputMode === "fields" ? <div className="ws-task-fields"><p className="ws-muted">仅以下动作、目标与完成条件参与解析；原文保留作备注。请逐项核对。</p><label className="ws-field-label">作业动作<select className="ws-input" value={spatial.action} onChange={e => update({ ...spatial, action: e.target.value as SpatialTaskDraft["action"] })}>{Object.entries(actionNames).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label><p className="ws-field-label">作业对象：{spatial.bound ? "示例建筑 A" : "待绑定"}</p><label className="ws-field-label">完成条件<textarea className="ws-input" maxLength={512} value={spatial.completion} onChange={e => update({ ...spatial, completion: e.target.value })} /></label>{spatial.completion.length > 512 && <p className="ws-error">完成条件超过 512 字，请精简后解析。</p>}</div>
                : <details className="ws-syntax"><summary>支持的描述方式</summary><p>例如：巡检对象[A]；完成条件：取得四面影像</p><p>用“然后”表示先后、“同时”表示并行。复杂描述可切换“明确任务字段”，多任务也可在原文中输入 JSON DSL。</p></details>}
            </section>
            <section className="ws-section"><div className="ws-section-heading"><h2>空间绑定</h2><span className={spatial.bound ? "ws-cyan" : "ws-amber"}>{!spatial.bound ? "待补充" : !spatial.points.length ? "待设观察点" : !spatial.start ? "待设起止点" : "已设置 · 示意"}</span></div>
              {!spatial.bound && <><p>先选定作业目标</p><p className="ws-muted">选择地图中的建筑，查看对象详情并绑定到当前任务。</p><button className="ws-primary ws-full" onClick={() => select("object")}><MapPin size={15} />在地图中选择目标</button></>}
              <button className="ws-binding-row" onClick={() => select("object")}><Building2 size={15} /><span>作业目标</span><strong>{spatial.bound ? "示例建筑 A" : "未绑定"}</strong><ChevronRight size={14} /></button>
              {spatial.bound ? <><div className="ws-section-heading ws-point-heading"><h3>观察点 <small>{spatial.points.length} / 16</small></h3><button className="ws-text-button" disabled={spatial.points.length >= 16} onClick={() => editMode("observation")}><Plus size={13} />添加</button></div>
                {!spatial.points.length && <p className="ws-muted">在地图上点选需要停留观察的位置。</p>}
                <div className="ws-point-list" aria-label="观察点列表">{spatial.points.map(p => <button key={p.id} className={`ws-point-row ${selected === p.id ? "is-selected" : ""}`} onClick={() => select(p.id)}><span className="ws-point-index">{String(p.number).padStart(2, "0")}</span><span>观察点 {String(p.number).padStart(2, "0")}</span><small>{p.z} m</small><ChevronRight size={13} /></button>)}</div>
                <div className="ws-section-heading ws-point-heading"><h3>起点 / 返回点</h3><small>同点返回</small></div>
                {spatial.start && <button className="ws-point-row ws-start-row" onClick={() => select("start")}><span className="ws-point-index">S</span><span>起点 / 返回点</span><small>{spatial.start.z} m</small><ChevronRight size={13} /></button>}
                <button className="ws-button ws-full" onClick={() => editMode("start")}><MapPin size={14} />{spatial.start ? "重新设置位置" : "在地图上设置"}</button>
                <p className="ws-muted">点位为影像上的示意标记，高度由你声明，不代表视角、覆盖或坐标配准已验证。</p></> : <p className="ws-muted">绑定目标后，继续设置观察点与起止位置。</p>}
            </section>
            <section className="ws-section"><div className="ws-section-heading"><h2>任务理解</h2><span className={task.status === "error" ? "ws-amber" : "ws-cyan"}>{status}</span></div>
              <button className="ws-button ws-full" onClick={() => select("tree")}><GitBranch size={15} />查看任务结构<ChevronRight size={14} /></button>
              {task.data?.task_tree.clarifications.length ? <p className="ws-amber">{task.data.task_tree.clarifications.length} 项信息需补充，打开任务结构查看。</p> : null}
              {task.status === "error" && <p className="ws-error" role="alert">{task.error}。检查输入或服务连接后，可点击下方按钮重试。</p>}
              <p className="ws-muted">解析结果来自 F01 服务，任务字段齐备不代表空间规划已就绪。</p>
            </section>
            <section className="ws-section"><div className="ws-section-heading"><h2>场景准备</h2><span className="ws-muted">{sceneStatusNames[environment.status]}</span></div><p className="ws-muted">{environment.result ? `${environment.result.obstacles.length} 个障碍 · 坐标尚未与影像关联。` : "参考影像与点云尚未关联，需在场景页选择数据并检测。"}</p><button className="ws-button ws-full" onClick={() => changeSection("scene")}><Layers size={14} />进入场景检测</button><button className="ws-text-button" onClick={() => { setSelected(null); setMode(null); setReference(true); }}>打开独立场景参考工具<ArrowRight size={13} /></button></section>
          </div>
          <footer className="ws-task-footer"><p role="status">{task.status === "loading" ? "正在理解任务，请稍候…" : spatial.inputMode === "fields" ? "核对明确字段后生成任务结构。" : "保留原文，无法完整理解时会提示澄清。"}</p><button className="ws-primary ws-full" disabled={task.status === "loading" || (spatial.inputMode === "text" ? !rawInput.trim() : spatial.completion.length > 512)} onClick={() => void parse()}>{task.status === "loading" ? <LoaderCircle className="ws-spinner" size={16} /> : <GitBranch size={16} />}{task.status === "error" ? "重试理解任务" : "理解任务"}</button></footer>
          </>}
          <WorkspaceResizer label="调整任务面板宽度" controls="ws-task-panel" minimum={300} maximum={Math.max(300, Math.min(560, viewport * .45))} value={leftWidth} defaultValue={356} direction={1} onChange={setPanelWidth} />
        </aside>
        <div className="ws-map-stage" inert={narrow && !collapsed}>
          <div className="ws-reference-map" hidden={section !== "task"}><ReferenceImageMap spatial={spatial} selected={selected} mode={mode} onSelect={select} onFinish={() => setMode(null)}
            onPlace={(kind, x, y) => { const next = addMapPoint(spatial, kind, x, y); update(next); if (kind === "start" || next.points.length >= 16) setMode(null); }}
            onMove={(id, patch) => update(moveMapPoint(spatial, id, patch))} /></div>
          {section === "scene" && <SceneMap state={environment} onSelect={selectObstacle} detailOpen={showInspector} />}
          {showInspector && <aside className="ws-inspector" id="ws-inspector" aria-label="对象与任务详情" onKeyDown={e => { if (e.key === "Escape") { e.stopPropagation(); closeDetails(); } }}>
            <div className="ws-inspector-heading"><h2 tabIndex={-1} ref={inspectorHeading}>{section === "scene" ? obstacle?.id : selected === "tree" ? "任务结构" : selected === "object" ? "示例建筑 A" : point?.id === "start" ? "起点 / 返回点" : `观察点 ${String(point?.number ?? "").padStart(2, "0")}`}</h2><button className="ws-icon" aria-label="关闭详情" onClick={closeDetails}><X size={17} /></button></div>
            {section === "scene" && obstacle && environment.result ? <ObstacleDetails obstacle={obstacle} result={environment.result} /> : selected === "tree" ? <>{task.status === "loading" && <p className="ws-loading" role="status"><LoaderCircle size={16} className="ws-spinner" />正在解析…</p>}{task.status === "error" && <p className="ws-error" role="alert">{task.error}</p>}<TaskTreeViewer workspace={workspace} bound={spatial.bound} /></>
              : selected === "object" ? <><p className="ws-muted">场景对象 · 人工标注示例</p><dl className="ws-object-fields"><div><dt>对象类型</dt><dd>建筑</dd></div><div><dt>对象引用</dt><dd>A</dd></div><div><dt>任务关联</dt><dd>{spatial.bound ? "当前任务" : "尚未绑定"}</dd></div><div><dt>观察点</dt><dd>{spatial.points.length} 个示意点</dd></div></dl><p className="ws-inspector-note">确认作业对象后，再设置需要访问的观察位置。此处绑定的是人工标注对象，不是影像自动识别结果。</p><button className="ws-primary ws-full" disabled={spatial.bound} onClick={() => { update({ ...spatial, bound: true }); setSelected(null); setCollapsed(false); setNotice("已绑定示例建筑 A，可继续添加观察点。"); }}>{spatial.bound ? "已绑定到当前任务" : "绑定为作业目标"}<ArrowRight size={14} /></button></>
                : point && <><p className="ws-muted">示意点位 · 未与真实场景配准</p><dl className="ws-object-fields"><div><dt>影像位置 X / Y</dt><dd>{point.x} / {point.y} px</dd></div><div><dt>关联目标</dt><dd>示例建筑 A</dd></div></dl><form onSubmit={e => {
                  e.preventDefault(); const value = Number(height);
                  if (!height.trim() || !Number.isFinite(value) || value < -10000 || value > 10000) { setHeightError("请输入 -10000 至 10000 之间的有效高度。"); return; }
                  update(moveMapPoint(spatial, point.id, { z: value })); setHeightError(""); setNotice("已保存示意高度。");
                }}><label className="ws-field-label" htmlFor="ws-point-height">示意高度（m）</label><input id="ws-point-height" className="ws-input" type="number" step="any" value={height} onChange={e => { setHeight(e.target.value); setHeightError(""); }} aria-describedby="ws-height-note ws-height-error" aria-invalid={Boolean(heightError)} /><p id="ws-height-note" className="ws-muted">高度相对待关联的场景原点，不是海拔。拖动地图点位或用方向键微调平面位置。</p><p id="ws-height-error" className="ws-error" role="status" hidden={!heightError}>{heightError}</p><button className="ws-primary ws-full" type="submit">保存高度</button></form><button className="ws-delete" onClick={() => {
                  const next = point.id === "start" ? { ...spatial, start: null } : { ...spatial, points: spatial.points.filter(p => p.id !== point.id) };
                  update(next); setSelected(null); setNotice(point.id === "start" ? "已移除起点 / 返回点。" : "已移除观察点。");
                  heading.current?.focus({ preventScroll: true });
                }}><Trash2 size={14} />{point.id === "start" ? "移除起点 / 返回点" : "移除观察点"}</button></>}
            <WorkspaceResizer label="调整对象详情宽度" controls="ws-inspector" minimum={270} maximum={Math.max(270, Math.min(420, viewport - 160))} value={rightWidth} defaultValue={300} direction={-1} onChange={setDetailWidth} />
          </aside>}
          {notice && <p className="ws-notice" role="status">{notice}<button aria-label="关闭提示" onClick={() => setNotice("")}><X size={14} /></button></p>}
        </div>
        <footer className="ws-statusbar"><span>{section === "scene" ? "局部坐标 · 米 · 尚未与影像关联" : "参考影像 · 点位未配准 · 本机草稿"}</span><a hidden={section === "scene"} href="https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9" target="_blank" rel="noreferrer">影像 © Esri, Vantor, Earthstar Geographics, GIS User Community</a></footer>
      </div>}
  </div>;
}
