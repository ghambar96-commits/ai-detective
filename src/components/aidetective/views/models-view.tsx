"use client";

/**
 * AIDetective — Model Registry view. Lists known detection/LLM model entries
 * and lets the analyst register external models or update availability.
 */
import { useCallback, useEffect, useState } from "react";
import { Boxes, Loader2, MoreVertical, Plus, Trash2 } from "lucide-react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { createModel, deleteModel, listModels, updateModelStatus } from "@/lib/api/client";
import type { ModelInfo, ModelsResponse } from "@/types/api";
import { EmptyState, ErrorState, LoadingRows, ModalityIcon, RelativeTime } from "../shared";

const STATUS_STYLES: Record<string, string> = {
  available: "border-emerald-500/30 bg-emerald-500/15 text-emerald-400",
  experimental: "border-amber-500/30 bg-amber-500/15 text-amber-400",
  disabled: "border-zinc-500/40 bg-zinc-500/15 text-zinc-300",
  unavailable: "border-rose-500/30 bg-rose-500/15 text-rose-400",
};

export function ModelsView() {
  const [data, setData] = useState<ModelsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ModelInfo | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await listModels());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load models");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const changeStatus = async (model: ModelInfo, status: ModelInfo["status"]) => {
    try {
      await updateModelStatus(model.id, status);
      toast.success(`Status updated to “${status}”`, { description: model.name });
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <p className="max-w-2xl text-sm text-muted-foreground">
              The registry documents model metadata (builtin heuristic detectors plus any external
              LLM runtimes you register). AIDetective ships no trained classifiers — weights and
              verdicts come from transparent heuristics.
            </p>
            <Button onClick={() => setCreateOpen(true)} className="min-h-11">
              <Plus aria-hidden className="size-4" /> Register model
            </Button>
          </div>

          {error ? (
            <ErrorState message={error} onRetry={() => void load()} />
          ) : loading ? (
            <LoadingRows rows={4} />
          ) : !data || data.models.length === 0 ? (
            <EmptyState
              icon={<Boxes aria-hidden className="size-8" />}
              title="Model registry is empty"
              description="Register local or remote models (e.g. an Ollama endpoint) to document them alongside the builtin detectors."
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Model</TableHead>
                    <TableHead>Modality</TableHead>
                    <TableHead>Provider</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Capabilities</TableHead>
                    <TableHead className="text-right">Registered</TableHead>
                    <TableHead className="sr-only">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.models.map((model) => (
                    <TableRow key={model.id}>
                      <TableCell>
                        <p className="text-sm font-medium">{model.name}</p>
                        <p className="font-mono text-[10px] text-muted-foreground">v{model.version}</p>
                      </TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-1.5 text-sm">
                          <ModalityIcon modality={model.modality === "mixed" ? "text" : model.modality} />
                          {model.modality}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm">{model.provider}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px] text-muted-foreground">
                          {model.location}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-[10px] ${STATUS_STYLES[model.status] ?? ""}`}>
                          {model.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex max-w-52 flex-wrap gap-1">
                          {model.capabilities.length === 0 ? (
                            <span className="text-xs text-muted-foreground">—</span>
                          ) : (
                            model.capabilities.slice(0, 3).map((capability) => (
                              <Badge key={capability} variant="secondary" className="text-[10px]">
                                {capability}
                              </Badge>
                            ))
                          )}
                          {model.capabilities.length > 3 ? (
                            <Badge variant="secondary" className="text-[10px]">
                              +{model.capabilities.length - 3}
                            </Badge>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        <RelativeTime iso={model.createdAt} />
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Actions for ${model.name}`}
                              className="min-h-11 min-w-11"
                            >
                              <MoreVertical aria-hidden className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuLabel className="text-xs">Set status</DropdownMenuLabel>
                            {(["available", "experimental", "disabled", "unavailable"] as const).map((status) => (
                              <DropdownMenuItem
                                key={status}
                                disabled={model.status === status}
                                onClick={() => void changeStatus(model, status)}
                              >
                                {status}
                              </DropdownMenuItem>
                            ))}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => setDeleteTarget(model)}
                              className="text-rose-400 focus:text-rose-400"
                            >
                              <Trash2 aria-hidden className="size-4" /> Remove entry
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <CreateModelDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={() => void load()} />

      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove “{deleteTarget?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Removes the registry entry. This does not delete any underlying model — it only
              removes the documentation record.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (!deleteTarget) return;
                deleteModel(deleteTarget.id)
                  .then(() => {
                    toast.success("Model entry removed");
                    setDeleteTarget(null);
                    void load();
                  })
                  .catch((err: unknown) =>
                    toast.error(err instanceof Error ? err.message : "Delete failed")
                  );
              }}
              className="min-h-11 bg-rose-600 text-white hover:bg-rose-600/90"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function CreateModelDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [version, setVersion] = useState("1.0.0");
  const [modality, setModality] = useState("text");
  const [provider, setProvider] = useState("");
  const [location, setLocation] = useState("local");
  const [status, setStatus] = useState("experimental");
  const [capabilities, setCapabilities] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!name.trim() || !provider.trim()) return;
    setSubmitting(true);
    try {
      await createModel({
        name: name.trim(),
        version: version.trim() || "1.0.0",
        modality: modality as "text" | "image" | "audio" | "document" | "mixed",
        provider: provider.trim(),
        location: location as "local" | "remote",
        status: status as ModelInfo["status"],
        capabilities: capabilities
          .split(",")
          .map((c) => c.trim())
          .filter(Boolean),
      });
      toast.success("Model registered", { description: name.trim() });
      setName("");
      setProvider("");
      setCapabilities("");
      onOpenChange(false);
      onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Register a model</DialogTitle>
          <DialogDescription>
            Document an external model (e.g. a local Ollama runtime or a remote API model) in the
            registry.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="model-name">Name</Label>
            <Input id="model-name" value={name} onChange={(e) => setName(e.target.value)} className="min-h-11" placeholder="e.g. llama3-8b-instruct" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="model-version">Version</Label>
            <Input id="model-version" value={version} onChange={(e) => setVersion(e.target.value)} className="min-h-11" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="model-modality">Modality</Label>
            <Select value={modality} onValueChange={setModality}>
              <SelectTrigger id="model-modality" className="min-h-11">
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
            <Label htmlFor="model-provider">Provider</Label>
            <Input id="model-provider" value={provider} onChange={(e) => setProvider(e.target.value)} className="min-h-11" placeholder="ollama / openai / custom" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="model-location">Location</Label>
            <Select value={location} onValueChange={setLocation}>
              <SelectTrigger id="model-location" className="min-h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="local">Local</SelectItem>
                <SelectItem value="remote">Remote</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="model-status">Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger id="model-status" className="min-h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="available">Available</SelectItem>
                <SelectItem value="experimental">Experimental</SelectItem>
                <SelectItem value="unavailable">Unavailable</SelectItem>
                <SelectItem value="disabled">Disabled</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="model-capabilities">Capabilities (comma-separated, optional)</Label>
            <Input id="model-capabilities" value={capabilities} onChange={(e) => setCapabilities(e.target.value)} className="min-h-11" placeholder="text-generation, summarization" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="min-h-11">
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={submitting || !name.trim() || !provider.trim()} className="min-h-11">
            {submitting ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <Plus aria-hidden className="size-4" />}
            Register
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
