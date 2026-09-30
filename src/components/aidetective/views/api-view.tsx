"use client";

/**
 * AIDetective — API view: key management (plaintext shown exactly once),
 * endpoint documentation and OpenAPI download.
 */
import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Download, KeyRound, Loader2, Plus, ShieldOff } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { createApiKey, downloadOpenApi, listApiKeys, revokeApiKey } from "@/lib/api/client";
import type { ApiKeyCreateResult, ApiKeyInfo, ApiKeysResponse } from "@/types/api";
import { EmptyState, ErrorState, LoadingRows, RelativeTime } from "../shared";

const ENDPOINTS: Array<{ method: string; path: string; description: string }> = [
  { method: "POST", path: "/api/v1/analyze", description: "Analyze inline text (runs synchronously)" },
  { method: "POST", path: "/api/v1/analyze/file", description: "Upload a file for queued analysis (202 + poll)" },
  { method: "GET", path: "/api/v1/analyses", description: "Search, filter, sort and paginate history" },
  { method: "GET", path: "/api/v1/analyses/{id}", description: "Fetch a single analysis with signals & detector runs" },
  { method: "DELETE", path: "/api/v1/analyses/{id}", description: "Delete an analysis permanently" },
  { method: "GET", path: "/api/v1/reports/{id}", description: "Generated report — ?format=json|html" },
  { method: "GET", path: "/api/v1/stats", description: "Dashboard aggregates & recent issues" },
  { method: "GET", path: "/api/v1/system/status", description: "Runtime, resources and service status" },
  { method: "GET", path: "/api/v1/detectors", description: "Registered detectors incl. limitations" },
  { method: "GET", path: "/api/v1/plugins", description: "Loaded plugins & plugin contract" },
  { method: "GET / POST", path: "/api/v1/models", description: "List / register model entries" },
  { method: "PATCH / DELETE", path: "/api/v1/models/{id}", description: "Update status / remove a model entry" },
  { method: "GET / POST", path: "/api/v1/datasets", description: "List / create datasets" },
  { method: "POST", path: "/api/v1/datasets/{id}/samples", description: "Queue labeled samples (202)" },
  { method: "GET / PUT", path: "/api/v1/settings", description: "Read / update runtime settings" },
  { method: "POST", path: "/api/v1/llm/test", description: "Test the configured LLM provider" },
  { method: "GET / POST", path: "/api/v1/api-keys", description: "List / create API keys" },
  { method: "DELETE", path: "/api/v1/api-keys/{id}", description: "Revoke an API key" },
  { method: "GET", path: "/api/v1/openapi", description: "OpenAPI 3.0.3 document (18 paths)" },
];

export function ApiView() {
  const [data, setData] = useState<ApiKeysResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [created, setCreated] = useState<ApiKeyCreateResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<ApiKeyInfo | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await listApiKeys());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load API keys");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const copyKey = async () => {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.key);
      setCopied(true);
      toast.success("Key copied to clipboard");
    } catch {
      toast.error("Clipboard unavailable — select the key text manually");
    }
  };

  return (
    <div className="space-y-4">
      {/* Keys */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2 text-sm">
                <KeyRound aria-hidden className="size-4 text-emerald-400" />
                API keys
              </CardTitle>
              <CardDescription>
                Keys are stored as SHA-256 hashes — the plaintext is shown exactly once, at creation.
                By default the app runs in local mode (no key required); enable enforcement in Settings.
              </CardDescription>
            </div>
            <Button onClick={() => setCreateOpen(true)} className="min-h-11">
              <Plus aria-hidden className="size-4" /> Create key
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {error ? (
            <ErrorState message={error} onRetry={() => void load()} />
          ) : loading ? (
            <LoadingRows rows={3} />
          ) : !data || data.keys.length === 0 ? (
            <EmptyState
              icon={<KeyRound aria-hidden className="size-8" />}
              title="No API keys"
              description="Create a key to call the REST API from scripts or other machines. Requests from this workspace don't need one."
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Prefix</TableHead>
                    <TableHead className="text-right">Rate limit</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Last used</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.keys.map((key) => (
                    <TableRow key={key.id}>
                      <TableCell className="text-sm font-medium">{key.name}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{key.prefix}…</TableCell>
                      <TableCell className="text-right text-sm tabular-nums">
                        {key.rateLimit > 0 ? `${key.rateLimit}/min` : "unlimited"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        <RelativeTime iso={key.createdAt} />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {key.lastUsedAt ? <RelativeTime iso={key.lastUsedAt} /> : "never"}
                      </TableCell>
                      <TableCell>
                        {key.revoked ? (
                          <Badge variant="outline" className="border-rose-500/30 bg-rose-500/15 text-[10px] text-rose-400">
                            revoked
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/15 text-[10px] text-emerald-400">
                            active
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {!key.revoked ? (
                          <Button
                            variant="outline"
                            size="sm"
                            className="min-h-11 border-rose-500/30 text-rose-400 hover:bg-rose-500/10"
                            onClick={() => setRevokeTarget(key)}
                            aria-label={`Revoke key ${key.name}`}
                          >
                            <ShieldOff aria-hidden className="size-3.5" /> Revoke
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            <RelativeTime iso={key.revokedAt} />
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Endpoint docs */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="text-sm">Endpoints</CardTitle>
              <CardDescription>
                All responses use the envelope <code className="font-mono text-[11px]">{`{ ok, data | error }`}</code>.
                Auth: <code className="font-mono text-[11px]">X-API-Key</code> header (when required).
              </CardDescription>
            </div>
            <Button variant="outline" onClick={() => void downloadOpenApi()} className="min-h-11">
              <Download aria-hidden className="size-4" /> Download OpenAPI JSON
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="max-h-96 overflow-y-auto rounded-md border [scrollbar-width:thin]">
            <Table>
              <TableHeader className="sticky top-0 bg-card">
                <TableRow>
                  <TableHead className="w-32">Method</TableHead>
                  <TableHead className="w-64">Path</TableHead>
                  <TableHead>Description</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ENDPOINTS.map((endpoint) => (
                  <TableRow key={`${endpoint.method}-${endpoint.path}`}>
                    <TableCell>
                      <Badge variant="secondary" className="font-mono text-[10px]">
                        {endpoint.method}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{endpoint.path}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{endpoint.description}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Create key dialog */}
      <CreateKeyDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(result) => {
          setCreated(result);
          setCopied(false);
          void load();
        }}
      />

      {/* Show-once dialog */}
      <Dialog open={created !== null} onOpenChange={(open) => !open && setCreated(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>API key created — copy it now</DialogTitle>
            <DialogDescription>
              {created?.notice ?? "This is the only time the full key is shown. It is stored hashed."}
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2 rounded-md border bg-zinc-950/80 p-3">
            <code className="min-w-0 flex-1 break-all font-mono text-xs text-emerald-300">{created?.key}</code>
            <Button variant="outline" size="sm" onClick={() => void copyKey()} className="min-h-11 shrink-0">
              {copied ? <Check aria-hidden className="size-3.5 text-emerald-400" /> : <Copy aria-hidden className="size-3.5" />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <p className="text-xs text-amber-400">
            Treat it like a password. If lost, revoke the key and create a new one.
          </p>
          <DialogFooter>
            <Button onClick={() => setCreated(null)} className="min-h-11">
              I&apos;ve stored it safely
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Revoke confirm */}
      <AlertDialog open={revokeTarget !== null} onOpenChange={(open) => !open && setRevokeTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke “{revokeTarget?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Clients using this key will immediately receive 401 responses. This cannot be undone —
              create a new key instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (!revokeTarget) return;
                revokeApiKey(revokeTarget.id)
                  .then(() => {
                    toast.success("API key revoked");
                    setRevokeTarget(null);
                    void load();
                  })
                  .catch((err: unknown) =>
                    toast.error(err instanceof Error ? err.message : "Revoke failed")
                  );
              }}
              className="min-h-11 bg-rose-600 text-white hover:bg-rose-600/90"
            >
              Revoke key
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function CreateKeyDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (result: ApiKeyCreateResult) => void;
}) {
  const [name, setName] = useState("");
  const [rateLimit, setRateLimit] = useState("60");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      const parsed = Number(rateLimit);
      const result = await createApiKey(name.trim(), Number.isFinite(parsed) && parsed > 0 ? parsed : undefined);
      onCreated(result);
      setName("");
      setRateLimit("60");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Key creation failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create API key</DialogTitle>
          <DialogDescription>
            Give the key a recognizable name and an optional per-minute rate limit.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="key-name">Name</Label>
            <Input
              id="key-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. ci-pipeline"
              className="min-h-11"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="key-rate">Rate limit (requests/min, 0 = unlimited)</Label>
            <Input
              id="key-rate"
              type="number"
              min="0"
              value={rateLimit}
              onChange={(e) => setRateLimit(e.target.value)}
              className="min-h-11"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="min-h-11">
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={submitting || !name.trim()} className="min-h-11">
            {submitting ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <Plus aria-hidden className="size-4" />}
            Create key
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
