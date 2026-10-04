import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { HomeDashboard } from "./features/mission/HomeDashboard";
import { useMissionDrafts, type MissionDraft } from "./features/mission/missionDrafts";
import "./styles/dashboard.css";

const SpatialTaskWorkspace = lazy(() => import("./features/mission/SpatialTaskWorkspace").then(module => ({ default: module.SpatialTaskWorkspace })));
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
    if (!active) document.querySelector<HTMLElement>("#home-heading")?.focus({ preventScroll: true });
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
  const saveWorkspace = useCallback((update: Pick<MissionDraft, "rawInput" | "spatial">) => {
    persist(drafts.map(d => d.id === workspaceId ? { ...d, ...update, updatedAt: new Date().toISOString() } : d));
  }, [drafts, persist, workspaceId]);
  function create(draft: MissionDraft) {
    persist([draft, ...drafts]);
    navigate(draft.id);
  }

  return <>
    <HomeDashboard drafts={drafts} storageError={storageError} onCreate={create} onOpen={draft => navigate(draft.id)} visible={!active} />
    {workspace && <Suspense fallback={active ? <p className="mission-entry-bar" role="status">正在打开任务工作区…</p> : null}>
      <SpatialTaskWorkspace key={workspace.id} draft={workspace} storageError={storageError} onChange={saveWorkspace} onBack={() => navigate(null)} visible={Boolean(active)} />
    </Suspense>}
  </>;
}
