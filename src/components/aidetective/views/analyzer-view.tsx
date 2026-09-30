"use client";

/**
 * AIDetective — Analyzer view: four tabs (Text / Image / Audio / Files).
 * Inline text analysis + file upload with queue polling, detector selection,
 * optional LLM interpretation, and honest result rendering.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  CircleStop,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  analyzeFile,
  analyzeText,
  getAnalysis,
  getDetectors,
} from "@/lib/api/client";
import { useUiStore, type ViewId } from "@/stores/ui-store";
import { cn } from "@/lib/utils";
import type { AnalysisDetail, AnalysisOptions, DetectorInfo } from "@/types/api";
import { AnalysisResult } from "../analysis-result";
import { formatBytes } from "../shared";

type TabKey = "text" | "image" | "audio" | "files";

const TAB_MODALITY: Record<TabKey, string> = {
  text: "text",
  image: "image",
  audio: "audio",
  files: "document",
};

const TAB_ACCEPT: Record<Exclude<TabKey, "text">, string> = {
  image: "image/*",
  audio: "audio/*",
  files: ".pdf,.docx,.txt,.md,application/pdf,text/plain",
};

const VIEW_TO_TAB: Record<string, TabKey> = {
  "analyzer-text": "text",
  "analyzer-image": "image",
  "analyzer-audio": "audio",
  "analyzer-files": "files",
};

const SAMPLE_SENTENCE =
  "In today's ever-evolving landscape, artificial intelligence plays a crucial role. Moreover, it is important to note that these systems unlock the potential of seamless integration.";

export function AnalyzerView() {
  const activeView = useUiStore((s) => s.activeView);
  const navigate = useUiStore((s) => s.navigate);
  const tab = VIEW_TO_TAB[activeView] ?? "text";

  const [detectors, setDetectors] = useState<DetectorInfo[] | null>(null);
  const [detectorsError, setDetectorsError] = useState<string | null>(null);
  const [disabledDetectors, setDisabledDetectors] = useState<Set<string>>(new Set());
  const [useLlm, setUseLlm] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);

  // text tab
  const [text, setText] = useState("");
  const [analyzingText, setAnalyzingText] = useState(false);

  // file tabs
  const [files, setFiles] = useState<Partial<Record<Exclude<TabKey, "text">, File | null>>>({});
  const [uploading, setUploading] = useState(false);

  const [results, setResults] = useState<Record<TabKey, AnalysisDetail | null>>({
    text: null,
    image: null,
    audio: null,
    files: null,
  });

  const pollRef = useRef<number | null>(null);
  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  const loadDetectors = useCallback(async () => {
    setDetectorsError(null);
    try {
      const res = await getDetectors();
      setDetectors(res.detectors.filter((d) => d.enabled));
    } catch (err) {
      setDetectorsError(err instanceof Error ? err.message : "Failed to load detectors");
    }
  }, []);

  useEffect(() => {
    void loadDetectors();
  }, [loadDetectors]);

  const visibleDetectors = useMemo(() => {
    if (!detectors) return [];
    const modality = TAB_MODALITY[tab];
    return detectors.filter((d) => d.modalities.includes(modality as DetectorInfo["modalities"][number]));
  }, [detectors, tab]);

  const buildOptions = (tabKey: TabKey): AnalysisOptions => {
    const modality = TAB_MODALITY[tabKey];
    const allForModality = (detectors ?? [])
      .filter((d) => d.modalities.includes(modality as DetectorInfo["modalities"][number]))
      .map((d) => d.id);
    const selected = allForModality.filter((id) => !disabledDetectors.has(id));
    return {
      ...(selected.length !== allForModality.length ? { detectors: selected } : {}),
      useLlm,
    };
  };

  const setResult = (tabKey: TabKey, detail: AnalysisDetail | null) =>
    setResults((prev) => ({ ...prev, [tabKey]: detail }));

  const analyzeTextNow = async () => {
    const content = text.trim();
    if (!content) return;
    stopPolling();
    setAnalyzingText(true);
    setResult("text", null);
    try {
      const detail = await analyzeText(content, buildOptions("text"));
      setResult("text", detail);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Analysis failed");
    } finally {
      setAnalyzingText(false);
    }
  };

  const startFileAnalysis = async (tabKey: Exclude<TabKey, "text">, file: File) => {
    stopPolling();
    setUploading(true);
    setResult(tabKey, null);
    try {
      const queued = await analyzeFile(file, buildOptions(tabKey));
      setResult(tabKey, queued);
      if (queued.status === "completed") return;
      const id = queued.id;
      pollRef.current = window.setInterval(async () => {
        try {
          const detail = await getAnalysis(id);
          setResult(tabKey, detail);
          if (detail.status === "completed" || detail.status === "failed") {
            stopPolling();
          }
        } catch (err) {
          stopPolling();
          toast.error(err instanceof Error ? err.message : "Failed to fetch analysis status");
        }
      }, 1500);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const activeResult = results[tab];
  const pendingResult = activeResult && (activeResult.status === "queued" || activeResult.status === "processing");

  return (
    <div className="space-y-4">
      <Tabs
        value={tab}
        onValueChange={(value) => navigate(`analyzer-${value as TabKey}` as ViewId)}
      >
        <TabsList aria-label="Analyzer input type" className="h-11 w-full justify-start overflow-x-auto sm:w-auto">
          <TabsTrigger value="text" className="min-h-9 px-4">Text</TabsTrigger>
          <TabsTrigger value="image" className="min-h-9 px-4">Image</TabsTrigger>
          <TabsTrigger value="audio" className="min-h-9 px-4">Audio</TabsTrigger>
          <TabsTrigger value="files" className="min-h-9 px-4">Files</TabsTrigger>
        </TabsList>

        {/* Text tab */}
        <TabsContent value="text" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Inline text analysis</CardTitle>
              <CardDescription>
                Paste text and run the heuristic detectors. Around 8+ sentences give the most
                meaningful verdicts; short texts often yield an honest &quot;uncertain&quot;.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="analyzer-text-input" className="sr-only">
                  Text to analyze
                </Label>
                <Textarea
                  id="analyzer-text-input"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={`Paste text here, e.g.\n\n${SAMPLE_SENTENCE}`}
                  className="min-h-44 resize-y font-mono text-sm"
                  aria-describedby="analyzer-text-count"
                />
                <div id="analyzer-text-count" className="flex justify-between text-xs text-muted-foreground">
                  <span>
                    {text.trim() ? text.trim().split(/\s+/).length : 0} words · {text.length} chars
                  </span>
                  <button
                    type="button"
                    className="underline-offset-2 hover:underline"
                    onClick={() => setText(SAMPLE_SENTENCE)}
                  >
                    Insert sample AI-styled text
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  onClick={() => void analyzeTextNow()}
                  disabled={analyzingText || !text.trim()}
                  className="min-h-11"
                >
                  {analyzingText ? (
                    <>
                      <Loader2 aria-hidden className="size-4 animate-spin" /> Analyzing…
                    </>
                  ) : (
                    <>
                      <Sparkles aria-hidden className="size-4" /> Analyze text
                    </>
                  )}
                </Button>
                {text ? (
                  <Button variant="ghost" onClick={() => setText("")} className="min-h-11">
                    Clear
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>
          <OptionsPanel
            open={optionsOpen}
            onOpenChange={setOptionsOpen}
            detectors={visibleDetectors}
            detectorsError={detectorsError}
            onRetryDetectors={() => void loadDetectors()}
            disabledDetectors={disabledDetectors}
            onToggleDetector={(id, checked) =>
              setDisabledDetectors((prev) => {
                const next = new Set(prev);
                if (checked) next.delete(id);
                else next.add(id);
                return next;
              })
            }
            useLlm={useLlm}
            onUseLlmChange={setUseLlm}
          />
        </TabsContent>

        {/* File tabs */}
        {(["image", "audio", "files"] as const).map((tabKey) => (
          <TabsContent key={tabKey} value={tabKey} className="mt-4 space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">
                  {tabKey === "image"
                    ? "Image analysis"
                    : tabKey === "audio"
                      ? "Audio analysis"
                      : "Document / file analysis"}
                </CardTitle>
                <CardDescription>
                  {tabKey === "image"
                    ? "PNG/JPEG metadata, compression and pixel statistics. Images are queued and analyzed in the background."
                    : tabKey === "audio"
                      ? "Container metadata + waveform statistics (WAV PCM is fully analyzed; other containers are metadata-only)."
                      : "PDF, DOCX, TXT and MD files — text is extracted and run through the text detectors."}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Dropzone
                  accept={TAB_ACCEPT[tabKey]}
                  label={
                    tabKey === "image"
                      ? "Drop an image here or click to browse"
                      : tabKey === "audio"
                        ? "Drop an audio file here or click to browse"
                        : "Drop a document here or click to browse"
                  }
                  file={files[tabKey] ?? null}
                  onFile={(file) => {
                    setFiles((prev) => ({ ...prev, [tabKey]: file }));
                    void startFileAnalysis(tabKey, file);
                  }}
                  onClear={() => {
                    stopPolling();
                    setFiles((prev) => ({ ...prev, [tabKey]: null }));
                    setResult(tabKey, null);
                  }}
                  disabled={uploading}
                />
                {uploading ? (
                  <p className="flex items-center gap-2 text-sm text-amber-400">
                    <Loader2 aria-hidden className="size-4 animate-spin" /> Uploading…
                  </p>
                ) : null}
                {pendingResult ? (
                  <p className="flex items-center gap-2 text-sm text-amber-400" role="status">
                    <span className="inline-block size-2 animate-pulse rounded-full bg-amber-400" aria-hidden />
                    {results[tabKey]?.status === "queued"
                      ? "Queued → Processing…"
                      : "Processing… this page polls every 1.5 s until the analysis completes."}
                  </p>
                ) : null}
              </CardContent>
            </Card>
            <OptionsPanel
              open={optionsOpen}
              onOpenChange={setOptionsOpen}
              detectors={visibleDetectors}
              detectorsError={detectorsError}
              onRetryDetectors={() => void loadDetectors()}
              disabledDetectors={disabledDetectors}
              onToggleDetector={(id, checked) =>
                setDisabledDetectors((prev) => {
                  const next = new Set(prev);
                  if (checked) next.delete(id);
                  else next.add(id);
                  return next;
                })
              }
              useLlm={useLlm}
              onUseLlmChange={setUseLlm}
            />
          </TabsContent>
        ))}
      </Tabs>

      {/* Result */}
      {activeResult ? (
        <section aria-label="Analysis result">
          <AnalysisResult analysis={activeResult} />
        </section>
      ) : null}
    </div>
  );
}

/* --------------------------------- options ---------------------------------- */

interface OptionsPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  detectors: DetectorInfo[];
  detectorsError: string | null;
  onRetryDetectors: () => void;
  disabledDetectors: Set<string>;
  onToggleDetector: (id: string, checked: boolean) => void;
  useLlm: boolean;
  onUseLlmChange: (value: boolean) => void;
}

function OptionsPanel({
  open,
  onOpenChange,
  detectors,
  detectorsError,
  onRetryDetectors,
  disabledDetectors,
  onToggleDetector,
  useLlm,
  onUseLlmChange,
}: OptionsPanelProps) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <Card>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex min-h-11 w-full items-center gap-2 rounded-t-lg px-6 py-4 text-left outline-none hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring/60"
            aria-expanded={open}
          >
            <span className="flex-1">
              <span className="block text-sm font-semibold">Options</span>
              <span className="block text-xs text-muted-foreground">
                Detector selection, weights and optional LLM interpretation
              </span>
            </span>
            <ChevronDown
              aria-hidden
              className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-180")}
            />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="space-y-5 border-t pt-4">
            <div>
              <div className="mb-2 flex items-center justify-between">
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Detectors ({detectors.length})
                </Label>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="min-h-8"
                    onClick={() => detectors.forEach((d) => onToggleDetector(d.id, true))}
                  >
                    <Plus aria-hidden className="size-3.5" /> Enable all
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="min-h-8"
                    onClick={() => detectors.forEach((d) => onToggleDetector(d.id, false))}
                  >
                    <CircleStop aria-hidden className="size-3.5" /> Disable all
                  </Button>
                </div>
              </div>
              {detectorsError ? (
                <div className="flex items-center gap-2 rounded-md border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-300">
                  {detectorsError}
                  <Button variant="outline" size="sm" className="ml-auto min-h-8" onClick={onRetryDetectors}>
                    Retry
                  </Button>
                </div>
              ) : detectors.length === 0 ? (
                <Skeleton className="h-24 w-full" />
              ) : (
                <ul className="max-h-72 space-y-1 overflow-y-auto rounded-md border p-2 pr-2 [scrollbar-width:thin]">
                  {detectors.map((detector) => (
                    <li key={detector.id}>
                      <label className="flex min-h-11 cursor-pointer items-start gap-2.5 rounded-md px-2 py-2 hover:bg-accent/50">
                        <Checkbox
                          checked={!disabledDetectors.has(detector.id)}
                          onCheckedChange={(checked) => onToggleDetector(detector.id, checked === true)}
                          className="mt-0.5"
                          aria-label={`Use detector ${detector.name}`}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-1.5">
                            <span className="text-sm font-medium">{detector.name}</span>
                            <Badge
                              variant="outline"
                              className={cn(
                                "px-1 py-0 text-[9px] uppercase",
                                detector.source === "plugin"
                                  ? "border-emerald-500/40 text-emerald-400"
                                  : "border-zinc-500/40 text-zinc-400"
                              )}
                            >
                              {detector.source}
                            </Badge>
                          </span>
                          <span className="mt-0.5 block text-xs text-muted-foreground">
                            weight {detector.defaultWeight.toFixed(2)} · {detector.description}
                          </span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="flex items-center gap-3 rounded-md border p-3">
              <Switch id="use-llm" checked={useLlm} onCheckedChange={onUseLlmChange} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="use-llm" className="text-sm font-medium">
                    LLM interpretation
                  </Label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        aria-label="About LLM interpretation"
                        className="inline-flex size-5 items-center justify-center rounded-full border text-[10px] text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                      >
                        ?
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="right" className="max-w-64">
                      Optional. Adds a human-readable explanation. Never decides the verdict.
                    </TooltipContent>
                  </Tooltip>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Adds a plain-language reading of the signals. It cannot change the classification.
                </p>
              </div>
            </div>

            <p className="text-[11px] leading-relaxed text-muted-foreground">
              All detectors are heuristic baselines. Results are likelihood estimates — not proof —
              and may produce false positives/negatives.
            </p>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

/* --------------------------------- dropzone ---------------------------------- */

function Dropzone({
  accept,
  label,
  file,
  onFile,
  onClear,
  disabled,
}: {
  accept: string;
  label: string;
  file: File | null;
  onFile: (file: File) => void;
  onClear: () => void;
  disabled?: boolean;
}) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const pick = () => inputRef.current?.click();

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="sr-only"
        aria-label={label}
        onChange={(e) => {
          const selected = e.target.files?.[0];
          if (selected) onFile(selected);
          e.target.value = "";
        }}
      />
      {file ? (
        <div className="flex min-h-11 items-center gap-3 rounded-md border bg-muted/40 px-3 py-2.5">
          <UploadCloud aria-hidden className="size-5 shrink-0 text-emerald-400" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{file.name}</p>
            <p className="text-xs text-muted-foreground">
              {formatBytes(file.size)} · {file.type || "unknown type"}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Remove ${file.name}`}
            onClick={onClear}
            className="min-h-11 min-w-11 text-muted-foreground hover:text-rose-400"
          >
            <Trash2 aria-hidden className="size-4" />
          </Button>
        </div>
      ) : (
        <div
          role="button"
          tabIndex={disabled ? -1 : 0}
          aria-label={label}
          onClick={() => !disabled && pick()}
          onKeyDown={(e) => {
            if (!disabled && (e.key === "Enter" || e.key === " ")) {
              e.preventDefault();
              pick();
            }
          }}
          onDragOver={(e) => {
            e.preventDefault();
            if (!disabled) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (disabled) return;
            const dropped = e.dataTransfer.files?.[0];
            if (dropped) onFile(dropped);
          }}
          className={cn(
            "flex min-h-32 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 text-center outline-none transition-colors",
            "focus-visible:ring-2 focus-visible:ring-ring/60",
            dragging
              ? "border-emerald-400 bg-emerald-500/10 text-emerald-300"
              : "border-border text-muted-foreground hover:border-emerald-500/40 hover:bg-accent/30",
            disabled && "pointer-events-none opacity-60"
          )}
        >
          <UploadCloud aria-hidden className="size-8" />
          <p className="text-sm font-medium">{label}</p>
          <p className="text-xs text-muted-foreground">
            Files are uploaded, queued and analyzed in the background.
          </p>
        </div>
      )}
    </div>
  );
}
