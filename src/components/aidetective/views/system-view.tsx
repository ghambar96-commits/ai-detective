"use client";

/**
 * AIDetective — System view: app info, resource bars (CPU / RAM / Disk),
 * service status, queue stats, GPU note and recent issues.
 */
import { useCallback, useEffect, useState } from "react";
import { Activity, Cpu, HardDrive, MemoryStick, Server } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getStats, getSystemStatus } from "@/lib/api/client";
import type { StatsResponse, SystemStatus } from "@/types/api";
import {
  formatBytes,
  formatDuration,
  formatUptime,
  RelativeTime,
  ServiceDot,
  ErrorState,
} from "../shared";

export function SystemView() {
  const [system, setSystem] = useState<SystemStatus | null>(null);
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [status, statsRes] = await Promise.all([getSystemStatus(), getStats()]);
      setSystem(status);
      setStats(statsRes);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load system status");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    // Refresh resources periodically while the view is open.
    const timer = window.setInterval(() => {
      getSystemStatus()
        .then(setSystem)
        .catch(() => undefined);
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [load]);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-56 rounded-lg" />
        <Skeleton className="h-64 rounded-lg" />
      </div>
    );
  }
  if (error) return <ErrorState message={error} onRetry={() => void load()} />;
  if (!system) return null;

  const { app, resources, services } = system;
  const memUsed = resources.memory.totalBytes - resources.memory.freeBytes;
  const diskUsed = resources.disk ? resources.disk.totalBytes - resources.disk.freeBytes : 0;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        {/* App info */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Server aria-hidden className="size-4 text-emerald-400" />
              Application
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            <InfoRow label="Name" value={app.name} />
            <InfoRow label="Version" value={`v${app.version}`} />
            <InfoRow label="Engine" value={`v${app.engineVersion}`} />
            <InfoRow label="Environment" value={app.environment} />
            <InfoRow label="Runtime" value={app.nodeVersion} />
            <InfoRow label="Platform" value={app.platform} />
            <InfoRow label="Uptime" value={formatUptime(app.uptimeSec)} />
          </CardContent>
        </Card>

        {/* Resources */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Activity aria-hidden className="size-4 text-emerald-400" />
              Resources
            </CardTitle>
            <CardDescription>Live values refresh every 10 seconds.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ResourceBar
              icon={<Cpu aria-hidden className="size-3.5" />}
              label="CPU"
              detail={`${resources.cpu.cores} cores · load avg ${resources.cpu.loadAvg1m}`}
              value={resources.cpu.usagePct === null ? null : resources.cpu.usagePct / 100}
            />
            <ResourceBar
              icon={<MemoryStick aria-hidden className="size-3.5" />}
              label="Memory"
              detail={`${formatBytes(memUsed)} / ${formatBytes(resources.memory.totalBytes)} · process RSS ${formatBytes(resources.memory.processRssBytes)}`}
              value={resources.memory.usagePct / 100}
            />
            {resources.disk ? (
              <ResourceBar
                icon={<HardDrive aria-hidden className="size-3.5" />}
                label="Disk"
                detail={`${formatBytes(diskUsed)} / ${formatBytes(resources.disk.totalBytes)}`}
                value={resources.disk.usagePct / 100}
              />
            ) : (
              <p className="text-xs text-muted-foreground">Disk usage unavailable on this platform.</p>
            )}
            <div className="rounded-md border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs leading-relaxed text-amber-300">
              <span className="font-semibold">GPU:</span>{" "}
              {resources.gpu ? `${resources.gpu.name}` : resources.gpuNote ?? "No GPU detected — analysis runs CPU-only."}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Services */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Services</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5">
            <ServiceRow label="API" status={services.api.status} detail={`environment: ${app.environment}`} />
            <ServiceRow
              label="Database"
              status={services.database.status}
              detail={
                services.database.latencyMs !== null
                  ? `SQLite via Prisma · ${services.database.latencyMs} ms`
                  : (services.database.error ?? "latency unknown")
              }
            />
            <ServiceRow
              label="Queue"
              status={services.queue.failed > 0 ? "degraded" : "ok"}
              detail={`${services.queue.implementation} · concurrency ${services.queue.concurrency}`}
            />
            <ServiceRow
              label="LLM"
              status={services.llm.enabled ? (services.llm.configured ? "ok" : "degraded") : "disabled"}
              detail={`${services.llm.providerLabel}${services.llm.model ? ` · ${services.llm.model}` : ""}`}
            />
            <ServiceRow
              label="Detectors"
              status="ok"
              detail={`${services.detectors.total} total · text ${services.detectors.byModality.text} · document ${services.detectors.byModality.document} · image ${services.detectors.byModality.image} · audio ${services.detectors.byModality.audio} · ${services.detectors.plugins} from plugins`}
            />
            <ServiceRow
              label="Security"
              status={services.security.requireApiKey ? "ok" : "local-mode"}
              detail={services.security.requireApiKey ? "API key required" : "Local mode — no key required"}
            />
            <p className="pt-1 text-[11px] text-muted-foreground">{services.llm.note}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Analysis queue</CardTitle>
            <CardDescription>
              In-memory FIFO queue for file analyses. Jobs are lost on restart by design (MVP) —
              a durable queue is a roadmap item.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <QueueStat label="Queued" value={services.queue.queued} />
            <QueueStat label="Active" value={services.queue.active} />
            <QueueStat label="Concurrency" value={services.queue.concurrency} />
            <QueueStat label="Processed" value={services.queue.processed} tone="text-emerald-400" />
            <QueueStat label="Failed" value={services.queue.failed} tone="text-rose-400" />
            <QueueStat
              label="Avg time"
              value={stats?.totals.avgProcessingTimeMs !== null && stats ? formatDuration(stats.totals.avgProcessingTimeMs) : "—"}
              plain
            />
          </CardContent>
        </Card>
      </div>

      {/* Recent issues */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Recent issues</CardTitle>
          <CardDescription>
            Warnings and errors from the structured logger (secrets and bodies are redacted).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!stats || stats.recentIssues.length === 0 ? (
            <p className="py-4 text-center text-xs text-muted-foreground">No issues recorded.</p>
          ) : (
            <ul className="max-h-96 space-y-2 overflow-y-auto pr-1 [scrollbar-width:thin]">
              {stats.recentIssues.map((issue) => (
                <li key={issue.id} className="rounded-md border px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant="outline"
                      className={`text-[10px] uppercase ${
                        issue.level === "error"
                          ? "border-rose-500/30 bg-rose-500/15 text-rose-400"
                          : "border-amber-500/30 bg-amber-500/15 text-amber-400"
                      }`}
                    >
                      {issue.level}
                    </Badge>
                    <span className="text-xs font-medium">{issue.source}</span>
                    <span className="ml-auto text-[10px] text-muted-foreground">
                      <RelativeTime iso={issue.createdAt} />
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{issue.message}</p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="truncate text-sm font-medium" title={value}>
        {value}
      </span>
    </div>
  );
}

function ResourceBar({
  icon,
  label,
  detail,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  detail: string;
  value: number | null;
}) {
  const pct = value === null ? null : Math.min(100, Math.max(0, value * 100));
  const tone =
    pct === null ? "bg-zinc-500" : pct > 85 ? "bg-rose-500" : pct > 65 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2 text-xs">
        <span className="inline-flex items-center gap-1.5 font-medium text-muted-foreground">
          {icon}
          {label}
        </span>
        <span className="font-semibold tabular-nums">{pct === null ? "n/a" : `${pct}%`}</span>
      </div>
      <div
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct === null ? undefined : Math.round(pct)}
        aria-label={label}
        className="h-2.5 w-full overflow-hidden rounded-full bg-muted"
      >
        {pct !== null ? <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} /> : null}
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">{detail}</p>
    </div>
  );
}

function ServiceRow({ label, status, detail }: { label: string; status: string; detail: string }) {
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

function QueueStat({
  label,
  value,
  tone,
  plain,
}: {
  label: string;
  value: number | string;
  tone?: string;
  plain?: boolean;
}) {
  return (
    <div className="rounded-md border p-3">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">{label}</p>
      <p className={`mt-1 text-xl font-semibold tabular-nums ${plain ? "text-sm" : tone ?? ""}`}>
        {value}
      </p>
    </div>
  );
}
