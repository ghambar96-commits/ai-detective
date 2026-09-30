"use client";

/**
 * AIDetective — workspace root. The whole app lives on this route; views are
 * switched client-side and linked via the URL hash (#/analyzer/text,
 * #/history, #/analysis/<id>, …) so state stays bookmarkable.
 */
import { useEffect } from "react";
import { motion } from "framer-motion";

import { Shell } from "@/components/aidetective/shell";
import { AnalysisDetailView } from "@/components/aidetective/views/analysis-detail-view";
import { AnalyzerView } from "@/components/aidetective/views/analyzer-view";
import { AboutView } from "@/components/aidetective/views/about-view";
import { ApiView } from "@/components/aidetective/views/api-view";
import { DashboardView } from "@/components/aidetective/views/dashboard-view";
import { DatasetsView } from "@/components/aidetective/views/datasets-view";
import { HistoryView } from "@/components/aidetective/views/history-view";
import { LLMView } from "@/components/aidetective/views/llm-view";
import { ModelsView } from "@/components/aidetective/views/models-view";
import { PluginsView } from "@/components/aidetective/views/plugins-view";
import { ReportsView } from "@/components/aidetective/views/reports-view";
import { SettingsView } from "@/components/aidetective/views/settings-view";
import { SystemView } from "@/components/aidetective/views/system-view";
import { useUiStore } from "@/stores/ui-store";

function ActiveView() {
  const activeView = useUiStore((s) => s.activeView);
  const detailAnalysisId = useUiStore((s) => s.detailAnalysisId);

  switch (activeView) {
    case "analyzer-text":
    case "analyzer-image":
    case "analyzer-audio":
    case "analyzer-files":
      return <AnalyzerView />;
    case "history":
      return <HistoryView />;
    case "reports":
      return <ReportsView />;
    case "datasets":
      return <DatasetsView />;
    case "models":
      return <ModelsView />;
    case "llm":
      return <LLMView />;
    case "api":
      return <ApiView />;
    case "plugins":
      return <PluginsView />;
    case "system":
      return <SystemView />;
    case "settings":
      return <SettingsView />;
    case "about":
      return <AboutView />;
    case "analysis-detail":
      return detailAnalysisId ? (
        <AnalysisDetailView id={detailAnalysisId} />
      ) : (
        <DashboardView />
      );
    case "dashboard":
    default:
      return <DashboardView />;
  }
}

export default function Home() {
  const syncFromHash = useUiStore((s) => s.syncFromHash);

  useEffect(() => {
    syncFromHash(window.location.hash);
    const onHashChange = () => syncFromHash(window.location.hash);
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [syncFromHash]);

  const activeView = useUiStore((s) => s.activeView);
  const detailAnalysisId = useUiStore((s) => s.detailAnalysisId);

  return (
    <Shell>
      <motion.div
        key={`${activeView}:${detailAnalysisId ?? ""}`}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18, ease: "easeOut" }}
      >
        <ActiveView />
      </motion.div>
    </Shell>
  );
}
