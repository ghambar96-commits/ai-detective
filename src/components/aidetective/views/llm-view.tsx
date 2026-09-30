"use client";

/**
 * AIDetective — LLM Setup view. Configure the optional explanation provider
 * and test the connection. The LLM never decides the detection verdict.
 */
import { useCallback, useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, PlugZap, Save, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { Switch } from "@/components/ui/switch";
import { getSettings, putSettings, testLLM } from "@/lib/api/client";
import type { LLMTestResult, SettingsResponse } from "@/types/api";
import { ErrorState, SectionHeader } from "../shared";

export function LLMView() {
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<LLMTestResult | null>(null);

  // form state
  const [enabled, setEnabled] = useState(false);
  const [provider, setProvider] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [clearKey, setClearKey] = useState(false);
  const [temperature, setTemperature] = useState("0.2");
  const [timeoutMs, setTimeoutMs] = useState("20000");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getSettings();
      setSettings(res);
      setEnabled(res.llm.enabled);
      setProvider(res.llm.provider);
      setBaseUrl(res.llm.baseUrl ?? "");
      setModel(res.llm.model ?? "");
      setTemperature(String(res.llm.temperature));
      setTimeoutMs(String(res.llm.timeoutMs));
      setApiKeyInput("");
      setClearKey(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load settings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      const apiKey = clearKey ? null : apiKeyInput.trim() ? apiKeyInput.trim() : undefined;
      await putSettings({
        llm: {
          enabled,
          provider,
          baseUrl: baseUrl.trim() || null,
          model: model.trim() || null,
          ...(apiKey !== undefined ? { apiKey } : {}),
          temperature: Math.min(2, Math.max(0, Number(temperature) || 0)),
          timeoutMs: Math.min(120_000, Math.max(2000, Number(timeoutMs) || 20_000)),
        },
      });
      toast.success("LLM settings saved");
      setApiKeyInput("");
      setClearKey(false);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const runTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testLLM();
      setTestResult(result);
      if (result.ok) {
        toast.success(`Connection OK (${result.latencyMs ?? "?"} ms)`, {
          description: `${result.provider}${result.model ? ` · ${result.model}` : ""}`,
        });
      } else {
        toast.error("Connection failed", { description: result.error ?? "Unknown error" });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Test failed");
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-80 rounded-lg" />
        <Skeleton className="h-24 rounded-lg" />
      </div>
    );
  }
  if (error) return <ErrorState message={error} onRetry={() => void load()} />;
  if (!settings) return null;

  const selectedProvider = settings.providers.find((p) => p.id === provider);
  const needsBaseUrl = selectedProvider?.kind === "openai" || selectedProvider?.kind === "custom";

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Explanation provider"
        description="The LLM writes a human-readable reading of the detector signals. It never decides the verdict."
      />

      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center gap-2">
            <Sparkles aria-hidden className="size-4 text-emerald-400" />
            <CardTitle className="text-sm">Configuration</CardTitle>
          </div>
          <CardDescription>
            Provider credentials are stored server-side and returned masked.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <Label htmlFor="llm-enabled" className="text-sm font-medium">
                Enable LLM interpretation
              </Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Adds an optional narrative summary to each analysis result.
              </p>
            </div>
            <Switch id="llm-enabled" checked={enabled} onCheckedChange={setEnabled} />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="llm-provider">Provider</Label>
              <Select value={provider} onValueChange={setProvider}>
                <SelectTrigger id="llm-provider" className="min-h-11">
                  <SelectValue placeholder="Select provider" />
                </SelectTrigger>
                <SelectContent>
                  {settings.providers.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.label} ({p.kind})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="llm-model">Model</Label>
              <Input
                id="llm-model"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="e.g. llama3.2, gpt-4o-mini"
                className="min-h-11"
              />
            </div>
            {needsBaseUrl ? (
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="llm-baseurl">Base URL</Label>
                <Input
                  id="llm-baseurl"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://openrouter.ai/api/v1"
                  className="min-h-11"
                />
              </div>
            ) : null}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="llm-apikey">API key</Label>
                {settings.llm.hasApiKey ? (
                  <Badge variant="outline" className="text-[10px] text-emerald-400">
                    key stored
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-[10px] text-muted-foreground">
                    not set
                  </Badge>
                )}
              </div>
              <Input
                id="llm-apikey"
                type="password"
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                placeholder={settings.llm.hasApiKey ? "•••••••• (stored — type to replace)" : "Enter API key"}
                className="min-h-11"
                autoComplete="off"
              />
              {settings.llm.hasApiKey ? (
                <button
                  type="button"
                  className="text-xs text-rose-400 underline-offset-2 hover:underline"
                  onClick={() => {
                    setClearKey(true);
                    setApiKeyInput("");
                  }}
                >
                  {clearKey ? "Key will be cleared on save — undo?" : "Clear stored key on save"}
                </button>
              ) : null}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="llm-temperature">Temperature (0–2)</Label>
                <Input
                  id="llm-temperature"
                  type="number"
                  step="0.1"
                  min="0"
                  max="2"
                  value={temperature}
                  onChange={(e) => setTemperature(e.target.value)}
                  className="min-h-11"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="llm-timeout">Timeout (ms)</Label>
                <Input
                  id="llm-timeout"
                  type="number"
                  step="500"
                  min="2000"
                  max="120000"
                  value={timeoutMs}
                  onChange={(e) => setTimeoutMs(e.target.value)}
                  className="min-h-11"
                />
              </div>
            </div>
          </div>

          <Alert className="border-emerald-500/25 bg-emerald-500/5 text-emerald-300 [&>svg]:text-emerald-400">
            <CheckCircle2 aria-hidden />
            <AlertTitle>Explanation only</AlertTitle>
            <AlertDescription>
              The interpretation is generated from the detector signals after scoring. It cannot
              change the classification, the likelihood score or the confidence value.
            </AlertDescription>
          </Alert>
        </CardContent>
        <CardFooter className="flex flex-wrap gap-2">
          <Button onClick={() => void save()} disabled={saving} className="min-h-11">
            {saving ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <Save aria-hidden className="size-4" />}
            Save settings
          </Button>
          <Button variant="outline" onClick={() => void runTest()} disabled={testing} className="min-h-11">
            {testing ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <PlugZap aria-hidden className="size-4" />}
            Test connection
          </Button>
        </CardFooter>
      </Card>

      {testResult ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              {testResult.ok ? (
                <>
                  <CheckCircle2 aria-hidden className="size-4 text-emerald-400" /> Connection successful
                </>
              ) : (
                <>
                  <AlertCircle aria-hidden className="size-4 text-rose-400" /> Connection failed
                </>
              )}
            </CardTitle>
            <CardDescription>Live test against the configured provider.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <span>
              Provider: <span className="font-medium">{testResult.provider}</span>
            </span>
            {testResult.model ? (
              <span>
                Model: <span className="font-medium">{testResult.model}</span>
              </span>
            ) : null}
            {testResult.ok ? (
              <span>
                Latency:{" "}
                <span className="font-medium tabular-nums text-emerald-400">
                  {testResult.latencyMs !== null ? `${testResult.latencyMs} ms` : "—"}
                </span>
              </span>
            ) : (
              <span className="text-rose-300">{testResult.error}</span>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
