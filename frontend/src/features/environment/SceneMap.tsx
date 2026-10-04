import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Focus, Layers, Minus, Plus } from "lucide-react";
import type { EnvironmentState } from "./environmentStore";
import { obstacleBounds, sceneBounds, type ObstacleBounds, type SceneProjection } from "./obstacleGeometry";
import { sceneNumber, sceneSourceNames } from "./sceneInput";

const leafletBounds = (b: ObstacleBounds): L.LatLngBoundsExpression => [[b.minimum[1], b.minimum[0]], [b.maximum[1], b.maximum[0]]];
function tooltip(text: string): HTMLSpanElement {
  const span = document.createElement("span"); span.textContent = text; return span;
}

export function SceneMap({ state, onSelect, detailOpen }: { state: EnvironmentState; onSelect: (id: string) => void; detailOpen: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const select = useRef(onSelect); select.current = onSelect;
  const [vertical, setVertical] = useState<SceneProjection>(1);
  const [showObstacles, setShowObstacles] = useState(true);
  const result = state.result;
  const obstacles = result?.obstacles ?? [];
  const bounds = sceneBounds(obstacles, vertical);
  const valid = Boolean(bounds);
  const selected = obstacles.find(o => o.id === state.selectedObstacleId);
  const [scale, setScale] = useState("");
  const fittedBounds = useRef<ObstacleBounds | null>(null);

  useEffect(() => {
    if (!container.current) return;
    const instance = L.map(container.current, { crs: L.CRS.Simple, minZoom: -24, maxZoom: 12, zoomSnap: 0.1, zoomDelta: 0.75, attributionControl: false, zoomControl: false, scrollWheelZoom: true, zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false });
    map.current = instance;
    const grid = L.layerGroup().addTo(instance);
    const drawGrid = () => {
      grid.clearLayers();
      const b = instance.getBounds(), width = b.getEast() - b.getWest();
      if (!Number.isFinite(width) || width <= 0) return;
      const unit = 10 ** Math.floor(Math.log10(width / 6));
      const step = [1, 2, 5, 10].map(n => n * unit).find(n => n >= width / 6) ?? unit * 10;
      setScale(`${sceneNumber(step)} m / 格`);
      const line = { color: "#405564", weight: 1, opacity: 0.65, interactive: false, pane: "tilePane" };
      for (let x = Math.ceil(b.getWest() / step) * step, n = 0; x <= b.getEast() && n < 30; x += step, n++) {
        L.polyline([[b.getSouth(), x], [b.getNorth(), x]], line).addTo(grid);
        const label = document.createElement("span"); label.textContent = sceneNumber(x);
        L.marker([b.getSouth() + (b.getNorth() - b.getSouth()) * 0.13, x], { interactive: false, keyboard: false, pane: "tilePane", icon: L.divIcon({ className: "ws-scene-axis-label", html: label, iconSize: [60, 18], iconAnchor: [0, 0] }) }).addTo(grid);
      }
      for (let y = Math.ceil(b.getSouth() / step) * step, n = 0; y <= b.getNorth() && n < 30; y += step, n++) {
        L.polyline([[y, b.getWest()], [y, b.getEast()]], line).addTo(grid);
        const label = document.createElement("span"); label.textContent = sceneNumber(y);
        L.marker([y, b.getWest() + width * 0.025], { interactive: false, keyboard: false, pane: "tilePane", icon: L.divIcon({ className: "ws-scene-axis-label", html: label, iconSize: [60, 18], iconAnchor: [0, 0] }) }).addTo(grid);
      }
    };
    instance.on("moveend zoomend", drawGrid);
    instance.fitBounds([[-10, -10], [10, 10]], { animate: false });
    const observer = new ResizeObserver(() => {
      instance.invalidateSize({ animate: false, pan: false });
      if (fittedBounds.current && container.current?.clientWidth && container.current.clientHeight) {
        instance.fitBounds(leafletBounds(fittedBounds.current), { padding: [55, 65], animate: false });
      }
    });
    observer.observe(container.current);
    return () => { observer.disconnect(); instance.remove(); map.current = null; };
  }, []);

  useEffect(() => {
    const next = sceneBounds(result?.obstacles ?? [], vertical);
    fittedBounds.current = next;
    if (next) map.current?.fitBounds(leafletBounds(next), { padding: [55, 65], animate: false });
  }, [result, vertical]);
  useEffect(() => {
    if (state.selectedObstacleId) {
      setShowObstacles(true);
      const o = result?.obstacles.find(item => item.id === state.selectedObstacleId);
      if (o && valid) map.current?.panInside([o.position[vertical], o.position[0]], { padding: [55, 65], animate: false });
    }
  }, [state.selectedObstacleId, result, vertical, valid]);
  useEffect(() => {
    const instance = map.current;
    if (!instance || !valid || !showObstacles) return;
    const group = L.layerGroup().addTo(instance);
    for (const o of result?.obstacles ?? []) {
      const box = obstacleBounds(o, vertical);
      if (!box) continue;
      const active = o.id === state.selectedObstacleId;
      const color = active ? "#f4d396" : "#c9a773";
      const boxLayer = L.rectangle(leafletBounds(box), { color, weight: active ? 2.5 : 1.5, fillColor: "#c4a267", fillOpacity: active ? 0.28 : 0.12, dashArray: active ? undefined : "6 5" }).addTo(group);
      boxLayer.on("click", () => select.current(o.id));
      boxLayer.bindTooltip(tooltip(`${o.id} · ${o.position.map(sceneNumber).join(" / ")} m`), { className: "ws-scene-tooltip" });
      const el = document.createElement("button");
      el.type = "button"; el.className = `ws-scene-marker ${active ? "is-selected" : ""}`;
      el.dataset.sceneObstacle = o.id; el.textContent = String((result?.obstacles.indexOf(o) ?? 0) + 1).padStart(2, "0");
      el.setAttribute("aria-label", `查看障碍 ${o.id}`); el.setAttribute("aria-pressed", String(active));
      L.DomEvent.disableClickPropagation(el); el.addEventListener("click", () => select.current(o.id));
      L.marker([o.position[vertical], o.position[0]], { keyboard: false, icon: L.divIcon({ className: "ws-scene-marker-host", html: el, iconSize: [32, 32], iconAnchor: [16, 16] }) }).addTo(group);
    }
    return () => { group.remove(); };
  }, [result, state.selectedObstacleId, vertical, valid, showObstacles]);

  function fit(all: boolean) {
    const next = sceneBounds(!all && selected ? [selected] : obstacles, vertical);
    fittedBounds.current = next;
    map.current?.stop();
    if (next) { setShowObstacles(true); map.current?.fitBounds(leafletBounds(next), { padding: [55, 65], animate: false }); }
  }
  return <div className={`ws-scene-map ${detailOpen ? "has-detail" : ""}`}>
    <div ref={container} className="ws-scene-canvas" aria-label={`局部坐标图，X${vertical === 1 ? "Y" : "Z"} 投影，单位米；方向键平移，加减键缩放`} />
    <div className="ws-scene-map-heading"><label htmlFor="scene-projection">局部坐标 / m</label><select id="scene-projection" className="ws-input" value={vertical} onChange={e => setVertical(Number(e.target.value) as SceneProjection)}><option value={1}>俯视 XY</option><option value={2}>侧视 XZ</option></select><span>{result ? sceneSourceNames[result.source] : "等待检测"}</span></div>
    <div className="ws-scene-map-tools"><button className="ws-icon" aria-label="放大场景" onClick={() => map.current?.zoomIn()}><Plus size={17} /></button><button className="ws-icon" aria-label="缩小场景" onClick={() => map.current?.zoomOut()}><Minus size={17} /></button><button className="ws-icon" aria-label="显示全部障碍" onClick={() => fit(true)}><Focus size={17} /></button><button className="ws-icon" aria-label="显示障碍图层" aria-pressed={showObstacles} onClick={() => setShowObstacles(!showObstacles)}><Layers size={17} /></button></div>
    {selected && valid && <button className="ws-button ws-scene-locate" onClick={() => fit(false)}><Focus size={15} />定位选中障碍</button>}
    {(!result || !obstacles.length || !valid) && <div className="ws-scene-map-empty" role="status"><strong>{!valid ? "坐标超出可视范围" : state.status === "loading" ? "正在检测场景" : state.status === "error" ? "检测未完成" : result ? "本次未检出障碍" : "等待场景数据"}</strong><p>{!valid ? "当前视图无法可靠表示该坐标范围，请在列表查看原始数值。" : result ? "没有保留的点簇；这不代表空间已确认安全。" : "从左侧选择点云并运行检测，结果将在此展示。"}</p></div>}
    <div className="ws-scene-map-caption"><span>X → · {vertical === 1 ? "Y" : "Z"} ↑</span><span>{scale}</span><span>轮廓为实际包围盒 · 编号标记为可选中心</span></div>
  </div>;
}
