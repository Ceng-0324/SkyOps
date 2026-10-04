import { useCallback, useState } from "react";
import { isSceneInput, type SceneInput } from "../environment/sceneInput";
import { isSpatialTaskDraft, type SpatialTaskDraft } from "./spatialTaskDraft";

export type TemplateId = "blank" | "building" | "campus" | "mapping";
export type MissionBrief = { name: string; goal: string; completion: string };
export type MissionDraft = MissionBrief & {
  id: string;
  template: TemplateId;
  rawInput: string;
  createdAt: string;
  updatedAt: string;
  spatial?: SpatialTaskDraft;
  scene?: SceneInput;
};
export const DRAFT_STORAGE_KEY = "skyops.mission-drafts.v1";
export const briefPresets: Record<TemplateId, MissionBrief> = {
  blank: { name: "", goal: "", completion: "" },
  building: { name: "建筑外立面巡检", goal: "巡检目标建筑的四面外立面，采集各面的影像。", completion: "取得四面影像。" },
  campus: { name: "园区道路巡逻", goal: "巡逻园区道路与重点区域，采集沿线影像。", completion: "覆盖全区。" },
  mapping: { name: "区域测绘采集", goal: "测绘指定区域，完成区域覆盖与影像采集。", completion: "覆盖全区。" },
};

export function validBrief(brief: MissionBrief): boolean {
  return brief.name.trim().length > 0 && brief.name.length <= 80
    && brief.goal.trim().length > 0 && brief.goal.length <= 2048 && brief.completion.length <= 1024;
}

export function makeDraft(brief: MissionBrief, template: TemplateId): MissionDraft {
  if (!validBrief(brief)) throw new Error("请填写有效的任务名称与作业目标。");
  const name = brief.name.trim(), goal = brief.goal.trim(), completion = brief.completion.trim();
  const now = new Date().toISOString();
  return { id: crypto.randomUUID(), name, goal, completion, template,
    rawInput: completion ? `${goal}\n完成条件：${completion}` : goal, createdAt: now, updatedAt: now };
}

function isDraft(value: unknown): value is MissionDraft {
  if (typeof value !== "object" || value === null) return false;
  const d = value as Record<string, unknown>;
  return typeof d.id === "string" && d.id.length > 0 && d.id.length <= 128
    && typeof d.name === "string" && typeof d.goal === "string" && typeof d.completion === "string"
    && validBrief({ name: d.name, goal: d.goal, completion: d.completion })
    && typeof d.template === "string" && Object.hasOwn(briefPresets, d.template)
    && typeof d.rawInput === "string" && d.rawInput.length <= 16384
    && typeof d.createdAt === "string" && Number.isFinite(Date.parse(d.createdAt))
    && (d.spatial === undefined || isSpatialTaskDraft(d.spatial))
    && (d.scene === undefined || isSceneInput(d.scene))
    && typeof d.updatedAt === "string" && Number.isFinite(Date.parse(d.updatedAt));
}

export function readDrafts(storage: Pick<Storage, "getItem">): MissionDraft[] {
  const raw = storage.getItem(DRAFT_STORAGE_KEY);
  if (!raw) return [];
  const data: unknown = JSON.parse(raw);
  if (typeof data !== "object" || data === null || !("version" in data) || data.version !== 1
    || !("drafts" in data) || !Array.isArray(data.drafts) || !data.drafts.every(isDraft)
    || new Set(data.drafts.map(d => d.id)).size !== data.drafts.length) {
    throw new Error("本地任务记录格式无效");
  }
  return data.drafts;
}

/** Persist briefs only. API results, routes and flight approval are never fabricated here. */
export function useMissionDrafts() {
  const [initial] = useState(() => {
    try { return { drafts: readDrafts(localStorage), error: "" }; }
    catch { return { drafts: [] as MissionDraft[], error: "无法读取本机任务记录。原记录未覆盖，新任务暂存于本页，关闭页面后会丢失。" }; }
  });
  const [drafts, setDrafts] = useState(initial.drafts);
  const [storageError, setStorageError] = useState(initial.error);
  const persist = useCallback((next: MissionDraft[]) => {
    setDrafts(next);
    if (initial.error) return;
    try {
      localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify({ version: 1, drafts: next }));
      setStorageError("");
    } catch { setStorageError("无法保存到本机。当前任务暂存于本页，关闭页面后会丢失；请检查浏览器存储权限或空间。"); }
  }, [initial.error]);
  return { drafts, persist, storageError };
}
