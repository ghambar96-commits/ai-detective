"use client";

/**
 * AIDetective — Dashboard view. Aggregates /stats, /system/status and the
 * most recent analyses into one analyst overview.
 */
import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  CheckCircle2,
  Clock3,
  FileSearch,
  ScanSearch,
  XCircle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getStats, getSystemStatus, listAnalyses } from "@/lib/api/client";
import { useUiStore } from "@/stores/ui-store";
import type { AnalysisSummary, StatsResponse, SystemStatus } from "@/types/api";
import {
  ClassificationBadge,
  classificationLabel,
  DistributionRow,
  EmptyState,
  ErrorState,
  formatDuration,
  LoadingCards,
  ModalityIcon,
  RelativeTime,
  ScoreBar,
  ServiceDot,
  StatusBadge,
} from "../shared";

export function DashboardView() {
  const navigate = useUiStore((s) => s.navigate);
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [system, setSystem] = useState<SystemStatus | null>(null);
  const [recent, setRecent] = useState<AnalysisSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [statsRes, systemRes, recentRes] = await Promise.all([
        getStats(),
        getSystemStatus(),
        listAnalyses({ page: 1, pageSize: 8, sort: "createdAt", order: "desc" }),
      ]);
      setStats(statsRes);
      setSystem(systemRes);
      setRecent(recentRes.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load dashboard data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="space-y-4">
        <LoadingCards count={4} />
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-56 rounded-lg" />
          <Skeleton className="h-56 rounded-lg" />
        </div>
        <Skeleton className="h-72 rounded-lg" />
      </div>
    );
  }

  if (error) {
    return <ErrorState message={error} onRetry={() => void load()} />;
  }

  if (!stats) return null;

  const totals = stats.totals;
  const maxModality = Math.max(1, ...Object.values(stats.byModality));
  const maxClassification = Math.max(1, ...Object.values(stats.byClassification));
  const classTone = (key: string) =>
    key === "likely_human" ? "emerald" : key === "likely_ai_generated" || key === "likely_synthetic" ? "rose" : key === "uncertain" ? "amber" : "zinc";

  return (
    <div className="space-y-4">
      {/* Stat cards */}
      <section aria-label="Analysis totals" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={<ScanSearch aria-hidden className="size-4 text-emerald-400" />}
          label="Total analyses"
          value={totals.all}
          hint={`${totals.last24h} in the last 24h`}
        />
        <StatCard
          icon={<CheckCircle2 aria-hidden className="size-4 text-emerald-400" />}
          label="Completed"
          value={totals.completed}
          hint={
            totals.avgProcessingTimeMs !== null
              ? `avg processing ${formatDuration(totals.avgProcessingTimeMs)}`
              : undefined
          }
        />
        <StatCard
          icon={<XCircle aria-hidden className="size-4 text-rose-400" />}
          label="Failed"
          value={totals.failed}
          hint={totals.all > 0 ? `${((totals.failed / totals.all) * 100).toFixed(1)}% of all runs` : undefined}
        />
        <StatCard
          icon={<Clock3 aria-hidden className="size-4 text-amber-400" />}
          label="Last 24 hours"
          value={totals.last24h}
          hint="rolling window"
        />
      </section>

      {/* Distributions */}
      <section aria-label="Distributions" className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">By modality</CardTitle>
            <CardDescription>Analyses grouped by input type.</CardDescription>
          </CardHeader>
          <CardContent>
            {Object.keys(stats.byModality).length === 0 ? (
              <p className="py-4 text-center text-xs text-muted-foreground">No analyses yet.</p>
            ) : (
              Object.entries(stats.byModality).map(([modality, count]) => (
                <DistributionRow
                  key={modality}
                  label={
                    <span className="inline-flex items-center gap-1.5">
                      <ModalityIcon modality={modality} className="size-3.5" />
                      {modality.charAt(0).toUpperCase() + modality.slice(1)}
                    </span>
                  }
                  value={count}
                  max={maxModality}
                  tone={modality === "text" ? "emerald" : modality === "image" ? "rose" : modality === "audio" ? "zinc" : "amber"}
                />
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">By classification</CardTitle>
            <CardDescription>
              Verdict distribution across completed analyses.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {Object.keys(stats.byClassification).length === 0 ? (
              <p className="py-4 text-center text-xs text-muted-foreground">No completed analyses yet.</p>
            ) : (
              Object.entries(stats.byClassification).map(([key, count]) => (
                <DistributionRow
                  key={key}
                  label={classificationLabel(key)}
                  value={count}
                  max={maxClassification}
                  tone={classTone(key)}
                />
              ))
            )}
            <p className="mt-2 text-[11px] text-muted-foreground">
              Probabilistic outcomes — a verdict is a likelihood estimate, not proof.
            </p>
          </CardContent>
        </Card>
      </section>

      {/* Recent analyses */}
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
          <div>
            <CardTitle className="text-sm">Recent analyses</CardTitle>
            <CardDescription>Latest 8 runs — click a row for the full breakdown.</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => navigate("history")} className="min-h-9">
            View all
          </Button>
        </CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <EmptyState
              icon={<ScanSearch aria-hidden className="size-8" />}
              title="No analyses yet"
              description="Run your first analysis from the Analyzer to see results here."
              action={
                <Button size="sm" onClick={() => navigate("analyzer-text")} className="min-h-11">
                  Open Analyzer
                </Button>
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Input</TableHead>
                    <TableHead>Verdict</TableHead>
                    <TableHead className="text-right">Likelihood</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recent.map((item) => (
                    <TableRow
                      key={item.id}
                      onClick={() => navigate("analysis-detail", { detailId: item.id })}
                      className="cursor-pointer"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          navigate("analysis-detail", { detailId: item.id });
                        }
                      }}
                      aria-label={`Open analysis ${item.fileName ?? item.id}`}
                    >
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <ModalityIcon modality={item.modality} />
                          <span className="max-w-56 truncate text-sm">
                            {item.fileName ?? "Inline text"}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <ClassificationBadge classification={item.classification} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {item.likelihoodScore !== null ? ScoreText(item.likelihoodScore, item.classification) : "—"}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={item.status} />
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        <RelativeTime iso={item.createdAt} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Health + issues */}
      <section aria-label="System health" className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Activity aria-hidden className="size-4 text-emerald-400" />
              System health
            </CardTitle>
            <CardDescription>
              {system
                ? `${system.app.name} v${system.app.version} · ${system.app.environment} · uptime ${Math.floor(system.app.uptimeSec / 60)}m`
                : "Loading…"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {system ? (
              <>
                <HealthRow label="API" status={system.services.api.status} detail="REST API serving requests" />
                <HealthRow
                  label="Database"
                  status={system.services.database.status}
                  detail={
                    system.services.database.latencyMs !== null
                      ? `${system.services.database.latencyMs} ms latency`
                      : (system.services.database.error ?? "latency unknown")
                  }
                />
                <HealthRow
                  label="Queue"
                  status={system.services.queue.failed > 0 ? "degraded" : "ok"}
                  detail={`${system.services.queue.implementation} · ${system.services.queue.queued} queued · ${system.services.queue.active} active · ${system.services.queue.processed} processed`}
                />
                <HealthRow
                  label="LLM"
                  status={system.services.llm.enabled ? (system.services.llm.configured ? "ok" : "degraded") : "disabled"}
                  detail={`${system.services.llm.providerLabel}${system.services.llm.model ? ` · ${system.services.llm.model}` : ""} — explanation only`}
                />
                <HealthRow
                  label="Detectors"
                  status="ok"
                  detail={`${system.services.detectors.total} registered (${system.services.detectors.plugins} from plugins)`}
                />
                <div className="pt-1">
                  <ScoreBar
                    value={system.resources.memory.usagePct / 100}
                    tone={system.resources.memory.usagePct > 85 ? "rose" : system.resources.memory.usagePct > 65 ? "amber" : "emerald"}
                    label="Memory usage"
                    caption="Host memory — informational only."
                  />
                </div>
              </>
            ) : (
              <Skeleton className="h-32" />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Recent issues</CardTitle>
            <CardDescription>Latest warnings and errors recorded by the engine.</CardDescription>
          </CardHeader>
          <CardContent>
            {stats.recentIssues.length === 0 ? (
              <p className="py-4 text-center text-xs text-muted-foreground">No issues recorded. All clear.</p>
            ) : (
              <ul className="max-h-72 space-y-2 overflow-y-auto pr-1">
                {stats.recentIssues.map((issue) => (
                  <li key={issue.id} className="rounded-md border px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                          issue.level === "error" ? "bg-rose-500/15 text-rose-400" : "bg-amber-500/15 text-amber-400"
                        }`}
                      >
                        {issue.level}
                      </span>
                      <span className="text-xs font-medium">{issue.source}</span>
                      <span className="ml-auto text-[10px] text-muted-foreground">
                        <RelativeTime iso={issue.createdAt} />
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{issue.message}</p>
                  </li>
                ))}
              </ul>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="mt-2 min-h-9 w-full"
              onClick={() => navigate("system")}
            >
              <FileSearch aria-hidden className="size-3.5" /> Open system status
            </Button>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function ScoreText(score: number, classification: string | null) {
  const pct = `${(score * 100).toFixed(1)}%`;
  const tone =
    classification === "likely_human"
      ? "text-emerald-400"
      : classification === "likely_ai_generated" || classification === "likely_synthetic"
        ? "text-rose-400"
        : classification === "uncertain"
          ? "text-amber-400"
          : "text-zinc-300";
  return <span className={`font-medium ${tone}`}>{pct}</span>;
}

function StatCard({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  hint?: string;
}) {
  return (
    <Card className="p-6">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        {icon}
        {label}
      </div>
      <p className="mt-2 text-3xl font-semibold tabular-nums tracking-tight">{value.toLocaleString()}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : <p className="mt-1 text-xs text-muted-foreground/60">—</p>}
    </Card>
  );
}

function HealthRow({ label, status, detail }: { label: string; status: string; detail: string }) {
  return (
    <div className="flex items-center gap-2.5 text-sm">
      <ServiceDot status={status} />
      <span className="w-20 shrink-0 font-medium">{label}</span>
      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={detail}>
        {detail}
      </span>
      <span className="hidden shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground/70 sm:inline">
        {status}
      </span>
    </div>
  );
}
