import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import { Focus, Layers, Minus, Plus, Search } from "lucide-react";
import imageUrl from "../../public/scenarios/workspace-map.jpg";
import type { MapPoint, SpatialTaskDraft } from "./spatialTaskDraft";

export type MapMode = "observation" | "start" | null;
export type MapSelection = "object" | "tree" | string | null;
type Camera = { x: number; y: number; size: number };
const initialCamera: Camera = { x: 0, y: 0, size: 1280 };

export function ReferenceImageMap({ spatial, selected, mode, onSelect, onPlace, onMove, onFinish }: {
  spatial: SpatialTaskDraft; selected: MapSelection; mode: MapMode;
  onSelect: (id: string | null) => void;
  onPlace: (kind: Exclude<MapMode, null>, x: number, y: number) => void;
  onMove: (id: string, change: Partial<Pick<MapPoint, "x" | "y">>) => void;
  onFinish: () => void;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const [camera, setCamera] = useState(initialCamera);
  const [layers, setLayers] = useState({ image: true, object: true, points: true });
  const [imageStatus, setImageStatus] = useState<"loading" | "ready" | "error">("loading");
  const [imageAttempt, setImageAttempt] = useState(0);
  const [layerMenu, setLayerMenu] = useState(false);
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState("");
  const [dragPoint, setDragPoint] = useState<MapPoint | null>(null);
  const gesture = useRef<{ pointer: number; cx: number; cy: number; originX: number; originY: number; camera: Camera; point: MapPoint | null; moved: boolean; scale: number } | null>(null);
  const mapPoint = (clientX: number, clientY: number) => {
    const matrix = svg.current?.getScreenCTM();
    return matrix ? new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse()) : new DOMPoint(640, 640);
  };
  const clamp = (v: number) => Math.round(Math.min(1280, Math.max(0, v)) * 10) / 10;
  const zoom = (factor: number) => setCamera(old => {
    const size = Math.min(2560, Math.max(180, old.size * factor));
    return { x: old.x + (old.size - size) / 2, y: old.y + (old.size - size) / 2, size };
  });
  useEffect(() => {
    const node = svg.current;
    if (!node) return;
    const wheel = (event: WheelEvent) => { event.preventDefault(); zoom(event.deltaY > 0 ? 1.15 : 1 / 1.15); };
    node.addEventListener("wheel", wheel, { passive: false });
    return () => node.removeEventListener("wheel", wheel);
  }, []);
  useEffect(() => {
    if (mode) { setLayers(l => ({ ...l, points: true })); svg.current?.focus({ preventScroll: true }); }
  }, [mode]);

  function retryImage() {
    setImageStatus("loading");
    setImageAttempt(attempt => attempt + 1);
  }

  function place(x: number, y: number) {
    if (!mode) return;
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1280 || y < 0 || y > 1280) {
      setNotice("请在参考影像范围内放置点位。");
      return;
    }
    onPlace(mode, clamp(x), clamp(y));
    setNotice("");
  }

  function begin(e: PointerEvent<SVGSVGElement>) {
    if (e.button !== 0) return;
    const target = e.target as Element;
    if (target.closest('[data-object]') && !mode) return;
    const id = target.closest('[data-point]')?.getAttribute('data-point');
    const point = id === "start" ? spatial.start : spatial.points.find(p => p.id === id) ?? null;
    const origin = mapPoint(e.clientX, e.clientY);
    gesture.current = { pointer: e.pointerId, cx: e.clientX, cy: e.clientY, originX: origin.x, originY: origin.y, camera, point, moved: false, scale: svg.current?.getScreenCTM()?.a ?? 1 };
    if (point) onSelect(point.id);
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  }
  function move(e: PointerEvent<SVGSVGElement>) {
    const g = gesture.current;
    if (!g || g.pointer !== e.pointerId) return;
    if (Math.hypot(e.clientX - g.cx, e.clientY - g.cy) > 3) g.moved = true;
    if (!g.moved) return;
    const dx = (e.clientX - g.cx) / g.scale, dy = (e.clientY - g.cy) / g.scale;
    if (g.point) setDragPoint({ ...g.point, x: clamp(g.point.x + dx), y: clamp(g.point.y + dy) });
    else setCamera({ ...g.camera, x: Math.min(1280, Math.max(-g.camera.size, g.camera.x - dx)), y: Math.min(1280, Math.max(-g.camera.size, g.camera.y - dy)) });
  }
  function finish(e: PointerEvent<SVGSVGElement>, cancelled = false) {
    const g = gesture.current;
    if (!g || g.pointer !== e.pointerId) return;
    if (!cancelled) {
      if (g.point && g.moved) onMove(g.point.id, { x: clamp(g.point.x + (e.clientX - g.cx) / g.scale), y: clamp(g.point.y + (e.clientY - g.cy) / g.scale) });
      else if (!g.point && !g.moved && mode) {
        place(g.originX, g.originY);
      }
    }
    gesture.current = null; setDragPoint(null);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  }
  function pointKey(e: KeyboardEvent<SVGGElement>, p: MapPoint) {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); onSelect(p.id); return; }
    const step = e.shiftKey ? 10 : 1;
    const offsets: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (!(e.key in offsets)) return;
    e.preventDefault(); e.stopPropagation(); const [x, y] = offsets[e.key];
    onMove(p.id, { x: clamp(p.x + x), y: clamp(p.y + y) });
  }
  return <>
    <svg ref={svg} className="ws-map-canvas" data-testid="reference-map" viewBox={`${camera.x} ${camera.y} ${camera.size} ${camera.size}`} preserveAspectRatio="xMidYMid slice" tabIndex={0}
      role="group" aria-label="参考影像地图，可拖动平移；加减键缩放，编辑时 Enter 在视图中心放点" onPointerDown={begin} onPointerMove={move}
      onPointerUp={e => finish(e)} onPointerCancel={e => finish(e, true)} onLostPointerCapture={() => { gesture.current = null; setDragPoint(null); }}
      onKeyDown={e => {
        if (e.key === "Escape") { onFinish(); return; }
        if (e.target !== e.currentTarget) return;
        if ((e.key === "Enter" || e.key === " ") && mode) { e.preventDefault(); place(camera.x + camera.size / 2, camera.y + camera.size / 2); }
        if (e.key === "+" || e.key === "=") { e.preventDefault(); zoom(1 / 1.25); }
        if (e.key === "-") { e.preventDefault(); zoom(1.25); }
        const offsets: Record<string, [number, number]> = { ArrowLeft: [-40, 0], ArrowRight: [40, 0], ArrowUp: [0, -40], ArrowDown: [0, 40] };
        if (e.key in offsets) { e.preventDefault(); const [x, y] = offsets[e.key]; setCamera(c => ({ ...c, x: Math.min(1280, Math.max(-c.size, c.x + x)), y: Math.min(1280, Math.max(-c.size, c.y + y)) })); }
      }}>
      {layers.image && <image key={imageAttempt} className="ws-imagery" data-load-state={imageStatus}
        href={imageAttempt ? `${imageUrl}?retry=${imageAttempt}` : imageUrl} x="0" y="0" width="1280" height="1280"
        onLoad={() => setImageStatus("ready")} onError={() => setImageStatus("error")} />}
      {layers.object && <g data-object role="button" tabIndex={0} aria-label="查看示例建筑 A 详情" className={`ws-map-object ${spatial.bound ? "is-bound" : ""}`}
        onClick={() => { if (!mode) onSelect("object"); }} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); e.preventDefault(); onSelect("object"); } }}>
        <polygon points="681,636 927,678 877,891 625,852" /><circle cx="681" cy="636" r="20" /><text x="681" y="636" className="ws-object-letter">A</text>
        <g transform="translate(690 770)"><rect className="ws-object-label" width="211" height="60" rx="5" /><text x="15" y="25" className="ws-object-title">示例建筑 A</text><text x="15" y="47" className="ws-object-caption">{spatial.bound ? `已绑定 · ${spatial.points.length} 个示意点` : "人工标注 · 尚未绑定"}</text></g>
      </g>}
      {layers.points && [...spatial.points, ...(spatial.start ? [spatial.start] : [])].map(original => {
        const p = dragPoint?.id === original.id ? dragPoint : original;
        const isStart = p.id === "start";
        return <g key={p.id} data-point={p.id} className={`ws-map-point ${selected === p.id ? "is-selected" : ""} ${isStart ? "is-start" : ""}`} transform={`translate(${p.x} ${p.y})`} role="button" tabIndex={0}
          aria-label={`${isStart ? "起点与返回点" : `观察点 ${p.number}`}，示意高度 ${p.z} 米；方向键微调位置`} onKeyDown={e => pointKey(e, p)}>
          <circle className="ws-point-hit" r="27" /><circle className="ws-point-ring" r="24" />
          {isStart ? <rect className="ws-point-body" x="-15" y="-15" width="30" height="30" rx="3" transform="rotate(45)" /> : <circle className="ws-point-body" r="18" />}
          <text className="ws-point-number" y="1">{isStart ? "S" : String(p.number).padStart(2, "0")}</text>
          <rect className="ws-height-bg" x="27" y="-13" width={Math.max(57, String(p.z).length * 9 + 27)} height="26" rx="4" /><text className="ws-point-height" x="35" y="1">{p.z} m</text>
        </g>;
      })}
    </svg>
    <div className="ws-map-toolbar"><form className="ws-map-search" onSubmit={e => {
      e.preventDefault();
      if (!search.trim()) return;
      if (/^(?:a|示例建筑\s*a|建筑)$/i.test(search.trim())) { setLayers(l => ({ ...l, object: true })); setCamera(initialCamera); onSelect("object"); setNotice(""); }
      else setNotice("当前参考影像只标注了“示例建筑 A”，可输入 A 查找。");
    }}><Search size={15} /><input aria-label="查找场景对象" placeholder="查找场景对象…" value={search} onChange={e => setSearch(e.target.value)} /><button type="submit" aria-label="查找对象"><Search size={14} /></button></form><span className="ws-map-tag">{!layers.image ? "影像已隐藏" : imageStatus === "error" ? "影像不可用" : imageStatus === "loading" ? "影像加载中" : "参考底图"} · 未配准</span></div>
    <div className="ws-map-tools"><button aria-label="地图图层" aria-expanded={layerMenu} onClick={() => setLayerMenu(!layerMenu)}><Layers size={18} /></button><div><button aria-label="放大地图" onClick={() => zoom(1 / 1.25)}><Plus size={18} /></button><button aria-label="缩小地图" onClick={() => zoom(1.25)}><Minus size={18} /></button><button aria-label="恢复初始视图" onClick={() => setCamera(initialCamera)}><Focus size={18} /></button></div></div>
    {layerMenu && <fieldset className="ws-layers"><legend>地图图层</legend>{([["image", "参考影像"], ["object", "示例作业对象"], ["points", "观察点与起止点"]] as const).map(([key, label]) => <label key={key}><input type="checkbox" checked={layers[key]} onChange={e => {
      if (key === "image" && e.target.checked) retryImage();
      setLayers({ ...layers, [key]: e.target.checked });
    }} />{label}</label>)}</fieldset>}
    {layers.image && imageStatus !== "ready" && <div className="ws-map-image-status" role={imageStatus === "error" ? "alert" : "status"}>
      {imageStatus === "error" ? <><strong>参考影像加载失败</strong><p>当前仅显示人工标记，不可依赖影像定位。</p><button className="ws-text-button" aria-label="重试加载参考影像" onClick={retryImage}>重试加载</button></> : <p>正在加载参考影像…</p>}
    </div>}
    {mode ? <div className="ws-map-edit" role="status"><div><strong>{mode === "observation" ? "添加观察点" : "设置起点 / 返回点"}</strong><p>点击地图放置；Enter 在视图中心放置</p></div><button onClick={onFinish}>完成</button></div>
      : !spatial.bound && (!layers.image || imageStatus === "ready") && <p className="ws-map-tip">点击示例建筑，查看详情并绑定作业目标</p>}
    {notice && <p className="ws-map-notice" role="status">{notice}<button aria-label="关闭地图提示" onClick={() => setNotice("")}>关闭</button></p>}
    <div className="ws-map-legend"><span><i className="ws-legend-object" />示例作业对象</span><span><i className="ws-legend-point" />观察点</span><span><i className="ws-legend-start" />起点 / 返回点</span><span className="ws-map-instructions">拖动浏览 · 滚轮缩放</span></div>
  </>;
}
