import { useEffect, useRef, useState } from "react";
import { ArrowRight, FileText, Layers, MapPin, X } from "lucide-react";
import { validBrief, type MissionBrief, type TemplateId } from "./missionDrafts";
import { ScenarioImage, scenarios } from "./ScenarioImage";

interface CreateMissionDrawerProps {
  template: TemplateId;
  brief: MissionBrief;
  onChange: (brief: MissionBrief) => void;
  onClose: () => void;
  onCreate: () => void;
}

export function CreateMissionDrawer({ template, brief, onChange, onClose, onCreate }: CreateMissionDrawerProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const drag = useRef<{ id: number; x: number; width: number } | null>(null);
  const [preferredWidth, setPreferredWidth] = useState(576);
  const [viewport, setViewport] = useState(window.innerWidth);
  const maxWidth = Math.max(440, Math.min(900, Math.floor(viewport * 0.7)));
  const width = Math.max(440, Math.min(maxWidth, preferredWidth));
  const scenario = scenarios.find(s => s.id === template);
  const missing = [!brief.name.trim() && "任务名称", !brief.goal.trim() && "作业目标"].filter(Boolean);

  useEffect(() => {
    const node = dialog.current!;
    const opener = document.activeElement;
    const alreadyLocked = document.body.classList.contains("mission-drawer-open");
    document.body.classList.add("mission-drawer-open");
    node.showModal();
    heading.current?.focus({ preventScroll: true });
    const resize = () => { drag.current = null; setViewport(window.innerWidth); };
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      node.close();
      if (!alreadyLocked) document.body.classList.remove("mission-drawer-open");
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  return <>
    <style>{`@media(min-width:621px){.ops-home #mission-create{width:${width}px}}`}</style>
    <dialog ref={dialog} id="mission-create" className="create-drawer" aria-labelledby="create-heading" aria-describedby="create-description" onCancel={event => { event.preventDefault(); onClose(); }}>
      <div className="drawer-resizer" role="separator" tabIndex={viewport <= 620 ? -1 : 0} aria-orientation="vertical" aria-label="调整创建面板宽度" aria-controls="mission-create" aria-valuemin={440} aria-valuemax={maxWidth} aria-valuenow={width} title="拖拽调整宽度，双击恢复默认宽度"
        onPointerDown={event => {
          if (event.button !== 0 || viewport <= 620) return;
          event.preventDefault();
          drag.current = { id: event.pointerId, x: event.clientX, width };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={event => {
          if (drag.current?.id !== event.pointerId) return;
          setPreferredWidth(Math.min(maxWidth, Math.max(440, drag.current.width + drag.current.x - event.clientX)));
        }}
        onPointerUp={event => { drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
        onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}
        onDoubleClick={() => setPreferredWidth(576)}
        onKeyDown={event => {
          const sizes: Record<string, number> = { ArrowLeft: width + 24, ArrowRight: width - 24, Home: 440, End: maxWidth };
          if (!(event.key in sizes)) return;
          event.preventDefault(); setPreferredWidth(Math.min(maxWidth, Math.max(440, sizes[event.key])));
        }} />
      <header className="drawer-header"><div><h2 id="create-heading" ref={heading} tabIndex={-1}>创建任务</h2><p id="create-description">{scenario ? "从模板开始，按实际作业需要调整内容。" : "填写基本信息，开始一项新的空间作业。"}</p></div><button className="drawer-close" aria-label="关闭创建面板" onClick={onClose}><X size={17} /></button></header>
      <div className="drawer-scroll">
        {scenario ? <section className="drawer-template"><div className="drawer-preview"><ScenarioImage scenario={scenario} preview /></div><div className="drawer-template-caption"><div><h3>{scenario.title}</h3><p>{scenario.tags.join(" · ")}</p></div><span className="template-mode-label"><Layers size={14} />模板已应用</span></div></section>
          : <section className="blank-intro"><FileText size={20} /><div><h3>从作业目标开始</h3><p>描述要做什么、怎样算完成。具体作业地点可以在工作区中继续设置。</p></div></section>}
        <form id="create-form" className="create-fields" onSubmit={event => { event.preventDefault(); if (validBrief(brief)) onCreate(); }}>
          <div className="create-field"><label htmlFor="create-name">任务名称</label><input className="create-control" id="create-name" name="name" maxLength={80} autoComplete="off" placeholder="例如：A 区建筑外立面巡检" required value={brief.name} onChange={e => onChange({ ...brief, name: e.target.value })} /></div>
          <div className="create-field"><label htmlFor="create-goal">作业目标</label><textarea className="create-control" id="create-goal" name="goal" maxLength={2048} placeholder="例如：巡检 A 楼的四面外立面，采集各面的影像。" required aria-describedby="goal-help" value={brief.goal} onChange={e => onChange({ ...brief, goal: e.target.value })} /><p className="field-help" id="goal-help">写清作业对象和要完成的工作。</p></div>
          <div className="create-field"><label htmlFor="create-completion">完成条件<span className="field-optional">可稍后补充</span></label><textarea className="create-control" id="create-completion" name="completion" maxLength={1024} placeholder="例如：取得四面影像。" aria-describedby="completion-help" value={brief.completion} onChange={e => onChange({ ...brief, completion: e.target.value })} /><p className="field-help" id="completion-help">描述预期结果，便于后续复核。</p></div>
        </form>
        <div className="workspace-next"><MapPin size={18} /><div><strong>下一步：在工作区设置作业位置</strong><p>选择目标位置与观察点，再完善任务并生成候选方案。</p></div></div>
      </div>
      <footer className="drawer-footer"><p className="drawer-footer-note" id="create-hint" aria-live="polite"><FileText size={14} />{missing.length ? `填写${missing.join("和")}后即可创建。` : "创建后进入任务草稿，可继续调整。"}</p><div className="drawer-actions"><button className="drawer-cancel" onClick={onClose}>取消</button><button type="submit" form="create-form" className="primary-button drawer-submit" disabled={!validBrief(brief)} aria-describedby="create-hint">创建并进入工作区<ArrowRight size={16} /></button></div></footer>
    </dialog>
  </>;
}
