"use client";

/**
 * AIDetective — History view: searchable, filterable, paginated analysis
 * history. Every control maps to a /api/v1/analyses query parameter.
 */
import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Eye, History as HistoryIcon, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { deleteAnalysis, listAnalyses } from "@/lib/api/client";
import { useUiStore } from "@/stores/ui-store";
import type { AnalysisSummary, Paginated } from "@/types/api";
import {
  ClassificationBadge,
  classificationLabel,
  formatDuration,
  formatPercent,
  EmptyState,
  ErrorState,
  LoadingRows,
  ModalityIcon,
  RelativeTime,
} from "../shared";

const PAGE_SIZE = 15;

interface Filters {
  modality: string;
  classification: string;
  status: string;
  from: string;
  to: string;
  sort: string;
  order: "asc" | "desc";
}

const DEFAULT_FILTERS: Filters = {
  modality: "all",
  classification: "all",
  status: "all",
  from: "",
  to: "",
  sort: "createdAt",
  order: "desc",
};

export function HistoryView() {
  const navigate = useUiStore((s) => s.navigate);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paginated<AnalysisSummary> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AnalysisSummary | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Debounce the search box.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listAnalyses({
        query: debouncedSearch || undefined,
        modality: filters.modality !== "all" ? filters.modality : undefined,
        classification: filters.classification !== "all" ? filters.classification : undefined,
        status: filters.status !== "all" ? filters.status : undefined,
        from: filters.from || undefined,
        to: filters.to || undefined,
        sort: filters.sort,
        order: filters.order,
        page,
        pageSize: PAGE_SIZE,
      });
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load history");
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, filters, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const updateFilter = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteAnalysis(deleteTarget.id);
      toast.success("Analysis deleted", { description: deleteTarget.fileName ?? deleteTarget.id });
      setDeleteTarget(null);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  };

  const totalPages = data?.totalPages ?? 1;

  return (
    <div className="space-y-4">
      {/* Filters */}
      <Card className="p-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="relative md:col-span-2 xl:col-span-1">
            <Search aria-hidden className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search filename, id, summary…"
              aria-label="Search analyses"
              className="min-h-11 pl-8"
            />
          </div>
          <Select value={filters.modality} onValueChange={(v) => updateFilter("modality", v)}>
            <SelectTrigger aria-label="Filter by modality" className="min-h-11">
              <SelectValue placeholder="Modality" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All modalities</SelectItem>
              <SelectItem value="text">Text</SelectItem>
              <SelectItem value="image">Image</SelectItem>
              <SelectItem value="audio">Audio</SelectItem>
              <SelectItem value="document">Document</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filters.classification} onValueChange={(v) => updateFilter("classification", v)}>
            <SelectTrigger aria-label="Filter by classification" className="min-h-11">
              <SelectValue placeholder="Classification" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All classifications</SelectItem>
              <SelectItem value="likely_human">Likely human</SelectItem>
              <SelectItem value="likely_ai_generated">Likely AI-generated</SelectItem>
              <SelectItem value="likely_synthetic">Likely synthetic</SelectItem>
              <SelectItem value="uncertain">Uncertain</SelectItem>
              <SelectItem value="inconclusive">Inconclusive</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filters.status} onValueChange={(v) => updateFilter("status", v)}>
            <SelectTrigger aria-label="Filter by status" className="min-h-11">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="queued">Queued</SelectItem>
              <SelectItem value="processing">Processing</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
            </SelectContent>
          </Select>
          <div className="grid grid-cols-2 gap-2 md:col-span-2">
            <label className="flex min-h-11 items-center gap-2 rounded-md border px-2.5 text-xs text-muted-foreground">
              From
              <Input
                type="date"
                value={filters.from}
                onChange={(e) => updateFilter("from", e.target.value)}
                aria-label="From date"
                className="h-8 border-0 bg-transparent p-0 text-xs"
              />
            </label>
            <label className="flex min-h-11 items-center gap-2 rounded-md border px-2.5 text-xs text-muted-foreground">
              To
              <Input
                type="date"
                value={filters.to}
                onChange={(e) => updateFilter("to", e.target.value)}
                aria-label="To date"
                className="h-8 border-0 bg-transparent p-0 text-xs"
              />
            </label>
          </div>
          <Select value={filters.sort} onValueChange={(v) => updateFilter("sort", v)}>
            <SelectTrigger aria-label="Sort field" className="min-h-11">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="createdAt">Sort: Created</SelectItem>
              <SelectItem value="likelihoodScore">Sort: Likelihood</SelectItem>
              <SelectItem value="confidence">Sort: Confidence</SelectItem>
              <SelectItem value="processingTime">Sort: Processing time</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={filters.order}
            onValueChange={(v) => updateFilter("order", v as Filters["order"])}
          >
            <SelectTrigger aria-label="Sort direction" className="min-h-11">
              <SelectValue placeholder="Direction" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="desc">Descending</SelectItem>
              <SelectItem value="asc">Ascending</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="pt-6">
          {error ? (
            <ErrorState message={error} onRetry={() => void load()} />
          ) : loading ? (
            <LoadingRows rows={6} />
          ) : !data || data.items.length === 0 ? (
            <EmptyState
              icon={<HistoryIcon aria-hidden className="size-8" />}
              title="No analyses match your filters"
              description="Try clearing the search box or widening the date range. New analyses appear here automatically after you run them."
            />
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Input</TableHead>
                      <TableHead>Verdict</TableHead>
                      <TableHead className="text-right">Likelihood</TableHead>
                      <TableHead className="text-right">Confidence</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Duration</TableHead>
                      <TableHead className="text-right">Created</TableHead>
                      <TableHead className="w-16 sr-only">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.items.map((item) => (
                      <TableRow
                        key={item.id}
                        tabIndex={0}
                        aria-label={`Open analysis ${item.fileName ?? item.id}`}
                        onClick={() => navigate("analysis-detail", { detailId: item.id })}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            navigate("analysis-detail", { detailId: item.id });
                          }
                        }}
                        className="cursor-pointer"
                      >
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <ModalityIcon modality={item.modality} />
                            <div className="min-w-0">
                              <p className="max-w-56 truncate text-sm font-medium">
                                {item.fileName ?? "Inline text"}
                              </p>
                              <p className="font-mono text-[10px] text-muted-foreground">{item.id}</p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <ClassificationBadge classification={item.classification} />
                        </TableCell>
                        <TableCell className="text-right text-sm tabular-nums">
                          {formatPercent(item.likelihoodScore)}
                        </TableCell>
                        <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                          {formatPercent(item.confidence)}
                        </TableCell>
                        <TableCell>
                          {item.status === "completed" ? (
                            <span className="text-xs text-emerald-400">completed</span>
                          ) : item.status === "failed" ? (
                            <span className="text-xs text-rose-400">failed</span>
                          ) : (
                            <span className="text-xs text-amber-400">{item.status}</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                          {formatDuration(item.processingTime)}
                        </TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground">
                          <RelativeTime iso={item.createdAt} />
                        </TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label={`Actions for ${item.fileName ?? item.id}`}
                                className="min-h-11 min-w-11"
                              >
                                <span aria-hidden className="text-lg leading-none">⋯</span>
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => navigate("analysis-detail", { detailId: item.id })}>
                                <Eye aria-hidden className="size-4" /> View detail
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => setDeleteTarget(item)}
                                className="text-rose-400 focus:text-rose-400"
                              >
                                <Trash2 aria-hidden className="size-4" /> Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination */}
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
                <p>
                  {data.total.toLocaleString()} result{data.total === 1 ? "" : "s"} · page{" "}
                  {data.page} of {data.totalPages || 1} · {data.pageSize} per page
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="min-h-11"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    aria-label="Previous page"
                  >
                    <ChevronLeft aria-hidden className="size-4" /> Prev
                  </Button>
                  <span className="tabular-nums">
                    {page} / {totalPages || 1}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="min-h-11"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => p + 1)}
                    aria-label="Next page"
                  >
                    Next <ChevronRight aria-hidden className="size-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Delete confirmation */}
      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this analysis?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the analysis{" "}
              <span className="font-mono text-xs">{deleteTarget?.id}</span>
              {deleteTarget?.fileName ? ` (${deleteTarget.fileName})` : ""} along with its signals,
              detector runs and reports. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void confirmDelete();
              }}
              disabled={deleting}
              className="min-h-11 bg-rose-600 text-white hover:bg-rose-600/90"
            >
              {deleting ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Legend note */}
      <p className="text-[11px] text-muted-foreground">
        Likelihood and confidence columns are estimates (0–100%), not proof. Classification buckets:
        {["likely_human", "likely_ai_generated", "likely_synthetic", "uncertain", "inconclusive"]
          .map((key) => ` ${classificationLabel(key)}`)
          .join(" ·")}
        .
      </p>
    </div>
  );
}
