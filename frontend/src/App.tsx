import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { HomeDashboard } from "./features/mission/HomeDashboard";
import { useMissionDrafts, type MissionDraft } from "./features/mission/missionDrafts";
import "./styles/dashboard.css";

const MissionConsole = lazy(() => import("./features/mission/MissionConsole").then(module => ({ default: module.MissionConsole })));
const requestedTask = () => new URLSearchParams(window.location.search).get("task");

export function App() {
  const { drafts, persist, storageError } = useMissionDrafts();
  const [activeId, setActiveId] = useState(requestedTask);
  // Keep the current workspace mounted when returning home; API results stay in memory.
  const [workspaceId, setWorkspaceId] = useState(activeId);
  const active = drafts.find(d => d.id === activeId);
  const workspace = drafts.find(d => d.id === workspaceId);

  useEffect(() => {
    const pop = () => {
      const id = requestedTask();
      setActiveId(id);
      if (id) setWorkspaceId(id);
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  useEffect(() => {
    document.title = active ? `${active.name} · SkyOps` : "作业中心 · SkyOps";
    document.querySelector<HTMLElement>(active ? ".mission-entry-bar strong" : "#home-heading")?.focus({ preventScroll: true });
  }, [active?.id, active?.name]);

  function navigate(id: string | null) {
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("task", id); else url.searchParams.delete("task");
    url.hash = "";
    window.history.pushState(null, "", url);
    setActiveId(id);
    if (id) setWorkspaceId(id);
    window.scrollTo({ top: 0 });
  }
  const saveInput = useCallback((rawInput: string) => {
    const current = drafts.find(d => d.id === workspaceId);
    if (!current || current.rawInput === rawInput) return;
    persist(drafts.map(d => d.id === workspaceId ? { ...d, rawInput, updatedAt: new Date().toISOString() } : d));
  }, [drafts, persist, workspaceId]);
  function create(draft: MissionDraft) {
    persist([draft, ...drafts]);
    navigate(draft.id);
  }

  return <>
    <HomeDashboard drafts={drafts} storageError={storageError} onCreate={create} onOpen={draft => navigate(draft.id)} visible={!active} />
    {workspace && <section hidden={!active} aria-label="任务工作区">
      <header className="mission-entry-bar"><button onClick={() => navigate(null)}><ArrowLeft size={15} />返回工作台</button><strong tabIndex={-1}>{workspace.name}</strong><span>本机草稿 · 模拟作业</span>{storageError && <p role="alert">{storageError}</p>}</header>
      <Suspense fallback={<p className="mission-entry-bar" role="status">正在打开任务工作区…</p>}><MissionConsole key={workspace.id} initialTaskInput={workspace.rawInput} onTaskInputChange={saveInput} /></Suspense>
    </section>}
  </>;
}
