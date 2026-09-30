"use client";

/**
 * AIDetective — full analysis result panel (used by the Analyzer and the
 * Analysis Detail view). Renders verdict + honest bars, summary, warnings,
 * errors, detector runs, grouped signals with expandable evidence, optional
 * LLM interpretation and report actions.
 */
import { useMemo, useState } from "react";
import {
  BotMessageSquare,
  ChevronDown,
  Copy,
  Download,
  ExternalLink,
  FileJson2,
  Info,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ClassificationBadge,
  ConfidenceBar,
  DirectionIcon,
  formatDateTime,
  formatDuration,
  formatPercent,
  ModalityIcon,
  ScoreBar,
  StatusBadge,
} from "./shared";
import { downloadReport, fetchReportJson, openHtmlReport } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import type { AnalysisDetail, AnalysisSignal, DetectorRun } from "@/types/api";

const VERDICT_TONE: Record<string, "emerald" | "rose" | "amber" | "zinc"> = {
  likely_human: "emerald",
  likely_ai_generated: "rose",
  likely_synthetic: "rose",
  uncertain: "amber",
  inconclusive: "zinc",
};

export function AnalysisResult({ analysis }: { analysis: AnalysisDetail }) {
  const [jsonOpen, setJsonOpen] = useState(false);
  const [jsonLoading, setJsonLoading] = useState(false);
  const [jsonText, setJsonText] = useState("");

  const tone = VERDICT_TONE[analysis.classification ?? ""] ?? "zinc";
  const pending = analysis.status === "queued" || analysis.status === "processing";

  const groupedSignals = useMemo(() => {
    const groups = new Map<string, { detectorName: string; signals: AnalysisSignal[] }>();
    for (const run of analysis.detectorRuns) {
      groups.set(run.detectorId, { detectorName: run.detectorName, signals: [] });
    }
    for (const signal of analysis.signals) {
      const group = groups.get(signal.detectorId);
      if (group) {
        group.signals.push(signal);
      } else {
        groups.set(signal.detectorId, { detectorName: signal.detectorId, signals: [signal] });
      }
    }
    return Array.from(groups.entries());
  }, [analysis.signals, analysis.detectorRuns]);

  const showJson = async () => {
    setJsonOpen(true);
    if (jsonText) return;
    setJsonLoading(true);
    try {
      const report = await fetchReportJson(analysis.id);
      setJsonText(JSON.stringify(report, null, 2));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load JSON report");
      setJsonOpen(false);
    } finally {
      setJsonLoading(false);
    }
  };

  const copyJson = async () => {
    try {
      await navigator.clipboard.writeText(jsonText);
      toast.success("JSON report copied to clipboard");
    } catch {
      toast.error("Clipboard unavailable in this context");
    }
  };

  return (
    <div className="space-y-4">
      {/* Verdict */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center gap-2">
            <ModalityIcon modality={analysis.modality} />
            <CardTitle className="text-base">Analysis result</CardTitle>
            <StatusBadge status={analysis.status} />
            {analysis.fileName ? (
              <span className="max-w-full truncate rounded bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground">
                {analysis.fileName}
              </span>
            ) : null}
          </div>
          <CardDescription>
            ID <span className="font-mono text-[11px]">{analysis.id}</span> · created{" "}
            {formatDateTime(analysis.createdAt)}
            {analysis.processingTime !== null
              ? ` · processed in ${formatDuration(analysis.processingTime)}`
              : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {pending ? (
            <div className="flex items-center gap-2 text-sm text-amber-400">
              <span className="inline-block size-2 animate-pulse rounded-full bg-amber-400" aria-hidden />
              Analysis {analysis.status} — results will appear when processing completes.
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm text-muted-foreground">Verdict:</span>
                <ClassificationBadge classification={analysis.classification} />
                {analysis.classification === null && analysis.status === "failed" ? (
                  <span className="text-xs text-muted-foreground">No verdict — see errors below.</span>
                ) : null}
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <ScoreBar
                  value={analysis.likelihoodScore}
                  tone={tone}
                  label="Likelihood AI-generated"
                  caption="Likelihood estimate — not proof."
                />
                <ConfidenceBar value={analysis.confidence} />
              </div>
              {analysis.summary ? (
                <p className="rounded-md border bg-muted/40 p-3 text-sm leading-relaxed text-foreground/90">
                  {analysis.summary}
                </p>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>

      {/* Warnings & errors */}
      {analysis.warnings.length > 0 ? (
        <Alert className="border-amber-500/30 bg-amber-500/5 text-amber-300 [&>svg]:text-amber-400">
          <TriangleAlert aria-hidden />
          <AlertTitle>Warnings</AlertTitle>
          <AlertDescription>
            <ul className="list-disc space-y-1 pl-4">
              {analysis.warnings.map((warning, i) => (
                <li key={i}>{warning}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}
      {analysis.errors.length > 0 ? (
        <Alert variant="destructive">
          <TriangleAlert aria-hidden />
          <AlertTitle>Errors</AlertTitle>
          <AlertDescription>
            <ul className="list-disc space-y-1 pl-4">
              {analysis.errors.map((error, i) => (
                <li key={i}>{error}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      {/* Detector runs */}
      {analysis.detectorRuns.length > 0 ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Detector runs</CardTitle>
            <CardDescription>
              {analysis.detectorRuns.length} detectors executed. Individual detector failures are
              isolated and never silently ignored.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Detector</TableHead>
                    <TableHead>Version</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Duration</TableHead>
                    <TableHead>Summary</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {analysis.detectorRuns.map((run: DetectorRun) => (
                    <TableRow key={run.id}>
                      <TableCell className="max-w-48 truncate font-medium">{run.detectorName}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{run.version}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px] text-muted-foreground">
                          {run.source}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {run.status === "ok" ? (
                          <span className="text-xs font-medium text-emerald-400">ok</span>
                        ) : (
                          <span className="text-xs font-medium text-rose-400" title={run.error ?? undefined}>
                            {run.status}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatDuration(run.durationMs)}</TableCell>
                      <TableCell className="max-w-72 truncate text-xs text-muted-foreground">
                        {run.error ?? run.summary ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Signals grouped by detector */}
      {groupedSignals.length > 0 ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Signals</CardTitle>
            <CardDescription>
              Raw detector observations. AI indicators lean toward generated content, human
              indicators lean away. Expand a signal to inspect its evidence.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {groupedSignals.map(([detectorId, group]) => (
              <section key={detectorId} aria-label={`Signals from ${group.detectorName}`}>
                <div className="mb-2 flex items-center gap-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {group.detectorName}
                  </h3>
                  <span className="font-mono text-[10px] text-muted-foreground/60">{detectorId}</span>
                </div>
                <div className="space-y-2">
                  {group.signals.map((signal) => (
                    <SignalRow key={signal.id} signal={signal} />
                  ))}
                </div>
              </section>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {/* LLM interpretation */}
      {analysis.llmInterpretation ? (
        <Card className="border-emerald-500/20">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <BotMessageSquare aria-hidden className="size-4 text-emerald-400" />
              <CardTitle className="text-sm">LLM interpretation</CardTitle>
              <Badge variant="outline" className="text-[10px] text-muted-foreground">
                {analysis.llmProvider}
                {analysis.llmModel ? ` · ${analysis.llmModel}` : ""}
              </Badge>
            </div>
            <CardDescription className="flex items-center gap-1">
              <Info aria-hidden className="size-3" />
              Explanation only — did not influence the verdict.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
              {analysis.llmInterpretation}
            </p>
          </CardContent>
        </Card>
      ) : null}

      {/* Report actions */}
      {!pending ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={showJson} className="min-h-11">
            <FileJson2 aria-hidden className="size-4" /> View JSON report
          </Button>
          <Button variant="outline" size="sm" onClick={() => openHtmlReport(analysis.id)} className="min-h-11">
            <ExternalLink aria-hidden className="size-4" /> HTML report
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              downloadReport(analysis.id, "json").catch((error: unknown) =>
                toast.error(error instanceof Error ? error.message : "Download failed")
              )
            }
            className="min-h-11"
          >
            <Download aria-hidden className="size-4" /> Download JSON
          </Button>
        </div>
      ) : null}

      {/* JSON report dialog */}
      <Dialog open={jsonOpen} onOpenChange={setJsonOpen}>
        <DialogContent className="max-h-[85vh] sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>JSON report</DialogTitle>
            <DialogDescription>
              Structured report for analysis <span className="font-mono">{analysis.id}</span>.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[55vh] overflow-auto rounded-md border bg-zinc-950/80 p-3">
            {jsonLoading ? (
              <p className="text-xs text-muted-foreground">Loading report…</p>
            ) : (
              <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-zinc-300">
                {jsonText}
              </pre>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={copyJson} disabled={jsonLoading}>
              <Copy aria-hidden className="size-3.5" /> Copy
            </Button>
            <Button
              size="sm"
              onClick={() =>
                downloadReport(analysis.id, "json").catch((error: unknown) =>
                  toast.error(error instanceof Error ? error.message : "Download failed")
                )
              }
            >
              <Download aria-hidden className="size-3.5" /> Download
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SignalRow({ signal }: { signal: AnalysisSignal }) {
  const [open, setOpen] = useState(false);
  const hasDetails = Boolean((signal.evidence && signal.evidence.length > 0) || signal.notes);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className={cn("rounded-md border bg-card/60", open && "bg-card")}>
        <CollapsibleTrigger
          className={cn(
            "flex w-full items-center gap-2 px-3 py-2.5 text-left outline-none transition-colors",
            "min-h-11 rounded-md focus-visible:ring-2 focus-visible:ring-ring/60",
            hasDetails && "hover:bg-accent/50"
          )}
          disabled={!hasDetails}
          aria-expanded={open}
        >
          <DirectionIcon direction={signal.direction} />
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{signal.name}</span>
          <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
            weight <span className="tabular-nums">{signal.weight.toFixed(2)}</span>
          </span>
          <span
            className={cn(
              "shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold tabular-nums",
              signal.direction === "ai_indicator"
                ? "bg-rose-500/10 text-rose-400"
                : signal.direction === "human_indicator"
                  ? "bg-emerald-500/10 text-emerald-400"
                  : "bg-muted text-zinc-400"
            )}
          >
            AI {formatPercent(signal.aiScore, 0)}
          </span>
          {hasDetails ? (
            <ChevronDown
              aria-hidden
              className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
            />
          ) : (
            <span className="w-4 shrink-0" aria-hidden />
          )}
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="space-y-3 border-t px-3 py-3">
            <p className="text-xs leading-relaxed text-muted-foreground">{signal.description}</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>
                Observed value:{" "}
                <span className="font-medium text-foreground tabular-nums">
                  {typeof signal.value === "number" ? Number(signal.value.toFixed(4)) : signal.value}
                  {signal.unit ? ` ${signal.unit}` : ""}
                </span>
              </span>
              <span>
                Weight: <span className="font-medium text-foreground tabular-nums">{signal.weight.toFixed(2)}</span>
              </span>
              <span>
                AI score: <span className="font-medium text-foreground tabular-nums">{formatPercent(signal.aiScore)}</span>
              </span>
            </div>
            {signal.evidence && signal.evidence.length > 0 ? (
              <div className="space-y-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">
                  Evidence
                </p>
                {signal.evidence.map((item, i) => (
                  <div key={i} className="rounded border bg-muted/30 px-2.5 py-2">
                    <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                      <Badge variant="secondary" className="px-1 py-0 text-[9px] uppercase">
                        {item.kind}
                      </Badge>
                      {item.label}
                    </div>
                    <blockquote className="mt-1 border-l-2 border-border pl-2 font-mono text-[11px] leading-relaxed text-foreground/85">
                      “{item.content}”
                    </blockquote>
                  </div>
                ))}
              </div>
            ) : null}
            {signal.notes ? (
              <p className="text-xs leading-relaxed text-amber-300/90">
                <span className="font-semibold">Note:</span> {signal.notes}
              </p>
            ) : null}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
