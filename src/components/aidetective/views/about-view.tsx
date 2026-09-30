"use client";

/**
 * AIDetective — About & Architecture view.
 * Explains honestly what the platform is, what it is NOT, how an analysis
 * flows through the engine, how scoring works, and what every detector
 * actually measures (with its real limitations, fetched live from the API).
 */
import { useEffect, useState } from "react";
import {
  ArrowRight,
  BookOpenText,
  CircleHelp,
  FileCode2,
  FileText,
  Info,
  ShieldAlert,
  Workflow,
} from "lucide-react";

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
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getDetectors, getSystemStatus } from "@/lib/api/client";
import { ModalityIcon } from "../shared";
import { cn } from "@/lib/utils";
import type { DetectorInfo, SystemStatus } from "@/types/api";

const PIPELINE_STAGES = [
  { label: "Input", detail: "Text pasted in the Analyzer, or a file uploaded via the Dashboard / REST API" },
  { label: "Orchestrator", detail: "Validates input, routes by modality, enqueues file work (in-memory FIFO queue)" },
  { label: "Feature extraction", detail: "Text statistics · image EXIF/compression/pixels · audio container + waveform" },
  { label: "Detectors", detail: "Independent heuristic detectors vote with weighted, directional signals" },
  { label: "Scoring engine", detail: "Weighted evidence → likelihood score + consistency-based confidence (always < 100%)" },
  { label: "Optional LLM", detail: "Plain-language explanation only — it can never change the verdict" },
  { label: "Report + storage", detail: "Structured JSON / printable HTML report, persisted for history and export" },
];

export function AboutView() {
  const [detectors, setDetectors] = useState<DetectorInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [det, sys] = await Promise.all([
          getDetectors(),
          getSystemStatus().catch(() => null),
        ]);
        if (cancelled) return;
        setDetectors(det.detectors);
        setVersion((sys as { version?: string } | null)?.version ?? null);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load detector registry");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-4">
      {/* What it is / is not */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <BookOpenText aria-hidden className="size-4 text-emerald-400" />
            <CardTitle className="text-base">What is AIDetective?</CardTitle>
          </div>
          <CardDescription>
            {version ? (
              <>
                Version <span className="font-mono text-xs">{version}</span> ·{" "}
              </>
            ) : null}
            An open-source, local-first multimodal content analysis platform.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-md border border-emerald-500/25 bg-emerald-500/5 p-3">
              <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-emerald-400">
                <Info aria-hidden className="size-4" /> What it does
              </p>
              <ul className="list-disc space-y-1 pl-4 text-sm leading-relaxed text-foreground/90">
                <li>Analyzes text, images, audio and documents for signals associated with AI-generated or synthetic content.</li>
                <li>Produces a <span className="font-medium">likelihood estimate</span> with a confidence value, per-detector signals and inspectable evidence.</li>
                <li>Explains every verdict: you can always see <em>which</em> detector contributed what, and why.</li>
                <li>Treats <span className="font-medium">&ldquo;uncertain&rdquo;</span> and <span className="font-medium">&ldquo;inconclusive&rdquo;</span> as first-class, honest outcomes.</li>
                <li>Exposes the exact same engine through a versioned REST API (<span className="font-mono text-xs">/api/v1</span>) with OpenAPI docs.</li>
                <li>Runs fully local without any LLM; optional LLM integration adds explanations only.</li>
              </ul>
            </div>
            <div className="rounded-md border border-rose-500/25 bg-rose-500/5 p-3">
              <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-rose-400">
                <ShieldAlert aria-hidden className="size-4" /> What it does NOT do
              </p>
              <ul className="list-disc space-y-1 pl-4 text-sm leading-relaxed text-foreground/90">
                <li>It is <span className="font-medium">not proof</span> of whether content was AI-generated — no tool can honestly claim that.</li>
                <li>It never outputs a fake 100% score; confidence is mathematically capped below certainty.</li>
                <li>It ships <span className="font-medium">no trained ML models</span> — all detectors are transparent heuristic baselines, so accuracy is unbenchmarked.</li>
                <li>The optional LLM never decides the verdict; it only rewrites the machine-readable evidence in prose.</li>
                <li>It does not attribute authorship, detect deepfakes, or transcribe speech.</li>
              </ul>
            </div>
          </div>
          <Alert className="border-amber-500/30 bg-amber-500/5 text-amber-300 [&>svg]:text-amber-400">
            <CircleHelp aria-hidden />
            <AlertTitle>How to read a result</AlertTitle>
            <AlertDescription>
              A high likelihood score means <span className="font-semibold">many independent heuristics agree</span>,
              not that the content is certainly AI-generated. Always combine results with human judgment and context.
              False positives and false negatives are expected — see the detector limitations below.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>

      {/* How it works */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Workflow aria-hidden className="size-4 text-emerald-400" />
            <CardTitle className="text-base">How an analysis works</CardTitle>
          </div>
          <CardDescription>
            The same pipeline serves the Dashboard and external API clients — there is no hidden path.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="space-y-0">
            {PIPELINE_STAGES.map((stage, i) => (
              <li key={stage.label} className="relative flex gap-3 pb-4 last:pb-0">
                {i < PIPELINE_STAGES.length - 1 ? (
                  <span aria-hidden className="absolute left-[13px] top-7 h-full w-px bg-border" />
                ) : null}
                <span className="z-10 flex size-7 shrink-0 items-center justify-center rounded-full border bg-card font-mono text-[11px] font-semibold text-emerald-400">
                  {i + 1}
                </span>
                <div className="min-w-0 pt-0.5">
                  <p className="text-sm font-medium">{stage.label}</p>
                  <p className="text-xs leading-relaxed text-muted-foreground">{stage.detail}</p>
                </div>
                {i < PIPELINE_STAGES.length - 1 ? (
                  <ArrowRight aria-hidden className="sr-only" />
                ) : null}
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      {/* Scoring */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <FileCode2 aria-hidden className="size-4 text-emerald-400" />
            <CardTitle className="text-base">How scoring works</CardTitle>
          </div>
          <CardDescription>Deterministic and fully explainable — no black box, no randomness.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm leading-relaxed text-foreground/90">
          <p>
            Each detector emits <span className="font-medium">signals</span>: a direction
            (<span className="font-mono text-xs">ai_indicator</span> / <span className="font-mono text-xs">human_indicator</span>),
            a weight and a 0–100 score, plus evidence you can expand in the UI.
          </p>
          <ul className="list-disc space-y-1 pl-4">
            <li><span className="font-medium">Likelihood score</span> — weighted vote of all signals, normalized to 0–100%.</li>
            <li><span className="font-medium">Classification</span> — ≥ 62% → likely AI-generated/synthetic; ≤ 42% → likely human; in between, or too few/contradictory signals → <span className="font-mono text-xs">uncertain</span>. If the pipeline cannot run meaningfully at all → <span className="font-mono text-xs">inconclusive</span>.</li>
            <li><span className="font-medium">Confidence</span> — derived from signal consistency (direction agreement) × strength (distance from neutral) × coverage; hard-capped below 1.0.</li>
            <li>Thresholds are configurable per deployment (Settings → Scoring) and are shown honestly in every report.</li>
          </ul>
          <Separator />
          <p className="text-xs text-muted-foreground">
            Same input → same output. Detector output is deterministic (verified by the automated test suite);
            only the optional LLM prose varies between runs, and it never affects the verdict.
          </p>
        </CardContent>
      </Card>

      {/* Detector registry with real limitations */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <FileText aria-hidden className="size-4 text-emerald-400" />
            <CardTitle className="text-base">Detector registry & honest limitations</CardTitle>
          </div>
          <CardDescription>
            Loaded live from <span className="font-mono text-xs">GET /api/v1/detectors</span> — this table always
            reflects the detectors actually running in your instance.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error ? (
            <div className="flex items-center gap-2 rounded-md border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-300">
              {error}
              <Button variant="outline" size="sm" className="ml-auto min-h-8" onClick={() => window.location.reload()}>
                Retry
              </Button>
            </div>
          ) : detectors === null ? (
            <p className="text-xs text-muted-foreground">Loading detector registry…</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Detector</TableHead>
                    <TableHead>Modality</TableHead>
                    <TableHead className="text-right">Weight</TableHead>
                    <TableHead className="hidden md:table-cell">What it measures</TableHead>
                    <TableHead className="hidden lg:table-cell">Known limitations</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detectors.map((detector) => (
                    <TableRow key={detector.id}>
                      <TableCell className="max-w-52">
                        <p className="truncate font-medium">{detector.name}</p>
                        <p className="font-mono text-[10px] text-muted-foreground">{detector.id}</p>
                      </TableCell>
                      <TableCell>
                        <span className="flex items-center gap-1.5 text-xs">
                          <ModalityIcon modality={detector.modalities[0]} />
                          {detector.modalities.join(", ")}
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        {detector.defaultWeight.toFixed(2)}
                      </TableCell>
                      <TableCell className="hidden max-w-72 text-xs text-muted-foreground md:table-cell">
                        {detector.description}
                      </TableCell>
                      <TableCell className="hidden max-w-80 lg:table-cell">
                        <ul className="list-disc space-y-0.5 pl-3.5 text-xs text-amber-300/80">
                          {detector.limitations.map((limitation, i) => (
                            <li key={i}>{limitation}</li>
                          ))}
                        </ul>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* More documentation */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Further documentation</CardTitle>
          <CardDescription>Shipped with the repository — no external site required.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-3">
          {[
            { href: "/api/v1/openapi", title: "OpenAPI 3.0.3 spec", desc: "Machine-readable REST contract for /api/v1" },
            { href: null, title: "docs/architecture.md", desc: "In the repository: bootstrap order, queue, data model, security" },
            { href: null, title: "docs/limitations.md", desc: "In the repository: the full, honest list of current limitations" },
          ].map((doc) => {
            const inner = (
              <>
                <p className="flex items-center gap-1.5 text-sm font-medium">
                  <FileText aria-hidden className="size-3.5 text-muted-foreground" />
                  <span className="font-mono text-[13px]">{doc.title}</span>
                  {doc.href ? (
                    <ArrowRight aria-hidden className="size-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                  ) : null}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{doc.desc}</p>
              </>
            );
            return doc.href ? (
              <a
                key={doc.title}
                href={doc.href}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  "group rounded-md border p-3 outline-none transition-colors",
                  "hover:border-emerald-500/40 hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring/60"
                )}
              >
                {inner}
              </a>
            ) : (
              <div key={doc.title} className="rounded-md border p-3">
                {inner}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* footer note */}
      <p className="flex items-center justify-center gap-1.5 pb-2 text-center text-[11px] text-muted-foreground">
        <Badge variant="outline" className="text-[9px] uppercase">honesty first</Badge>
        AIDetective is a multimodal content analysis platform — it provides probabilistic estimates, never proof.
      </p>
    </div>
  );
}
