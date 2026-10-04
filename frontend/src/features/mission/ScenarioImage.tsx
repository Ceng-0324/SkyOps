import { Building2, Layers, LocateFixed, ScanLine } from "lucide-react";
import building from "../../public/scenarios/building.jpg";
import campus from "../../public/scenarios/campus.jpg";
import mapping from "../../public/scenarios/mapping.jpg";
import response from "../../public/scenarios/response.jpg";

export const scenarios = [
  { id: "building", title: "建筑巡检", image: building, icon: Building2, legend: "建筑观察点", description: "围绕建筑与观察区域，组织外立面巡检任务。", tags: ["建筑立面", "观察点规划"], category: "巡检", planned: false,
    source: "https://commons.wikimedia.org/wiki/File:Aerial_Microsoft_West_Campus_August_2009.jpg", author: "Jelson25", license: "Public domain", licenseUrl: "https://creativecommons.org/publicdomain/mark/1.0/" },
  { id: "campus", title: "区域巡逻", image: campus, icon: LocateFixed, legend: "巡逻路线", description: "围绕作业区域与重点位置，组织巡逻任务。", tags: ["重点区域", "路径规划"], category: "巡逻", planned: false,
    source: "https://commons.wikimedia.org/wiki/File:20230721_BLC_campus_aerial_drone_view_Bethany_Lutheran_College_Mankato_Minnesota.jpg", author: "Bethany Lutheran College", license: "CC BY-SA 4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/" },
  { id: "mapping", title: "测绘采集", image: mapping, icon: Layers, legend: "测绘覆盖范围", description: "围绕采集目标，组织区域覆盖与观察点。", tags: ["区域覆盖", "空间采集"], category: "测绘", planned: false,
    source: "https://commons.wikimedia.org/wiki/File:Drone_Shot_of_Mankayan_Vast_Farm_Fields.jpg", author: "Bien02", license: "CC BY 4.0", licenseUrl: "https://creativecommons.org/licenses/by/4.0/" },
  { id: "response", title: "应急勘察", image: response, icon: ScanLine, legend: "现场关注位置", description: "围绕事件位置，组织现场勘察与信息采集。", tags: ["事件定位", "现场观察"], category: "应急", planned: true,
    source: "https://commons.wikimedia.org/wiki/File:Aerial_perspective_of_the_bridge_across_Dongshan_river.jpg", author: "Bob Tan", license: "CC BY 4.0", licenseUrl: "https://creativecommons.org/licenses/by/4.0/" },
] as const;
export type Scenario = typeof scenarios[number];

function Point({ x, y, label }: { x: number; y: number; label?: string }) {
  return <g className="spatial-point"><circle cx={x} cy={y} r="7" /><circle className="point-core" cx={x} cy={y} r="2" />{label && <><rect x={x + 10} y={y - 22} width="27" height="20" rx="3" /><text x={x + 23.5} y={y - 7}>{label}</text></>}</g>;
}

/** Reference imagery and illustrative overlays are not a mission coordinate frame. */
export function ScenarioImage({ scenario, preview = false }: { scenario: Scenario; preview?: boolean }) {
  return <div className={`scenario-image ${preview ? "scenario-preview" : ""}`}>
    <img src={scenario.image} alt={`${scenario.title}真实航拍底图，叠加${scenario.legend}示意`} width="600" height="360" />
    <svg className="spatial-overlay" viewBox="0 0 600 360" preserveAspectRatio={preview ? "xMidYMax slice" : "xMidYMid meet"} aria-hidden="true">
      {scenario.id === "building" && <><path className="spatial-area" d="M240 220 276 200 310 210 362 173 410 177 410 197 327 255 240 233Z" /><path className="spatial-route dashed" d="M224 249 317 285 432 217" /><Point x={224} y={249} label="01" /><Point x={317} y={285} label="02" /><Point x={432} y={217} label="03" /></>}
      {scenario.id === "campus" && <><path className="route-underlay" d="M294 312 302 279 313 237 312 214 308 194 320 177 330 169 344 141 377 131 407 128" /><path className="spatial-route" d="M294 312 302 279 313 237 312 214 308 194 320 177 330 169 344 141 377 131 407 128" /><Point x={294} y={312} /><Point x={312} y={214} /><Point x={407} y={128} /><path className="route-arrow" d="m322 176 4-17 7 13" /></>}
      {scenario.id === "mapping" && <><path className="spatial-area dashed" d="M226 247 357 193 478 243 342 313Z" /><path className="survey-lines" d="m245 257 130-56m-108 67 130-58m-108 70 130-59m-108 71 130-61m-109 72 128-63" /><Point x={226} y={247} /><Point x={478} y={243} /></>}
      {scenario.id === "response" && <><path className="spatial-route dashed" d="M358 270 445 203 511 183" /><Point x={358} y={270} /><Point x={511} y={183} /><ellipse className="attention-area" cx="445" cy="203" rx="40" ry="20" /><g className="attention-pin"><path d="M445 173c-10 0-17 7-17 16 0 12 17 26 17 26s17-14 17-26c0-9-7-16-17-16Z" /><circle cx="445" cy="189" r="5" /></g></>}
    </svg>
    <span className="image-label">航拍 · 标记示意</span>
    {!preview && <div className="image-legend"><scenario.icon size={13} />{scenario.legend}</div>}
  </div>;
}
