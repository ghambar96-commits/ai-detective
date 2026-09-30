"use client";

/**
 * AIDetective — Analysis Detail view (#/analysis/<id>).
 * Loads a single analysis and renders the full result panel.
 */
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Loader2, Trash2 } from "lucide-react";
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
import { Skeleton } from "@/components/ui/skeleton";
import { deleteAnalysis, getAnalysis } from "@/lib/api/client";
import { useUiStore } from "@/stores/ui-store";
import type { AnalysisDetail } from "@/types/api";
import { AnalysisResult } from "../analysis-result";
import { ErrorState } from "../shared";

export function AnalysisDetailView({ id }: { id: string }) {
  const navigate = useUiStore((s) => s.navigate);
  const [analysis, setAnalysis] = useState<AnalysisDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setAnalysis(await getAnalysis(id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load analysis");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Poll non-terminal analyses so a queued file analysis completes live.
  useEffect(() => {
    if (!analysis || (analysis.status !== "queued" && analysis.status !== "processing")) return;
    const timer = window.setInterval(async () => {
      try {
        const fresh = await getAnalysis(id);
        setAnalysis(fresh);
      } catch {
        /* keep polling silently; the retry button covers hard failures */
      }
    }, 1500);
    return () => window.clearInterval(timer);
  }, [analysis, id]);

  const confirmDelete = async () => {
    setDeleting(true);
    try {
      await deleteAnalysis(id);
      toast.success("Analysis deleted");
      navigate("history");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-48 rounded-lg" />
        <Skeleton className="h-64 rounded-lg" />
      </div>
    );
  }

  if (error) {
    return <ErrorState message={error} onRetry={() => void load()} />;
  }

  if (!analysis) return null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => navigate("history")} className="min-h-11">
          <ArrowLeft aria-hidden className="size-4" /> Back to history
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setConfirmOpen(true)}
          className="min-h-11 border-rose-500/30 text-rose-400 hover:bg-rose-500/10 hover:text-rose-300"
        >
          {deleting ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <Trash2 aria-hidden className="size-4" />}
          Delete
        </Button>
      </div>

      <AnalysisResult analysis={analysis} />

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this analysis?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the analysis and all stored signals, detector runs and
              reports. This action cannot be undone.
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
    </div>
  );
}
