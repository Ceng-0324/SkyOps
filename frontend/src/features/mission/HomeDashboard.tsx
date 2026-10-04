import { useEffect, useRef, useState } from "react";
import { ArrowRight, ArrowUpRight, ChartNoAxesCombined, ChevronRight, CircleHelp, Clock3, Drone, FileText, Folders, Layers, LayoutDashboard, Map, Plus, Search, Settings2, Users, X } from "lucide-react";
import { CreateMissionDrawer } from "./CreateMissionDrawer";
import { briefPresets, makeDraft, type MissionBrief, type MissionDraft, type TemplateId } from "./missionDrafts";
import { ScenarioImage, scenarios } from "./ScenarioImage";

interface HomeDashboardProps {
  drafts: MissionDraft[];
  storageError: string;
  onCreate: (draft: MissionDraft) => void;
  onOpen: (draft: MissionDraft) => void;
  visible: boolean;
}

export function HomeDashboard({ drafts, storageError, onCreate, onOpen, visible }: HomeDashboardProps) {
  const [category, setCategory] = useState("全部");
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [mode, setMode] = useState<TemplateId | null>(null);
  const [briefs, setBriefs] = useState<Record<TemplateId, MissionBrief>>(() => structuredClone(briefPresets));
  const [help, setHelp] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const tasksHeading = useRef<HTMLHeadingElement>(null);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matches = (value: string) => value.toLocaleLowerCase().includes(normalizedQuery);
  const sorted = [...drafts].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const tasks = sorted.filter(d => matches(`${d.name} ${d.goal} ${d.completion}`));
  const pending = sorted;
  const templates = scenarios.filter(s => (category === "全部" || category === s.category) && matches(`${s.title} ${s.description} ${s.tags.join(" ")}`));
  const allTasks = () => { setShowAll(true); tasksHeading.current?.focus(); tasksHeading.current?.scrollIntoView({ block: "center" }); };

  useEffect(() => {
    if (!visible) return;
    document.documentElement.lang = "zh-CN";
    const shortcut = (e: KeyboardEvent) => {
      if (!mode && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); search.current?.focus(); }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [mode, visible]);

  return <div className="ops-home" hidden={!visible}>
    <a className="home-skip" href="#home-main">跳转到作业中心</a>
    <aside className="sidebar">
      <div className="brand"><Layers className="brand-mark" strokeWidth={1.6} /><span className="brand-word">SkyOps</span></div><div className="brand-caption">空间作业协同</div>
      <nav className="nav" aria-label="全局导航">
        <button className="nav-item selected" aria-current="page" aria-label="总览工作台" onClick={() => { setQuery(""); setCategory("全部"); window.scrollTo({ top: 0 }); }}><LayoutDashboard size={18} /><span>总览工作台</span><span className="active-dot" /></button>
        <button className="nav-item" aria-label="任务中心" onClick={allTasks}><Folders size={18} /><span>任务中心</span></button>
        {[{ icon: Map, text: "场景与数据" }, { icon: Drone, text: "设备资源" }, { icon: ChartNoAxesCombined, text: "评测与证据" }].map(item => <button key={item.text} className="nav-item" disabled aria-label={`${item.text} · 规划中`} title={`${item.text} · 规划中`}><item.icon size={18} /><span>{item.text}</span><small>规划中</small></button>)}
      </nav>
      <div className="sidebar-bottom"><button className="nav-item" disabled aria-label="成员与权限 · 规划中" title="成员与权限 · 规划中"><Users size={18} /><span>成员与权限</span></button><button className="nav-item" disabled aria-label="工作区设置 · 规划中" title="工作区设置 · 规划中"><Settings2 size={18} /><span>工作区设置</span></button><div className="workspace-profile"><div className="avatar"><Layers size={16} /></div><div className="profile-copy"><span>个人工作区</span><small>本机草稿</small></div></div></div>
    </aside>
    <div className="home-app">
      <header className="toolbar"><div className="breadcrumb"><span>个人工作区</span><ChevronRight size={13} /><span className="breadcrumb-current">作业中心</span></div><label className="searchbox"><Search size={16} /><input ref={search} type="search" aria-label="搜索任务、场景、模板" placeholder="搜索任务、场景、模板…" value={query} onChange={e => setQuery(e.target.value)} /><kbd className="shortcut">⌘ K</kbd></label><span className="demo-label"><span className="status-dot" />模拟作业</span><button className="tool-button" aria-label="使用指南" aria-expanded={help} onClick={() => setHelp(!help)}><CircleHelp size={19} /></button></header>
      <main id="home-main" className="home-main" tabIndex={-1}>
        <div className="page-heading"><div><h1 id="home-heading" tabIndex={-1}>作业中心</h1><p>选择场景模板创建任务，或继续上次的工作。</p></div><button className="primary-button" onClick={() => setMode("blank")}><Plus size={17} />新建任务</button></div>
        {storageError && <p className="home-error" role="alert">{storageError}</p>}
        {help && <section className="home-help" aria-label="使用指南"><div><h2>从目标开始，逐步完善任务</h2><p>选择模板或新建任务，填写目标与完成条件，然后进入工作区设置空间位置。任务基本信息保存在当前浏览器，规划结果仅保留于当前工作区。所有任务均为模拟作业。</p></div><button className="tool-button" aria-label="关闭使用指南" onClick={() => setHelp(false)}><X size={18} /></button></section>}
        <div className="work-row">
          <section aria-labelledby="continue-heading"><div className="section-heading"><h2 id="continue-heading" ref={tasksHeading} tabIndex={-1}>继续工作</h2><button className="subtle-action" onClick={() => setShowAll(!showAll)}>{showAll ? "收起列表" : "全部任务"}<ArrowRight size={15} /></button></div>
            {tasks.length ? <div className="task-grid">{tasks.slice(0, showAll ? undefined : 2).map(draft => {
              const template = scenarios.find(s => s.id === draft.template);
              return <article className="task" key={draft.id}>{template ? <img className="task-photo" src={template.image} alt="场景参考图" /> : <div className="task-photo blank-task"><FileText size={25} /></div>}<div className="task-content"><div className="task-meta">{template?.title ?? "自定义任务"}<span className="separator-dot" />本机草稿</div><h3 title={draft.name}>{draft.name}</h3><div className="task-bottom"><span className="state amber"><span className="status-dot" />待完善</span><button className="task-action" aria-label={`继续任务：${draft.name}`} onClick={() => onOpen(draft)}>继续编辑<ArrowRight size={13} /></button></div></div></article>;
            })}</div> : <div className="task-empty"><FileText size={24} /><div><h3>{query.trim() ? "没有匹配的任务" : "从第一项作业开始"}</h3><p>{query.trim() ? "试试任务名称或目标中的其他关键词。" : "选择下方场景模板，或新建一项空白任务。"}</p></div></div>}
          </section>
          <aside className="pending"><div className="section-heading"><h2>需要处理<span className="pending-count">{pending.length}</span></h2><span className="muted text-xs">任务信息</span></div>{pending.length ? pending.slice(0, 2).map(draft => <button className="pending-row" key={draft.id} onClick={() => onOpen(draft)}><FileText size={17} /><span className="pending-copy"><strong>任务草稿待完善</strong><span>{draft.name}</span></span><ChevronRight size={14} /></button>) : <p className="pending-empty">暂无待处理的任务草稿。<br />创建后可在工作区继续完善任务。</p>}</aside>
        </div>
        <section className="gallery" aria-labelledby="scenarios-heading"><div className="gallery-heading"><div><h2 id="scenarios-heading">作业场景</h2><p>从作业目标出发，开启空间规划与协同。</p></div><span className="gallery-note"><Layers size={14} />场景模板 · 持续扩展</span></div><div className="gallery-controls"><div className="filters" role="group" aria-label="场景分类">{["全部", "巡检", "巡逻", "测绘", "应急"].map(value => <button key={value} className={`filter ${category === value ? "active" : ""}`} aria-pressed={category === value} onClick={() => setCategory(value)}>{value}</button>)}</div><span className="gallery-note" role="status">{templates.length} 个场景</span></div>
          <div className="scenario-grid">{templates.map(s => <article className="scenario" key={s.id} data-template={s.id}><ScenarioImage scenario={s} /><div className="scenario-body"><h3>{s.title}{s.planned && <span className="planned-badge">规划中</span>}</h3><p>{s.description}</p><div className="scenario-tags">{s.tags.map(tag => <span key={tag}>{tag}</span>)}</div></div><div className="scenario-footer">{s.planned ? <><span className="muted">场景能力规划中</span><Clock3 size={15} /></> : <button aria-label={`查看${s.title}模板`} onClick={() => setMode(s.id)}>查看模板<ArrowUpRight size={15} /></button>}</div></article>)}</div>
          {!templates.length && <div className="gallery-empty"><p>没有匹配的场景模板。</p><button className="subtle-action" onClick={() => { setQuery(""); setCategory("全部"); }}>清除搜索与筛选<ArrowRight size={15} /></button></div>}
        </section>
        <section className="activity"><div className="section-heading"><h2>最近活动</h2><span className="muted text-xs">本机任务记录</span></div>{sorted.length ? sorted.slice(0, 3).map(draft => <div className="activity-row" key={draft.id}><FileText size={16} /><p>{draft.createdAt === draft.updatedAt ? "创建了任务草稿" : "更新了任务内容"}</p><button className="activity-task" onClick={() => onOpen(draft)}>{draft.name}</button><time dateTime={draft.updatedAt}>{new Date(draft.updatedAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })}</time></div>) : <p className="activity-empty">创建任务后，这里会显示最近的工作记录。</p>}</section>
        <footer className="page-footer"><span className="footer-left"><Layers size={13} />本机草稿 · 模拟作业 · 图片与标记仅作参考</span><details className="source-credit"><summary>图片来源</summary><div className="source-panel">{scenarios.map(s => <p key={s.id}><a href={s.source} target="_blank" rel="noreferrer">{s.title}</a> · {s.author}<br /><a href={s.licenseUrl} target="_blank" rel="noreferrer">{s.license}</a> · 已裁剪、调色，空间标记为示意</p>)}<p>校园配图及其演示叠加层按 CC BY-SA 4.0 提供。</p></div></details></footer>
      </main>
    </div>
    {mode && <CreateMissionDrawer key={mode} template={mode} brief={briefs[mode]} onChange={brief => setBriefs(current => ({ ...current, [mode]: brief }))} onClose={() => setMode(null)} onCreate={() => {
      const draft = makeDraft(briefs[mode], mode);
      setBriefs(current => ({ ...current, [mode]: { ...briefPresets[mode] } }));
      setMode(null); onCreate(draft);
    }} />}
  </div>;
}
