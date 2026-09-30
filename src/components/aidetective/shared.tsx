"use client";

/**
 * AIDetective — shared presentational components.
 * Includes honest score displays: simple horizontal bars with numeric values
 * and an explicit "likelihood estimate — not proof" caption. No gauges.
 */
import { formatDistanceToNowStrict, format } from "date-fns";
import {
  AlertTriangle,
  AudioLines,
  BadgeCheck,
  CircleHelp,
  FileScan,
  FileText,
  ImageIcon,
  RefreshCcw,
} from "lucide-react";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { AnalysisStatus, Classification, Modality, SignalDirection } from "@/types/api";

/* --------------------------------- formatting -------------------------------- */

export function formatPercent(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || Number.isNaN(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`;
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

export function formatUptime(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds)) return "—";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${Math.floor(seconds % 60)}s`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return format(new Date(iso), "yyyy-MM-dd HH:mm:ss");
  } catch {
    return iso;
  }
}

export function RelativeTime({ iso, className }: { iso: string | null | undefined; className?: string }) {
  if (!iso) return <span className={className}>—</span>;
  let label = iso;
  try {
    label = formatDistanceToNowStrict(new Date(iso), { addSuffix: true });
  } catch {
    /* keep raw */
  }
  return (
    <time dateTime={iso} title={formatDateTime(iso)} className={className}>
      {label}
    </time>
  );
}

/* ---------------------------------- badges ----------------------------------- */

const CLASSIFICATION_META: Record<string, { label: string; classes: string }> = {
  likely_human: {
    label: "Likely human",
    classes: "border-emerald-500/30 bg-emerald-500/15 text-emerald-400",
  },
  likely_ai_generated: {
    label: "Likely AI-generated",
    classes: "border-rose-500/30 bg-rose-500/15 text-rose-400",
  },
  likely_synthetic: {
    label: "Likely synthetic",
    classes: "border-rose-500/30 bg-rose-500/15 text-rose-400",
  },
  uncertain: {
    label: "Uncertain",
    classes: "border-amber-500/30 bg-amber-500/15 text-amber-400",
  },
  inconclusive: {
    label: "Inconclusive",
    classes: "border-zinc-500/40 bg-zinc-500/15 text-zinc-300",
  },
};

export function classificationLabel(key: string | null | undefined): string {
  if (!key) return "No verdict";
  return CLASSIFICATION_META[key]?.label ?? key;
}

export function ClassificationBadge({
  classification,
  className,
}: {
  classification: Classification | null | undefined;
  className?: string;
}) {
  if (!classification) {
    return (
      <Badge variant="outline" className={cn("border-zinc-500/40 bg-transparent text-zinc-400", className)}>
        No verdict
      </Badge>
    );
  }
  const meta = CLASSIFICATION_META[classification] ?? CLASSIFICATION_META.inconclusive;
  return (
    <Badge variant="outline" className={cn(meta.classes, className)}>
      {meta.label}
    </Badge>
  );
}

const STATUS_META: Record<AnalysisStatus, { label: string; classes: string; pulse?: boolean }> = {
  queued: { label: "Queued", classes: "border-amber-500/30 bg-amber-500/10 text-amber-400", pulse: true },
  processing: { label: "Processing", classes: "border-amber-500/30 bg-amber-500/10 text-amber-400", pulse: true },
  completed: { label: "Completed", classes: "border-emerald-500/30 bg-emerald-500/15 text-emerald-400" },
  failed: { label: "Failed", classes: "border-rose-500/30 bg-rose-500/15 text-rose-400" },
};

export function StatusBadge({
  status,
  className,
}: {
  status: AnalysisStatus | string | null | undefined;
  className?: string;
}) {
  if (!status) return null;
  const meta =
    STATUS_META[status as AnalysisStatus] ??
    ({ label: status, classes: "border-zinc-500/40 bg-zinc-500/15 text-zinc-300" } as const);
  return (
    <Badge variant="outline" className={cn(meta.classes, className)}>
      {"pulse" in meta && meta.pulse ? (
        <span className="mr-0.5 inline-block size-1.5 animate-pulse rounded-full bg-current" aria-hidden />
      ) : null}
      {meta.label}
    </Badge>
  );
}

export function ModalityIcon({ modality, className }: { modality: string; className?: string }) {
  const map: Record<string, ReactNode> = {
    text: <FileText aria-hidden className={cn("size-4 text-emerald-400/80", className)} />,
    document: <FileScan aria-hidden className={cn("size-4 text-amber-400/80", className)} />,
    image: <ImageIcon aria-hidden className={cn("size-4 text-rose-400/80", className)} />,
    audio: <AudioLines aria-hidden className={cn("size-4 text-zinc-300", className)} />,
  };
  return <span className="inline-flex">{map[modality] ?? <FileText aria-hidden className={cn("size-4", className)} />}</span>;
}

export function DirectionIcon({ direction, className }: { direction: SignalDirection; className?: string }) {
  if (direction === "ai_indicator") {
    return (
      <span className={cn("inline-flex items-center gap-1 text-rose-400", className)}>
        <svg aria-hidden className="size-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 12 L14 3" />
          <path d="M8.5 3 H14 V8.5" />
        </svg>
        <span className="sr-only">AI indicator</span>
      </span>
    );
  }
  if (direction === "human_indicator") {
    return (
      <span className={cn("inline-flex items-center gap-1 text-emerald-400", className)}>
        <svg aria-hidden className="size-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 4 L14 13" />
          <path d="M14 7.5 V13 H8.5" />
        </svg>
        <span className="sr-only">Human indicator</span>
      </span>
    );
  }
  return (
    <span className={cn("inline-flex items-center gap-1 text-zinc-500", className)}>
      <svg aria-hidden className="size-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <path d="M2 8 H14" />
      </svg>
      <span className="sr-only">Neutral</span>
    </span>
  );
}

export function ServiceDot({ status, className }: { status: string; className?: string }) {
  const ok = status === "ok" || status === "operational" || status === "loaded";
  const down = status === "error" || status === "failed" || status === "unreachable";
  return (
    <span
      role="img"
      aria-label={`Status: ${status}`}
      className={cn(
        "inline-block size-2 rounded-full",
        ok ? "bg-emerald-400" : down ? "bg-rose-400" : "bg-amber-400",
        className
      )}
    />
  );
}

/* ------------------------------- honest scores ------------------------------- */

const TONE_FILL: Record<"emerald" | "rose" | "amber" | "zinc", string> = {
  emerald: "bg-emerald-500",
  rose: "bg-rose-500",
  amber: "bg-amber-500",
  zinc: "bg-zinc-500",
};

const TONE_TEXT: Record<"emerald" | "rose" | "amber" | "zinc", string> = {
  emerald: "text-emerald-400",
  rose: "text-rose-400",
  amber: "text-amber-400",
  zinc: "text-zinc-300",
};

export function HonestCaption({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("mt-1 text-[11px] leading-tight text-muted-foreground", className)}>{children}</p>;
}

/** Horizontal likelihood bar with explicit numeric value — never implies certainty. */
export function ScoreBar({
  value,
  tone = "zinc",
  label,
  caption,
  className,
}: {
  /** 0..1 */
  value: number | null | undefined;
  tone?: keyof typeof TONE_FILL;
  label?: string;
  caption?: ReactNode;
  className?: string;
}) {
  const clamped = value === null || value === undefined || Number.isNaN(value) ? null : Math.min(1, Math.max(0, value));
  return (
    <div className={className}>
      {label ? <div className="mb-1 text-xs font-medium text-muted-foreground">{label}</div> : null}
      <div className="flex items-center gap-3">
        <div
          role="meter"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={clamped === null ? undefined : Math.round(clamped * 100)}
          aria-label={label ?? "Score"}
          className="h-2.5 w-full overflow-hidden rounded-full bg-muted"
        >
          {clamped !== null ? (
            <div className={cn("h-full rounded-full transition-all", TONE_FILL[tone])} style={{ width: `${clamped * 100}%` }} />
          ) : null}
        </div>
        <span className={cn("min-w-14 text-right text-sm font-semibold tabular-nums", clamped === null ? "text-muted-foreground" : TONE_TEXT[tone])}>
          {formatPercent(clamped)}
        </span>
      </div>
      {caption !== undefined ? (
        <HonestCaption className="mt-1">{caption ?? "Likelihood estimate — not proof."}</HonestCaption>
      ) : null}
    </div>
  );
}

export function ConfidenceBar({ value, className }: { value: number | null | undefined; className?: string }) {
  return (
    <ScoreBar
      value={value}
      tone="zinc"
      label="Confidence"
      caption="Internal consistency of detector agreement. Always below 100% — never proof."
      className={className}
    />
  );
}

/* --------------------------------- structures -------------------------------- */

export function DistributionRow({
  label,
  value,
  max,
  tone = "zinc",
  suffix,
}: {
  label: ReactNode;
  value: number;
  max: number;
  tone?: keyof typeof TONE_FILL;
  suffix?: string;
}) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-3 py-1.5">
      <div className="w-28 shrink-0 truncate text-xs text-muted-foreground sm:w-36">{label}</div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
        <div className={cn("h-full rounded-full", TONE_FILL[tone])} style={{ width: `${pct}%` }} />
      </div>
      <div className="min-w-10 text-right text-xs font-medium tabular-nums text-foreground">
        {value}
        {suffix ? <span className="text-muted-foreground"> {suffix}</span> : null}
      </div>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-6 py-12 text-center", className)}>
      <div className="text-muted-foreground/60">{icon ?? <CircleHelp aria-hidden className="size-8" />}</div>
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description ? <p className="max-w-md text-xs text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
  className,
}: {
  message: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div role="alert" className={cn("flex flex-col items-center justify-center gap-3 rounded-lg border border-rose-500/25 bg-rose-500/5 px-6 py-10 text-center", className)}>
      <AlertTriangle aria-hidden className="size-7 text-rose-400" />
      <div>
        <p className="text-sm font-medium text-foreground">Something went wrong</p>
        <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">{message}</p>
      </div>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry} className="min-h-9">
          <RefreshCcw aria-hidden className="size-3.5" /> Retry
        </Button>
      ) : null}
    </div>
  );
}

export function LoadingCards({ count = 4, className }: { count?: number; className?: string }) {
  return (
    <div className={cn("grid gap-4 sm:grid-cols-2 xl:grid-cols-4", className)}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-lg border bg-card p-6">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="mt-3 h-8 w-16" />
          <Skeleton className="mt-3 h-3 w-32" />
        </div>
      ))}
    </div>
  );
}

export function LoadingRows({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("space-y-2", className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  );
}

export function SectionHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-3", className)}>
      <div>
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        {description ? <p className="mt-0.5 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export { BadgeCheck };
