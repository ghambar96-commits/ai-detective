"use client";

/**
 * AIDetective — Plugins view: loaded plugins, on-disk discoveries and the
 * plugin contract. Broken plugins are isolated, never crash the engine.
 */
import { useCallback, useEffect, useState } from "react";
import { FileCode2, FolderTree, Puzzle, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getPlugins } from "@/lib/api/client";
import type { PluginsResponse } from "@/types/api";
import { EmptyState, ErrorState, LoadingRows, RelativeTime, SectionHeader } from "../shared";

export function PluginsView() {
  const [data, setData] = useState<PluginsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await getPlugins());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load plugins");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="space-y-4">
        <LoadingRows rows={4} />
        <LoadingRows rows={2} />
      </div>
    );
  }
  if (error) return <ErrorState message={error} onRetry={() => void load()} />;
  if (!data) return null;

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Plugin ecosystem"
        description={`${data.total} plugin(s) loaded · ${data.loadedFromPlugins.detectors} detector(s) and ${data.loadedFromPlugins.parsers} parser(s) contributed by plugins.`}
      />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Puzzle aria-hidden className="size-4 text-emerald-400" />
            Loaded plugins
          </CardTitle>
          <CardDescription>
            Loaded at runtime from the <code className="font-mono text-[11px]">plugins/</code>{" "}
            directory. A broken plugin is reported here but cannot crash the app.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data.plugins.length === 0 ? (
            <EmptyState
              icon={<Puzzle aria-hidden className="size-8" />}
              title="No plugins loaded"
              description="Drop a plugin into plugins/<name>/ with a plugin.json manifest to extend detectors and parsers."
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Plugin</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Modality</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Updated</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.plugins.map((plugin) => (
                    <TableRow key={plugin.id}>
                      <TableCell>
                        <p className="text-sm font-medium">{plugin.name}</p>
                        <p className="font-mono text-[10px] text-muted-foreground">
                          {plugin.id} · v{plugin.version}
                        </p>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="text-[10px]">
                          {plugin.type}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">{plugin.modality}</TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={`text-[10px] ${
                            plugin.status === "loaded"
                              ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-400"
                              : "border-rose-500/30 bg-rose-500/15 text-rose-400"
                          }`}
                        >
                          {plugin.status}
                        </Badge>
                        {plugin.error ? (
                          <p className="mt-1 max-w-48 truncate text-[10px] text-rose-400" title={plugin.error}>
                            {plugin.error}
                          </p>
                        ) : null}
                      </TableCell>
                      <TableCell className="max-w-72 text-xs text-muted-foreground">
                        {plugin.description || "—"}
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        <RelativeTime iso={plugin.updatedAt} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <FolderTree aria-hidden className="size-4 text-amber-400" />
              Discovered on disk
            </CardTitle>
            <CardDescription>Directories found under plugins/ (loaded or not).</CardDescription>
          </CardHeader>
          <CardContent>
            {data.discoveredOnDisk.length === 0 ? (
              <p className="py-3 text-center text-xs text-muted-foreground">Nothing discovered.</p>
            ) : (
              <ul className="max-h-56 space-y-1.5 overflow-y-auto pr-1 [scrollbar-width:thin]">
                {data.discoveredOnDisk.map((entry, i) => (
                  <li key={i} className="rounded-md border px-3 py-2 font-mono text-xs">
                    {typeof entry.name === "string" ? entry.name : JSON.stringify(entry)}
                    {typeof entry.manifest === "boolean" ? (
                      <Badge
                        variant="outline"
                        className={`ml-2 text-[9px] ${
                          entry.manifest ? "text-emerald-400" : "text-amber-400"
                        }`}
                      >
                        {entry.manifest ? "manifest ok" : "no manifest"}
                      </Badge>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <FileCode2 aria-hidden className="size-4 text-emerald-400" />
              Plugin contract
            </CardTitle>
            <CardDescription>
              Manifest: <code className="font-mono text-[11px]">{data.api.manifest}</code> · Entry:{" "}
              <code className="font-mono text-[11px]">{data.api.entry}</code>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <ol className="list-decimal space-y-1.5 pl-5 text-xs leading-relaxed">
              <li>
                Create <code className="font-mono">plugins/&lt;name&gt;/plugin.json</code> describing
                id, name, version, type and modality.
              </li>
              <li>
                Export <code className="font-mono">register(api)</code> from{" "}
                <code className="font-mono">index.js</code> — call{" "}
                <code className="font-mono">api.registerDetector(...)</code> with a Detector
                implementation (id, name, modalities, limitations, detect()).
              </li>
              <li>Restart — the loader scans, imports and isolates failures per plugin.</li>
            </ol>
            <div className="rounded-md border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs leading-relaxed text-emerald-300/90">
              <span className="mb-1 flex items-center gap-1.5 font-semibold">
                <ShieldCheck aria-hidden className="size-3.5" /> Example shipped
              </span>
              <code className="font-mono">plugins/example-text-detector</code> registers the{" "}
              <code className="font-mono">text.example.hedging</code> detector — use it as a
              template. Its signals appear in text analyses and it counts toward the plugin totals
              on the Dashboard.
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
