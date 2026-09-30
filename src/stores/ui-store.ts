"use client";

/**
 * AIDetective — UI store (zustand).
 * Holds the active workspace view + the analysis id shown in the detail view.
 * The view is linked to the browser hash (#/analyzer/text, #/analysis/<id>, …)
 * so any workspace state is bookmarkable and back/forward works.
 */
import { create } from "zustand";

export type ViewId =
  | "dashboard"
  | "analyzer-text"
  | "analyzer-image"
  | "analyzer-audio"
  | "analyzer-files"
  | "history"
  | "reports"
  | "datasets"
  | "models"
  | "llm"
  | "api"
  | "plugins"
  | "system"
  | "settings"
  | "about"
  | "analysis-detail";

const VIEW_TO_HASH: Record<ViewId, string> = {
  dashboard: "#/dashboard",
  "analyzer-text": "#/analyzer/text",
  "analyzer-image": "#/analyzer/image",
  "analyzer-audio": "#/analyzer/audio",
  "analyzer-files": "#/analyzer/files",
  history: "#/history",
  reports: "#/reports",
  datasets: "#/datasets",
  models: "#/models",
  llm: "#/llm",
  api: "#/api",
  plugins: "#/plugins",
  system: "#/system",
  settings: "#/settings",
  about: "#/about",
  "analysis-detail": "#/analysis",
};

const ANALYZER_VIEWS: ViewId[] = ["analyzer-text", "analyzer-image", "analyzer-audio", "analyzer-files"];

/** Parse a location.hash into a view + optional detail id. */
export function parseHash(hash: string): { view: ViewId; detailId: string | null } {
  const raw = hash.replace(/^#/, "");
  const segments = raw.split("/").filter(Boolean);

  if (segments.length === 0 || segments[0] === "dashboard") {
    return { view: "dashboard", detailId: null };
  }
  if (segments[0] === "analyzer") {
    const tab = segments[1];
    if (tab === "text" || tab === "image" || tab === "audio" || tab === "files") {
      return { view: `analyzer-${tab}` as ViewId, detailId: null };
    }
    return { view: "analyzer-text", detailId: null };
  }
  if (segments[0] === "analysis" && segments[1]) {
    return { view: "analysis-detail", detailId: decodeURIComponent(segments[1]) };
  }

  const match = (Object.keys(VIEW_TO_HASH) as ViewId[]).find(
    (view) => view !== "analysis-detail" && VIEW_TO_HASH[view] === `#/${segments[0]}`
  );
  if (match) return { view: match, detailId: null };

  return { view: "dashboard", detailId: null };
}

export function hashForView(view: ViewId, detailId?: string | null): string {
  if (view === "analysis-detail" && detailId) {
    return `${VIEW_TO_HASH[view]}/${encodeURIComponent(detailId)}`;
  }
  return VIEW_TO_HASH[view] ?? "#/dashboard";
}

export function isAnalyzerView(view: ViewId): boolean {
  return ANALYZER_VIEWS.includes(view);
}

interface UiState {
  activeView: ViewId;
  detailAnalysisId: string | null;
  mobileNavOpen: boolean;
  /** Read location.hash and apply it to state (called on mount + hashchange). */
  syncFromHash: (hash: string) => void;
  /** Navigate to a view, writing the hash. */
  navigate: (view: ViewId, opts?: { detailId?: string | null }) => void;
  setMobileNavOpen: (open: boolean) => void;
}

export const useUiStore = create<UiState>((set, get) => ({
  activeView: "dashboard",
  detailAnalysisId: null,
  mobileNavOpen: false,

  syncFromHash: (hash) => {
    const { view, detailId } = parseHash(hash);
    const state = get();
    if (state.activeView === view && state.detailAnalysisId === detailId) return;
    set({ activeView: view, detailAnalysisId: detailId });
  },

  navigate: (view, opts) => {
    const detailId = opts?.detailId !== undefined ? opts.detailId : get().detailAnalysisId;
    const nextHash = hashForView(view, detailId);
    const current = typeof window !== "undefined" ? window.location.hash : "";
    if (current === nextHash) {
      set({ activeView: view, detailAnalysisId: detailId ?? null });
      return;
    }
    set({ activeView: view, detailAnalysisId: detailId ?? null });
    if (typeof window !== "undefined") window.location.hash = nextHash;
  },

  setMobileNavOpen: (open) => set({ mobileNavOpen: open }),
}));
