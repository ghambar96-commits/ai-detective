"use client";

/**
 * AIDetective — Settings view: scoring thresholds (with honest explanations),
 * security toggle and storage info. Destructive per-item deletions live in
 * the History view only.
 */
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, HardDrive, Loader2, Lock, Save } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { getSettings, getSystemStatus, putSettings } from "@/lib/api/client";
import { useUiStore } from "@/stores/ui-store";
import type { SettingsResponse, SystemStatus } from "@/types/api";
import { ErrorState, formatBytes, SectionHeader } from "../shared";

export function SettingsView() {
  const navigate = useUiStore((s) => s.navigate);
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [system, setSystem] = useState<SystemStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // scoring form state
  const [aiThreshold, setAiThreshold] = useState("0.75");
  const [humanThreshold, setHumanThreshold] = useState("0.25");
  const [minSignals, setMinSignals] = useState("3");
  const [maxConfidence, setMaxConfidence] = useState("0.85");
  const [requireApiKey, setRequireApiKey] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [settingsRes, systemRes] = await Promise.all([getSettings(), getSystemStatus()]);
      setSettings(settingsRes);
      setSystem(systemRes);
      setAiThreshold(String(settingsRes.scoring.aiThreshold));
      setHumanThreshold(String(settingsRes.scoring.humanThreshold));
      setMinSignals(String(settingsRes.scoring.minSignals));
      setMaxConfidence(String(settingsRes.scoring.maxConfidence));
      setRequireApiKey(settingsRes.security.requireApiKey);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load settings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const saveScoring = async () => {
    setSaving(true);
    try {
      await putSettings({
        scoring: {
          aiThreshold: clamp(Number(aiThreshold), 0.51, 0.95),
          humanThreshold: clamp(Number(humanThreshold), 0.05, 0.49),
          minSignals: Math.round(clamp(Number(minSignals), 1, 8)),
          maxConfidence: clamp(Number(maxConfidence), 0.5, 0.95),
        },
      });
      toast.success("Scoring thresholds saved");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const saveSecurity = async (value: boolean) => {
    setRequireApiKey(value);
    try {
      await putSettings({ security: { requireApiKey: value } });
      toast.success(value ? "API key enforcement enabled" : "API key enforcement disabled", {
        description: value
          ? "All /api/v1 requests now require the X-API-Key header — including this workspace."
          : "Local mode: requests from this machine need no key.",
      });
    } catch (err) {
      setRequireApiKey(!value);
      toast.error(err instanceof Error ? err.message : "Save failed");
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-72 rounded-lg" />
        <Skeleton className="h-48 rounded-lg" />
      </div>
    );
  }
  if (error) return <ErrorState message={error} onRetry={() => void load()} />;
  if (!settings) return null;

  const disk = system?.resources.disk ?? null;

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Runtime settings"
        description="Thresholds shape the verdict bands. They are honest by construction: confidence is capped and inconclusive outcomes are allowed."
      />

      {/* Scoring */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Scoring thresholds</CardTitle>
          <CardDescription>
            How the engine maps the weighted signal score to verdicts.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <NumberField
              id="ai-threshold"
              label="AI threshold"
              hint="Score ≥ this ⇒ likely AI/synthetic (0.51–0.95)."
              value={aiThreshold}
              onChange={setAiThreshold}
              step="0.01"
              min="0.51"
              max="0.95"
            />
            <NumberField
              id="human-threshold"
              label="Human threshold"
              hint="Score ≤ this ⇒ likely human (0.05–0.49)."
              value={humanThreshold}
              onChange={setHumanThreshold}
              step="0.01"
              min="0.05"
              max="0.49"
            />
            <NumberField
              id="min-signals"
              label="Minimum signals"
              hint="Fewer agreeing signals ⇒ inconclusive (1–8)."
              value={minSignals}
              onChange={setMinSignals}
              step="1"
              min="1"
              max="8"
            />
            <NumberField
              id="max-confidence"
              label="Confidence cap"
              hint="Confidence can never exceed this (0.5–0.95) — no detector suite is perfect."
              value={maxConfidence}
              onChange={setMaxConfidence}
              step="0.01"
              min="0.5"
              max="0.95"
            />
          </div>
          <Alert className="border-amber-500/25 bg-amber-500/5 text-amber-300 [&>svg]:text-amber-400">
            <AlertTriangle aria-hidden />
            <AlertTitle>Honesty guarantees</AlertTitle>
            <AlertDescription>
              The engine never reports 100% confidence, treats &quot;uncertain&quot; and
              &quot;inconclusive&quot; as first-class outcomes, and marks every score as a
              likelihood estimate — not proof. Lowering the AI threshold increases sensitivity but
              also false positives; raising it does the opposite.
            </AlertDescription>
          </Alert>
          <Button onClick={() => void saveScoring()} disabled={saving} className="min-h-11">
            {saving ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <Save aria-hidden className="size-4" />}
            Save scoring settings
          </Button>
        </CardContent>
      </Card>

      {/* Security */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Lock aria-hidden className="size-4 text-emerald-400" />
            Security
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <Label htmlFor="require-api-key" className="text-sm font-medium">
                Require API key on every request
              </Label>
              <p className="mt-0.5 max-w-xl text-xs text-muted-foreground">
                Local-first default: off. When enabled, all /api/v1 calls — including from this
                workspace — must send a valid <code className="font-mono">X-API-Key</code>. Create
                keys in the API Keys view first.
              </p>
            </div>
            <Switch
              id="require-api-key"
              checked={requireApiKey}
              onCheckedChange={(value) => void saveSecurity(value)}
            />
          </div>
          <p className="text-[11px] text-muted-foreground">
            Current mode:{" "}
            <span className={requireApiKey ? "font-medium text-amber-400" : "font-medium text-emerald-400"}>
              {requireApiKey ? "key required" : "local mode (no key required)"}
            </span>
          </p>
        </CardContent>
      </Card>

      {/* Storage */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <HardDrive aria-hidden className="size-4 text-amber-400" />
            Storage
          </CardTitle>
          <CardDescription>Where analyses, uploads and the SQLite database live.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {disk ? (
            <>
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>
                  {formatBytes(disk.totalBytes - disk.freeBytes)} used of {formatBytes(disk.totalBytes)}
                </span>
                <span className="tabular-nums">{disk.usagePct}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
                <div
                  className={`h-full rounded-full ${disk.usagePct > 85 ? "bg-rose-500" : disk.usagePct > 65 ? "bg-amber-500" : "bg-emerald-500"}`}
                  style={{ width: `${disk.usagePct}%` }}
                />
              </div>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">Disk usage unavailable on this platform.</p>
          )}
          <p className="text-xs text-muted-foreground">
            Database: <code className="font-mono">db/aidetective.db</code> (SQLite) · uploads under{" "}
            <code className="font-mono">uploads/</code> (files kept on disk after analysis).
          </p>
        </CardContent>
      </Card>

      {/* Danger zone */}
      <Card className="border-rose-500/25">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm text-rose-400">
            <AlertTriangle aria-hidden className="size-4" />
            Danger zone
          </CardTitle>
          <CardDescription>
            Deletion is intentionally scoped to single analyses — there is no bulk wipe. To remove
            an analysis (with its signals, detector runs and reports), open the History view and
            use the row menu.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="outline"
            onClick={() => navigate("history")}
            className="min-h-11 border-rose-500/30 text-rose-400 hover:bg-rose-500/10"
          >
            Open History to manage records
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function NumberField({
  id,
  label,
  hint,
  value,
  onChange,
  step,
  min,
  max,
}: {
  id: string;
  label: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
  step: string;
  min: string;
  max: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-sm font-medium">
        {label}
      </Label>
      <Input
        id={id}
        type="number"
        step={step}
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-11"
      />
      <p className="text-[11px] leading-snug text-muted-foreground">{hint}</p>
    </div>
  );
}
