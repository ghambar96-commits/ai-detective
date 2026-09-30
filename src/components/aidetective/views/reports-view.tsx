"use client";

/**
 * AIDetective — Reports view. Lists recent completed analyses and lets the
 * analyst preview / open / download the generated JSON and HTML reports.
 */
import { useCallback, useEffect, useState } from "react";
import { Download, ExternalLink, Eye, FileSearch, FileJson2, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  downloadReport,
  fetchReportHtml,
  fetchReportJson,
  listAnalyses,
  openHtmlReport,
} from "@/lib/api/client";
import { useUiStore } from "@/stores/ui-store";
import type { AnalysisSummary, Paginated } from "@/types/api";
import {
  ClassificationBadge,
  EmptyState,
  ErrorState,
  formatPercent,
  LoadingRows,
  ModalityIcon,
  RelativeTime,
} from "../shared";

interface ReportContent {
  html: string;
  json: string;
  loading: boolean;
}

export function ReportsView() {
  const navigate = useUiStore((s) => s.navigate);
  const [data, setData] = useState<Paginated<AnalysisSummary> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [content, setContent] = useState<ReportContent>({ html: "", json: "", loading: false });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await listAnalyses({ status: "completed", page: 1, pageSize: 25, sort: "createdAt", order: "desc" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load completed analyses");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openReport = async (id: string) => {
    setOpenId(id);
    setContent({ html: "", json: "", loading: true });
    try {
      const [html, json] = await Promise.all([fetchReportHtml(id), fetchReportJson(id)]);
      setContent({ html, json: JSON.stringify(json, null, 2), loading: false });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load report");
      setOpenId(null);
    }
  };

  const download = (id: string, format: "json" | "html") => {
    downloadReport(id, format).catch((err: unknown) =>
      toast.error(err instanceof Error ? err.message : "Download failed")
    );
  };

  const activeItem = data?.items.find((item) => item.id === openId);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-6">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              Reports are generated on demand from completed analyses as self-contained JSON or
              printable HTML. Nothing is generated until you open or download one.
            </p>
          </div>
          {error ? (
            <ErrorState message={error} onRetry={() => void load()} />
          ) : loading ? (
            <LoadingRows rows={5} />
          ) : !data || data.items.length === 0 ? (
            <EmptyState
              icon={<FileSearch aria-hidden className="size-8" />}
              title="No completed analyses to report on"
              description="Run an analysis first — completed runs become available here for report generation."
              action={
                <Button size="sm" className="min-h-11" onClick={() => navigate("analyzer-text")}>
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
                    <TableHead className="text-right">Completed</TableHead>
                    <TableHead className="text-right">Report</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>
                        <button
                          type="button"
                          onClick={() => navigate("analysis-detail", { detailId: item.id })}
                          className="flex min-h-11 items-center gap-2 rounded text-left outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/60"
                        >
                          <ModalityIcon modality={item.modality} />
                          <span className="max-w-52 truncate text-sm font-medium">
                            {item.fileName ?? "Inline text"}
                          </span>
                        </button>
                      </TableCell>
                      <TableCell>
                        <ClassificationBadge classification={item.classification} />
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums">
                        {formatPercent(item.likelihoodScore)}
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        <RelativeTime iso={item.completedAt ?? item.createdAt} />
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1.5">
                          <Button
                            variant="outline"
                            size="sm"
                            className="min-h-11"
                            onClick={() => void openReport(item.id)}
                            aria-label={`Preview report for ${item.fileName ?? item.id}`}
                          >
                            <Eye aria-hidden className="size-3.5" /> Preview
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="min-h-11 min-w-11"
                            aria-label={`Open HTML report in new tab for ${item.fileName ?? item.id}`}
                            onClick={() => openHtmlReport(item.id)}
                          >
                            <ExternalLink aria-hidden className="size-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="min-h-11 min-w-11"
                            aria-label={`Download JSON report for ${item.fileName ?? item.id}`}
                            onClick={() => download(item.id, "json")}
                          >
                            <Download aria-hidden className="size-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-[11px] text-muted-foreground">
        Report contents reflect the stored analysis at generation time. All scores are likelihood
        estimates — not proof.
      </p>

      {/* Report preview dialog */}
      <Dialog open={openId !== null} onOpenChange={(open) => !open && setOpenId(null)}>
        <DialogContent
          className="max-h-[90vh] sm:max-w-3xl"
          onFocusOutside={(event) => event.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>Report preview</DialogTitle>
            <DialogDescription>
              {activeItem ? (activeItem.fileName ?? "Inline text") : ""} ·{" "}
              <span className="font-mono">{openId}</span>
            </DialogDescription>
          </DialogHeader>
          {content.loading ? (
            <div className="flex min-h-64 items-center justify-center">
              <Loader2 aria-hidden className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <Tabs defaultValue="html" className="min-h-0">
              <TabsList>
                <TabsTrigger value="html" className="min-h-9">HTML</TabsTrigger>
                <TabsTrigger value="json" className="min-h-9">JSON</TabsTrigger>
              </TabsList>
              <TabsContent value="html" className="mt-2">
                <iframe
                  title="HTML report preview"
                  srcDoc={content.html}
                  sandbox=""
                  className="h-[55vh] w-full rounded-md border bg-white"
                />
              </TabsContent>
              <TabsContent value="json" className="mt-2">
                <div className="max-h-[55vh] overflow-auto rounded-md border bg-zinc-950/80 p-3">
                  <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-zinc-300">
                    {content.json}
                  </pre>
                </div>
              </TabsContent>
            </Tabs>
          )}
          <DialogFooter className="flex-wrap gap-2 sm:justify-between">
            <Button variant="outline" size="sm" className="min-h-11" onClick={() => openId && openHtmlReport(openId)}>
              <ExternalLink aria-hidden className="size-3.5" /> Open HTML in new tab
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="min-h-11" onClick={() => openId && download(openId, "json")}>
                <FileJson2 aria-hidden className="size-3.5" /> JSON
              </Button>
              <Button size="sm" className="min-h-11" onClick={() => openId && download(openId, "html")}>
                <Download aria-hidden className="size-3.5" /> HTML
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
