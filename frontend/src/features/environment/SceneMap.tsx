import { useEffect, useRef, useState, type ReactNode } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Focus, Layers, Minus, Plus } from "lucide-react";
import type { Candidate, PlanningGeometry } from "../../api/candidates";
import type { Obstacle, ObstacleDetectionResult } from "../../api/pointCloud";
import type { EnvironmentState } from "./environmentStore";
import { obstacleBounds, sceneBounds, type ObstacleBounds, type SceneProjection } from "./obstacleGeometry";
import imageUrl from "../../public/scenarios/workspace-map.jpg";
import { imageToMockLocal, mockCampus } from "./mockCampus";
import { sceneNumber, sceneSourceNames } from "./sceneInput";

const leafletBounds = (b: ObstacleBounds): L.LatLngBoundsExpression => [[b.minimum[1], b.minimum[0]], [b.maximum[1], b.maximum[0]]];
function obstacleType(obstacle: Obstacle): string {
  return obstacle.obstacle_type === "unknown" ? "未识别" : obstacle.obstacle_type;
}

function obstacleSummaryText(obstacle: Obstacle, result: ObstacleDetectionResult): string {
  const vector = (values: number[]) => values.map(sceneNumber).join(" / ");
  return `编号：${obstacle.id}；类型：${obstacleType(obstacle)}；中心 XYZ：${vector(obstacle.position)} m；尺寸 XYZ：${vector(obstacle.size)} m；数据来源：${sceneSourceNames[result.source]}；局部米制单位`;
}

function obstacleSummary(obstacle: Obstacle, result: ObstacleDetectionResult): HTMLDivElement {
  const root = document.createElement("div");
  root.className = "ws-obstacle-summary";
  const title = document.createElement("strong");
  title.textContent = `编号 ${obstacle.id}`;
  root.append(title);
  for (const [label, value] of [
    ["类型", obstacleType(obstacle)],
    ["中心 XYZ / m", obstacle.position.map(sceneNumber).join(" / ")],
    ["尺寸 XYZ / m", obstacle.size.map(sceneNumber).join(" / ")],
    ["数据来源", `${sceneSourceNames[result.source]} · 局部米制坐标`],
  ]) {
    const line = document.createElement("span");
    line.className = "ws-obstacle-summary-line";
    const key = document.createElement("b");
    key.textContent = `${label}：`;
    line.append(key, document.createTextNode(value));
    root.append(line);
  }
  return root;
}

export type ScenePlanView = {
  affectedTaskIds?: string[];
  affectedLabel?: string;
  comparisonColor?: string;
  showPrimary?: boolean;
  showComparison?: boolean;
  caption?: string;
  geometry: PlanningGeometry | null;
  primary: Candidate | undefined;
  comparison: Candidate | undefined;
  visitIndex: number | null;
  onVisit: (index: number) => void;
};
export function SceneMap({ state, onSelect, detailOpen, campus = false, planView, planToolbar }: { state: EnvironmentState; onSelect: (id: string) => void; detailOpen: boolean; campus?: boolean; planView?: ScenePlanView; planToolbar?: ReactNode }) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const select = useRef(onSelect); select.current = onSelect;
  const planVisit = useRef(planView?.onVisit); planVisit.current = planView?.onVisit;
  const [vertical, setVertical] = useState<SceneProjection>(1);
  const [showImage, setShowImage] = useState(true);
  const [imageFailed, setImageFailed] = useState(false);
  const imagery = campus && showImage && vertical === 1 && !imageFailed;
  const imageryRef = useRef(imagery); imageryRef.current = imagery;
  const [showObstacles, setShowObstacles] = useState(true);
  const result = state.result;
  const obstacles = result?.obstacles ?? [];
  const bounds = sceneBounds(obstacles, vertical);
  const valid = Boolean(bounds);
  const selected = obstacles.find(o => o.id === state.selectedObstacleId);
  const [scale, setScale] = useState("");
  const fittedBounds = useRef<ObstacleBounds | null>(null);
  const obstacleLayers = useRef(new Map<string, { box: L.Rectangle; marker: HTMLElement }>());

  // Camera padding keeps targets clear of the floating inspector and map controls.
  function cameraPadding(): L.FitBoundsOptions {
    const canvas = container.current;
    const inspector = canvas?.closest(".ws-map-stage")?.querySelector(".ws-inspector");
    const rect = canvas?.getBoundingClientRect();
    const panel = inspector?.getBoundingClientRect();
    const covered = window.innerWidth > 760 && rect && panel ? Math.max(0, rect.right - panel.left + 20) : 0;
    return { paddingTopLeft: [55, 145], paddingBottomRight: [Math.max(55, covered), 125], animate: false };
  }

  useEffect(() => {
    if (!container.current) return;
    const instance = L.map(container.current, { crs: L.CRS.Simple, minZoom: -24, maxZoom: 12, zoomSnap: 0.1, zoomDelta: 0.75, attributionControl: false, zoomControl: false, scrollWheelZoom: true, zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false });
    map.current = instance;
    const grid = L.layerGroup().addTo(instance);
    const drawGrid = () => {
      grid.clearLayers();
      if (imageryRef.current) { setScale("模拟比例 · 0.2 m/px"); return; }
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
        instance.fitBounds(leafletBounds(fittedBounds.current), cameraPadding());
      }
    });
    observer.observe(container.current);
    return () => { observer.disconnect(); instance.remove(); map.current = null; };
  }, []);

  useEffect(() => { setImageFailed(false); }, [campus]);
  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    instance.fire("moveend");
    if (!imagery) return;
    const corner = imageToMockLocal(mockCampus.image_size_px, 0);
    const overlay = L.imageOverlay(imageUrl, [[0, 0], [corner[1], corner[0]]], { className: "ws-scene-imagery", interactive: false, pane: "tilePane" }).addTo(instance);
    const failed = () => setImageFailed(true);
    overlay.on("error", failed);
    return () => { overlay.off("error", failed); overlay.remove(); };
  }, [imagery]);
  useEffect(() => {
    const instance = map.current;
    if (!instance || !campus) return;
    const group = L.layerGroup().addTo(instance);
    const projected = (p: number[]): L.LatLngTuple => {
      const local = imageToMockLocal(p[0], p[1], p[2] ?? 0);
      return [local[vertical], local[0]];
    };
    const targetLabel = document.createElement("span");
    const targetShort = document.createElement("span"); targetShort.className = "ws-demo-short"; targetShort.textContent = "A";
    const targetLong = document.createElement("span"); targetLong.className = "ws-demo-long"; targetLong.textContent = "A · 演示作业对象";
    targetLabel.append(targetShort, targetLong);
    if (vertical === 1) L.polygon(mockCampus.target_image_polygon_px.map(projected), { color: "#91dce6", weight: 2, fillOpacity: .09, interactive: false }).addTo(group)
      .bindTooltip(targetLabel, { permanent: true, direction: "center", className: "ws-scene-target-label" });
    if (!planView) [...mockCampus.observation_points_px, mockCampus.start_px].forEach((p, i) => {
      const start = i === mockCampus.observation_points_px.length;
      const el = document.createElement("span");
      const short = document.createElement("span"); short.className = "ws-demo-short"; short.textContent = start ? "S" : `P${i + 1}`;
      const long = document.createElement("span"); long.className = "ws-demo-long"; long.textContent = start ? "S · 演示起降点" : `P${i + 1} · ${p[2]} m`;
      el.append(short, long);
      el.className = `ws-scene-demo-point ${start ? "is-start" : ""}`;
      L.marker(projected(p), { keyboard: false, interactive: false, icon: L.divIcon({ className: "ws-scene-demo-host", html: el, iconSize: [110, 25], iconAnchor: [12, 12] }) }).addTo(group);
    });
    return () => { group.remove(); };
  }, [campus, vertical, Boolean(planView)]);

  function planBounds(): ObstacleBounds | null {
    if (!planView?.geometry) return null;
    const points = [planView.geometry.start, ...planView.geometry.targets.flatMap(t => t.observation_points), ...(planView.primary?.path?.points ?? []), ...(planView.comparison?.path?.points ?? [])];
    const xs = points.map(p => p[0]), ys = points.map(p => p[vertical]);
    return { minimum: [Math.min(...xs) - 12, Math.min(...ys) - 12], maximum: [Math.max(...xs) + 12, Math.max(...ys) + 12] };
  }
  useEffect(() => {
    const instance = map.current;
    if (!instance || !planView) return;
    const group = L.layerGroup().addTo(instance);
    const project = (p: number[]): L.LatLngTuple => [p[vertical], p[0]];
    for (const [candidate, kind] of [[planView.comparison, "comparison"], [planView.primary, "primary"]] as const) {
      if (!candidate?.path || (kind === "primary" ? planView.showPrimary === false : planView.showComparison === false)) continue;
      if (kind === "primary") L.polyline(candidate.path.points.map(project), { color: "#112e3b", weight: 7, opacity: .9, interactive: false }).addTo(group);
      const route = L.polyline(candidate.path.points.map(project), { color: kind === "primary" ? "#8edce6" : planView.comparisonColor ?? "#dbb97f", weight: 3, dashArray: kind === "primary" ? undefined : "8 7", interactive: false }).addTo(group);
      route.getElement()?.setAttribute("data-route", kind);
      if (kind === "primary") candidate.path.points.slice(1).forEach((point, index) => {
        const previous = candidate.path!.points[index];
        const dx = point[0] - previous[0], dy = point[vertical] - previous[vertical];
        if (Math.hypot(dx, dy) < 15) return;
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("viewBox", "-10 -10 20 20");
        const arrow = document.createElementNS(svg.namespaceURI, "path");
        arrow.setAttribute("d", "M-6 -5 6 0 -6 5 -3 0Z");
        arrow.setAttribute("transform", `rotate(${-Math.atan2(dy, dx) * 180 / Math.PI})`);
        svg.append(arrow);
        L.marker([previous[vertical] + dy * .6, previous[0] + dx * .6], { keyboard: false, interactive: false, zIndexOffset: -1000, icon: L.divIcon({ className: "ws-plan-route-arrow", html: svg.outerHTML, iconSize: [20, 20], iconAnchor: [10, 10] }) }).addTo(group);
      });
    }
    // Route visibility is independent from route styling: when the projected
    // route is hidden, the comparison route still needs its own visit markers
    // and keyboard semantics instead of becoming a bare line.
    const candidate = planView.showPrimary !== false
      ? planView.primary
      : planView.showComparison !== false
        ? planView.comparison
        : undefined;
    if (candidate?.path && planView.geometry) {
      const visits = [planView.geometry.start, ...candidate.visits.map(v => v.position), planView.geometry.start];
      const locations = new Map<string, { position: number[]; indices: number[] }>();
      visits.slice(0, -1).forEach((position, index) => {
        const key = `${position[0]},${position[vertical]}`;
        const existing = locations.get(key);
        if (existing) existing.indices.push(index);
        else locations.set(key, { position, indices: [index] });
      });
      for (const { position, indices } of locations.values()) {
        const index = indices[0];
        const el = document.createElement("button"); el.type = "button";
        el.className = "ws-plan-map-point";
        el.dataset.routeIndices = [...indices, ...(index === 0 ? [visits.length - 1] : [])].join(",");
        el.textContent = `${index === 0 ? "S" : index}${indices.length > 1 ? "+" : ""}`;
        const label = indices.map(i => i === 0 ? "起点 / 返回点" : `第 ${i} 次访问`).join("、");
        el.dataset.visitLabel = label;
        el.setAttribute("aria-label", `查看${label}`); el.setAttribute("aria-pressed", "false"); el.title = label;
        el.dataset.routeVisit = String(index);
        L.DomEvent.disableClickPropagation(el); el.addEventListener("click", () => planVisit.current?.(index));
        L.marker(project(position), { keyboard: false, icon: L.divIcon({ className: "ws-scene-marker-host", html: el, iconSize: [32, 32], iconAnchor: [16, 16] }) }).addTo(group);
      }
    }
    return () => { group.remove(); };
  }, [planView?.geometry, planView?.primary, planView?.comparison, planView?.showPrimary, planView?.showComparison, planView?.comparisonColor, vertical]);
  // Update risk rings without rebuilding markers or stealing keyboard focus.
  useEffect(() => {
    const affected = new Set(planView?.affectedTaskIds ?? []);
    const visibleCandidate = planView?.showPrimary !== false
      ? planView?.primary
      : planView?.showComparison !== false
        ? planView?.comparison
        : undefined;
    container.current?.querySelectorAll<HTMLElement>("[data-route-indices]").forEach(el => {
      const impacted = el.dataset.routeIndices?.split(",").some(i => {
        const visit = visibleCandidate?.visits[Number(i) - 1];
        return visit && affected.has(visit.task_id);
      });
      el.classList.toggle("is-risk-affected", Boolean(impacted));
      const label = `${el.dataset.visitLabel}${impacted ? ` · ${planView?.affectedLabel ?? "受事件影响"}` : ""}`;
      el.setAttribute("aria-label", `查看${label}`); el.title = label;
    });
  }, [planView?.affectedTaskIds, planView?.primary, planView?.comparison, planView?.geometry, planView?.showPrimary, planView?.showComparison, planView?.affectedLabel, vertical]);
  // Selection changes only marker styling: preserve the focused DOM node for keyboard users.
  useEffect(() => {
    const index = planView?.visitIndex;
    container.current?.querySelectorAll<HTMLElement>("[data-route-indices]").forEach(el => {
      const active = index !== null && index !== undefined && el.dataset.routeIndices?.split(",").includes(String(index));
      el.classList.toggle("is-selected", Boolean(active)); el.setAttribute("aria-pressed", String(Boolean(active)));
    });
    if (index === null || index === undefined || !planView?.geometry) return;
    const candidate = planView.showPrimary !== false
      ? planView.primary
      : planView.showComparison !== false
        ? planView.comparison
        : undefined;
    if (!candidate?.path) return;
    const positions = [planView.geometry.start, ...candidate.visits.map(v => v.position), planView.geometry.start];
    const point = positions[index];
    if (point) map.current?.panInside([point[vertical], point[0]], cameraPadding());
  }, [planView?.visitIndex, planView?.geometry, planView?.primary, planView?.comparison, planView?.showPrimary, planView?.showComparison, planView?.comparisonColor, vertical]);
  useEffect(() => {
    const next = planBounds() ?? (campus && vertical === 1 ? { minimum: [38, 30] as [number, number], maximum: [222, 174] as [number, number] } : sceneBounds(result?.obstacles ?? [], vertical));
    fittedBounds.current = next;
    if (next) map.current?.fitBounds(leafletBounds(next), cameraPadding());
  }, [result, vertical, campus, planView?.geometry, planView?.primary, planView?.comparison]);
  useEffect(() => {
    if (state.selectedObstacleId) {
      setShowObstacles(true);
      const o = result?.obstacles.find(item => item.id === state.selectedObstacleId);
      if (o && valid) map.current?.panInside([o.position[vertical], o.position[0]], cameraPadding());
    }
  }, [state.selectedObstacleId, result, vertical, valid, detailOpen]);
  useEffect(() => {
    const inspector = container.current?.closest(".ws-map-stage")?.querySelector(".ws-inspector");
    if (!inspector) return;
    const observer = new ResizeObserver(() => {
      if (fittedBounds.current) map.current?.fitBounds(leafletBounds(fittedBounds.current), cameraPadding());
    });
    observer.observe(inspector);
    return () => observer.disconnect();
  }, [detailOpen]);
  useEffect(() => {
    const instance = map.current;
    if (!instance || !valid || !showObstacles || !result) return;
    const group = L.layerGroup().addTo(instance);
    for (const [index, o] of result.obstacles.entries()) {
      const box = obstacleBounds(o, vertical);
      if (!box) continue;
      const boxLayer = L.rectangle(leafletBounds(box), { color: "#c9a773", weight: 1.5, fillColor: "#c4a267", fillOpacity: 0.12, dashArray: "6 5" }).addTo(group);
      boxLayer.getElement()?.setAttribute("data-scene-box", o.id);
      if (!planView) boxLayer.on("click", () => select.current(o.id));
      const summary = obstacleSummaryText(o, result);
      boxLayer.bindTooltip(obstacleSummary(o, result), { className: "ws-scene-tooltip" });
      const el = document.createElement(planView ? "span" : "button");
      if (el instanceof HTMLButtonElement) el.type = "button";
      el.className = "ws-scene-marker";
      el.dataset.sceneObstacle = o.id; el.textContent = String(index + 1).padStart(2, "0");
      el.setAttribute("aria-label", summary); el.title = summary;
      if (!planView) el.setAttribute("aria-pressed", "false");
      if (!planView) { L.DomEvent.disableClickPropagation(el); el.addEventListener("click", () => select.current(o.id)); }
      const marker = L.marker([o.position[vertical], o.position[0]], { keyboard: false, icon: L.divIcon({ className: "ws-scene-marker-host", html: el, iconSize: [32, 32], iconAnchor: [16, 16] }) }).addTo(group);
      marker.bindTooltip(obstacleSummary(o, result), { className: "ws-scene-tooltip" });
      if (!planView) {
        el.addEventListener("focus", () => marker.openTooltip());
        el.addEventListener("blur", () => marker.closeTooltip());
      }
      obstacleLayers.current.set(o.id, { box: boxLayer, marker: el });
    }
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      group.eachLayer(layer => layer.closeTooltip());
    };
    document.addEventListener("keydown", dismiss);
    return () => {
      document.removeEventListener("keydown", dismiss);
      obstacleLayers.current.clear(); group.remove();
    };
  }, [result, vertical, valid, showObstacles, Boolean(planView)]);
  // Selection changes styles only, so focus and the inspector opener retain their DOM node.
  useEffect(() => {
    obstacleLayers.current.forEach(({ box, marker }, id) => {
      const active = id === state.selectedObstacleId;
      box.setStyle({ color: active ? "#f4d396" : "#c9a773", weight: active ? 2.5 : 1.5, fillOpacity: active ? 0.28 : 0.12, dashArray: active ? "" : "6 5" });
      marker.classList.toggle("is-selected", active);
      if (!planView) marker.setAttribute("aria-pressed", String(active));
    });
  }, [state.selectedObstacleId, result, vertical, valid, showObstacles, Boolean(planView)]);

  function fit(all: boolean) {
    const next = (all ? planBounds() : null) ?? sceneBounds(!all && selected ? [selected] : obstacles, vertical);
    fittedBounds.current = next;
    map.current?.stop();
    if (next) { setShowObstacles(true); map.current?.fitBounds(leafletBounds(next), cameraPadding()); }
  }
  return <div className={`ws-scene-map ${detailOpen ? "has-detail" : ""} ${imagery ? "has-imagery" : ""} ${planView ? "has-plan" : ""}`}>
    <div ref={container} className="ws-scene-canvas" aria-label={`局部坐标图，X${vertical === 1 ? "Y" : "Z"} 投影，单位米；方向键平移，加减键缩放`} />
    {planToolbar}
    <div className="ws-scene-map-heading"><label htmlFor="scene-projection">{campus ? "建筑巡检演示" : "局部坐标 / m"}</label><select id="scene-projection" className="ws-input" value={vertical} onChange={e => setVertical(Number(e.target.value) as SceneProjection)}><option value={1}>俯视 XY</option><option value={2}>侧视 XZ</option></select><span>{campus ? "Mock · 模拟配准" : result ? sceneSourceNames[result.source] : "等待检测"}</span></div>
    {campus && <div className="ws-scene-view-switch" role="group" aria-label="场景底图"><button aria-pressed={imagery} onClick={() => { setVertical(1); setShowImage(true); setImageFailed(false); }}>影像叠加</button><button aria-pressed={!imagery} onClick={() => setShowImage(false)}>坐标核验</button></div>}
    {campus && imageFailed && <div className="ws-scene-image-error" role="alert">影像加载失败，已切换坐标图。<button className="ws-text-button" onClick={() => { setVertical(1); setShowImage(true); setImageFailed(false); }}>重试加载</button></div>}
    <div className="ws-scene-map-tools"><button className="ws-icon" aria-label="放大场景" onClick={() => map.current?.zoomIn()}><Plus size={17} /></button><button className="ws-icon" aria-label="缩小场景" onClick={() => map.current?.zoomOut()}><Minus size={17} /></button><button className="ws-icon" aria-label={planView ? "显示完整路线" : "显示全部障碍"} onClick={() => fit(true)}><Focus size={17} /></button><button className="ws-icon" aria-label="显示障碍图层" aria-pressed={showObstacles} onClick={() => setShowObstacles(!showObstacles)}><Layers size={17} /></button></div>
    {selected && valid && <button className="ws-button ws-scene-locate" onClick={() => fit(false)}><Focus size={15} />定位选中障碍</button>}
    {!planView && (!result || !obstacles.length || !valid) && <div className="ws-scene-map-empty" role="status"><strong>{!valid ? "坐标超出可视范围" : state.status === "loading" ? "正在检测场景" : state.status === "error" ? "检测未完成" : result ? "本次未检出障碍" : "等待场景数据"}</strong><p>{!valid ? "当前视图无法可靠表示该坐标范围，请在列表查看原始数值。" : result ? "没有保留的点簇；这不代表空间已确认安全。" : "从左侧选择点云并运行检测，结果将在此展示。"}</p></div>}
    <div className="ws-scene-map-caption"><span>X → · {vertical === 1 ? "Y" : "Z"} ↑</span><span>{scale}</span><span>{planView?.caption ?? (planView?.affectedTaskIds ? "青色：原路线 · 琥珀外圈：受事件影响 · S：起止点" : planView ? "实线：当前路线 · 虚线：对照路线 · S：起止点 · 数字：访问顺序" : campus ? "人工演示点位 · 障碍来自合成点云检测" : "轮廓为实际包围盒 · 编号标记为可选中心")}</span>{campus && !planView && <span className="ws-demo-short">A 作业对象 · P1–P3 观察点（30 m）· S 起降点</span>}</div>
  </div>;
}
