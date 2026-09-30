"use client";

/**
 * AIDetective — Datasets view. Manage labeled sample collections that feed
 * future training/evaluation work (import currently text-only; export is a
 * roadmap item — surfaced honestly).
 */
import { useCallback, useEffect, useState } from "react";
import { Database, Layers, Loader2, Plus, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Textarea } from "@/components/ui/textarea";
import { addDatasetSamples, createDataset, deleteDataset, listDatasets } from "@/lib/api/client";
import type { DatasetInfo, DatasetsResponse } from "@/types/api";
import { EmptyState, ErrorState, LoadingRows, ModalityIcon, RelativeTime } from "../shared";

export function DatasetsView() {
  const [data, setData] = useState<DatasetsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DatasetInfo | null>(null);
  const [samplesTarget, setSamplesTarget] = useState<DatasetInfo | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await listDatasets());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load datasets");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              Curate ground-truth samples to evaluate detector quality. Import is text-only today;
              image/audio import and dataset export are roadmap items.
            </p>
            <Button onClick={() => setCreateOpen(true)} className="min-h-11">
              <Plus aria-hidden className="size-4" /> New dataset
            </Button>
          </div>

          {error ? (
            <ErrorState message={error} onRetry={() => void load()} />
          ) : loading ? (
            <LoadingRows rows={4} />
          ) : !data || data.datasets.length === 0 ? (
            <EmptyState
              icon={<Database aria-hidden className="size-8" />}
              title="No datasets yet"
              description="Create a dataset and add labeled samples (human-written vs AI-generated) to benchmark detectors."
              action={
                <Button size="sm" className="min-h-11" onClick={() => setCreateOpen(true)}>
                  Create your first dataset
                </Button>
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Modality</TableHead>
                    <TableHead>Labels</TableHead>
                    <TableHead className="text-right">Samples</TableHead>
                    <TableHead className="text-right">Created</TableHead>
                    <TableHead>Export</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.datasets.map((dataset) => (
                    <TableRow key={dataset.id}>
                      <TableCell>
                        <p className="text-sm font-medium">{dataset.name}</p>
                        {dataset.description ? (
                          <p className="max-w-72 truncate text-xs text-muted-foreground" title={dataset.description}>
                            {dataset.description}
                          </p>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-1.5 text-sm">
                          <ModalityIcon modality={dataset.modality === "mixed" ? "text" : dataset.modality} />
                          {dataset.modality}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {dataset.labels.length === 0 ? (
                            <span className="text-xs text-muted-foreground">—</span>
                          ) : (
                            dataset.labels.map((label) => (
                              <Badge key={label} variant="secondary" className="text-[10px]">
                                {label}
                              </Badge>
                            ))
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums">{dataset.sampleCount}</TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        <RelativeTime iso={dataset.createdAt} />
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px] text-muted-foreground">
                          {dataset.exportReady ? "ready" : "roadmap"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1.5">
                          <Button
                            variant="outline"
                            size="sm"
                            className="min-h-11"
                            onClick={() => setSamplesTarget(dataset)}
                            aria-label={`Add samples to ${dataset.name}`}
                          >
                            <Upload aria-hidden className="size-3.5" /> Add samples
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="min-h-11 min-w-11 text-muted-foreground hover:text-rose-400"
                            onClick={() => setDeleteTarget(dataset)}
                            aria-label={`Delete ${dataset.name}`}
                          >
                            <Trash2 aria-hidden className="size-4" />
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

      <CreateDatasetDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => void load()}
      />
      <AddSamplesDialog
        dataset={samplesTarget}
        onOpenChange={(open) => !open && setSamplesTarget(null)}
      />

      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete dataset “{deleteTarget?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the dataset and its {deleteTarget?.sampleCount ?? 0} sample(s). This
              action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (!deleteTarget) return;
                deleteDataset(deleteTarget.id)
                  .then(() => {
                    toast.success("Dataset deleted");
                    setDeleteTarget(null);
                    void load();
                  })
                  .catch((err: unknown) =>
                    toast.error(err instanceof Error ? err.message : "Delete failed")
                  );
              }}
              className="min-h-11 bg-rose-600 text-white hover:bg-rose-600/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function CreateDatasetDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [modality, setModality] = useState<string>("text");
  const [description, setDescription] = useState("");
  const [labels, setLabels] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      await createDataset({
        name: name.trim(),
        modality: modality as "text" | "image" | "audio" | "document" | "mixed",
        description: description.trim() || undefined,
        labels: labels
          .split(",")
          .map((l) => l.trim())
          .filter(Boolean),
      });
      toast.success("Dataset created", { description: name.trim() });
      setName("");
      setDescription("");
      setLabels("");
      setModality("text");
      onOpenChange(false);
      onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Create failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New dataset</DialogTitle>
          <DialogDescription>Create a labeled collection of samples.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="dataset-name">Name</Label>
            <Input
              id="dataset-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. human-vs-gpt-text-v1"
              className="min-h-11"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dataset-modality">Modality</Label>
            <Select value={modality} onValueChange={setModality}>
              <SelectTrigger id="dataset-modality" className="min-h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="text">Text</SelectItem>
                <SelectItem value="image">Image</SelectItem>
                <SelectItem value="audio">Audio</SelectItem>
                <SelectItem value="document">Document</SelectItem>
                <SelectItem value="mixed">Mixed</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dataset-description">Description (optional)</Label>
            <Input
              id="dataset-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this dataset is for"
              className="min-h-11"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dataset-labels">Labels (comma-separated, optional)</Label>
            <Input
              id="dataset-labels"
              value={labels}
              onChange={(e) => setLabels(e.target.value)}
              placeholder="human, ai_generated"
              className="min-h-11"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="min-h-11">
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={submitting || !name.trim()} className="min-h-11">
            {submitting ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <Layers aria-hidden className="size-4" />}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddSamplesDialog({
  dataset,
  onOpenChange,
}: {
  dataset: DatasetInfo | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (dataset) setText("");
  }, [dataset]);

  const lineCount = text.split("\n").filter((l) => l.trim()).length;

  const submit = async () => {
    if (!dataset) return;
    const samples = text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const separatorIndex = line.indexOf("::");
        if (separatorIndex > 0) {
          return { content: line.slice(0, separatorIndex).trim(), label: line.slice(separatorIndex + 2).trim() };
        }
        return { content: line };
      });
    if (samples.length === 0) return;
    setSubmitting(true);
    try {
      const result = await addDatasetSamples(dataset.id, samples);
      toast.success(`Imported ${result.imported} sample(s)`, { description: dataset.name });
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={dataset !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add samples to “{dataset?.name ?? ""}”</DialogTitle>
          <DialogDescription>
            One sample per line. Optionally append a label after <code>::</code> — e.g.{" "}
            <code className="font-mono">Sample text here::human</code>. Text import only today.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={"A human written sentence::human\nAn AI generated sentence::ai_generated"}
          className="min-h-40 font-mono text-sm"
          aria-label="Samples, one per line"
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="min-h-11">
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={submitting || lineCount === 0} className="min-h-11">
            {submitting ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <Upload aria-hidden className="size-4" />}
            Queue {lineCount || ""} sample{lineCount === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
