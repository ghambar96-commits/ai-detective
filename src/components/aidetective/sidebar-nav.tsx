"use client";

/**
 * AIDetective — sidebar navigation. Shared between the desktop rail and the
 * mobile Sheet. Items are ≥44px tall for touch targets.
 */
import {
  Activity,
  BookOpenText,
  Boxes,
  Database,
  FileSearch,
  History,
  KeyRound,
  LayoutDashboard,
  Puzzle,
  ScanSearch,
  Settings,
  Sparkles,
} from "lucide-react";

import { useUiStore, type ViewId } from "@/stores/ui-store";
import { cn } from "@/lib/utils";

interface NavItem {
  view: ViewId;
  label: string;
  icon: typeof LayoutDashboard;
  hint?: string;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Analysis",
    items: [
      { view: "dashboard", label: "Dashboard", icon: LayoutDashboard },
      { view: "analyzer-text", label: "Analyzer", icon: ScanSearch, hint: "Text · Image · Audio · Files" },
      { view: "history", label: "History", icon: History },
      { view: "reports", label: "Reports", icon: FileSearch },
    ],
  },
  {
    label: "Data",
    items: [
      { view: "datasets", label: "Datasets", icon: Database },
      { view: "models", label: "Models", icon: Boxes },
    ],
  },
  {
    label: "Intelligence",
    items: [
      { view: "llm", label: "LLM Setup", icon: Sparkles },
      { view: "plugins", label: "Plugins", icon: Puzzle },
      { view: "system", label: "System", icon: Activity },
    ],
  },
  {
    label: "Administration",
    items: [
      { view: "api", label: "API Keys", icon: KeyRound },
      { view: "settings", label: "Settings", icon: Settings },
    ],
  },
  {
    label: "Resources",
    items: [
      { view: "about", label: "About & How It Works", icon: BookOpenText },
    ],
  },
];

export const VIEW_TITLES: Record<ViewId, string> = {
  dashboard: "Dashboard",
  "analyzer-text": "Analyzer — Text",
  "analyzer-image": "Analyzer — Image",
  "analyzer-audio": "Analyzer — Audio",
  "analyzer-files": "Analyzer — Files",
  history: "Analysis History",
  reports: "Reports",
  datasets: "Datasets",
  models: "Model Registry",
  llm: "LLM Setup",
  api: "API Keys & Endpoints",
  plugins: "Plugins",
  system: "System Status",
  settings: "Settings",
  about: "About & How It Works",
  "analysis-detail": "Analysis Detail",
};

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const activeView = useUiStore((s) => s.activeView);
  const navigate = useUiStore((s) => s.navigate);

  const go = (view: ViewId) => {
    navigate(view);
    onNavigate?.();
  };

  return (
    <nav aria-label="Workspace" className="flex flex-col gap-5 px-3 py-4">
      {NAV_GROUPS.map((group) => (
        <div key={group.label}>
          <p className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">
            {group.label}
          </p>
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const active =
                activeView === item.view ||
                (item.view === "analyzer-text" && activeView.startsWith("analyzer-")) ||
                (item.view === "dashboard" && activeView === "analysis-detail");
              const Icon = item.icon;
              return (
                <li key={item.view}>
                  <button
                    type="button"
                    onClick={() => go(item.view)}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex min-h-11 w-full items-center gap-2.5 rounded-md px-2.5 text-sm outline-none transition-colors",
                      "focus-visible:ring-2 focus-visible:ring-ring/60",
                      active
                        ? "bg-emerald-500/10 font-medium text-emerald-400"
                        : "text-zinc-400 hover:bg-accent hover:text-foreground"
                    )}
                  >
                    <Icon aria-hidden className="size-4 shrink-0" />
                    <span className="flex-1 text-left">{item.label}</span>
                    {item.hint ? (
                      <span className="hidden text-[10px] text-muted-foreground/70 xl:block">{item.hint}</span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
