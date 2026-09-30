/**
 * AIDetective — Report Engine.
 * Structured reports from a completed analysis. JSON and self-contained HTML
 * today; the ReportExporter interface keeps PDF (phase-3) a drop-in addition.
 * Reports embed software/version info and a prominent honesty disclaimer.
 */
import { APP_NAME, APP_VERSION, ENGINE_VERSION } from "../core/config";
import type { AnalysisDetail, ReportExporter } from "../core/types";
import { escapeHtml } from "./html-utils";

export const REPORT_DISCLAIMER =
  "This report is the output of a probabilistic heuristic analysis. It is NOT proof of authorship and must not be used as sole evidence. AI detection can produce false positives and false negatives.";

function softwareInfo() {
  return { name: APP_NAME, version: APP_VERSION, engineVersion: ENGINE_VERSION, reportSpec: "1.0" };
}

// ─── JSON exporter ────────────────────────────────────────────────────────────

export class JsonReportExporter implements ReportExporter {
  readonly id = "report.json";
  readonly label = "JSON report";
  readonly format = "json";
  readonly fileExt = "json";
  readonly mimeType = "application/json";

  async export(analysis: AnalysisDetail): Promise<string> {
    const report = {
      report: {
        spec: "1.0",
        generatedAt: new Date().toISOString(),
        software: softwareInfo(),
        disclaimer: REPORT_DISCLAIMER,
      },
      summary: {
        analysisId: analysis.id,
        classification: analysis.classification,
        likelihoodScore: analysis.likelihoodScore,
        confidence: analysis.confidence,
        modality: analysis.modality,
        inputType: analysis.inputType,
        status: analysis.status,
        createdAt: analysis.createdAt,
        completedAt: analysis.completedAt,
        processingTimeMs: analysis.processingTime,
      },
      detectorsUsed: analysis.detectorRuns.map((r) => ({
        id: r.detectorId,
        name: r.detectorName,
        version: r.version,
        source: r.source,
        status: r.status,
        durationMs: r.durationMs,
        summary: r.summary,
      })),
      signals: analysis.signals,
      warnings: analysis.warnings,
      errors: analysis.errors,
      llmInterpretation: analysis.llmInterpretation
        ? { text: analysis.llmInterpretation, provider: analysis.llmProvider, model: analysis.llmModel, note: "Explanation only — did not influence the verdict." }
        : null,
      metadata: analysis.metadata,
    };
    return JSON.stringify(report, null, 2);
  }
}

// ─── HTML exporter (self-contained, printable → PDF via print) ───────────────

export class HtmlReportExporter implements ReportExporter {
  readonly id = "report.html";
  readonly label = "HTML report";
  readonly format = "html";
  readonly fileExt = "html";
  readonly mimeType = "text/html";

  async export(analysis: AnalysisDetail): Promise<string> {
    return renderHtmlReport(analysis);
  }
}

function pct(n: number | null | undefined): string {
  return n === null || n === undefined ? "n/a" : `${Math.round(n * 100)}%`;
}

function renderHtmlReport(a: AnalysisDetail): string {
  const classificationClass = `cls-${a.classification ?? "inconclusive"}`;
  const signalsRows = a.signals
    .map(
      (s) => `
      <tr>
        <td><strong>${escapeHtml(s.name)}</strong><div class="muted">${escapeHtml(s.detectorId)}</div></td>
        <td>${escapeHtml(String(s.value ?? "—"))}${s.unit ? ` ${escapeHtml(s.unit)}` : ""}</td>
        <td><span class="dir dir-${s.direction}">${escapeHtml(s.direction.replace("_", " "))}</span></td>
        <td>${s.aiScore === null ? "—" : pct(s.aiScore)}</td>
        <td>${pct(s.weight)}</td>
        <td>${(s.evidence ?? []).length > 0
          ? `<ul class="evi">${(s.evidence ?? []).map((e) => `<li><em>${escapeHtml(e.label)}:</em> ${escapeHtml(e.content)}</li>`).join("")}</ul>`
          : "—"}</td>
      </tr>`
    )
    .join("\n");

  const runsRows = a.detectorRuns
    .map(
      (r) => `
      <tr>
        <td>${escapeHtml(r.detectorName)}<div class="muted">${escapeHtml(r.detectorId)} · v${escapeHtml(r.version)} · ${escapeHtml(r.source)}</div></td>
        <td><span class="st st-${r.status}">${escapeHtml(r.status)}</span></td>
        <td>${r.durationMs ?? "—"} ms</td>
        <td>${escapeHtml(r.summary ?? r.error ?? "—")}</td>
      </tr>`
    )
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>AIDetective report ${escapeHtml(a.id)}</title>
<style>
  :root { color-scheme: light; }
  body { font-family: -apple-system, "Segoe UI", Roboto, sans-serif; margin: 0; background: #f5f6f8; color: #16181d; }
  .page { max-width: 900px; margin: 0 auto; padding: 32px 40px 64px; background: #fff; min-height: 100vh; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 15px; text-transform: uppercase; letter-spacing: .06em; color: #5a6072; margin: 28px 0 10px; border-bottom: 1px solid #e4e6eb; padding-bottom: 6px; }
  .muted { color: #6b7280; font-size: 12px; }
  .badge { display: inline-block; padding: 4px 12px; border-radius: 999px; font-weight: 600; font-size: 13px; }
  .cls-likely_ai_generated, .cls-likely_synthetic { background: #fde8e8; color: #b42318; }
  .cls-likely_human { background: #e6f6ec; color: #067647; }
  .cls-uncertain { background: #fef3d8; color: #92400e; }
  .cls-inconclusive { background: #e8eaef; color: #3f4451; }
  .disclaimer { background: #fff8e6; border: 1px solid #f2dc9b; border-radius: 8px; padding: 12px 16px; font-size: 13px; margin: 18px 0; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; background: #f3f4f6; padding: 8px 10px; border: 1px solid #e4e6eb; }
  td { padding: 8px 10px; border: 1px solid #e4e6eb; vertical-align: top; }
  .dir-ai_indicator { color: #b42318; font-weight: 600; }
  .dir-human_indicator { color: #067647; font-weight: 600; }
  .dir-neutral { color: #5a6072; }
  .st-ok { color: #067647; font-weight: 600; }
  .st-error { color: #b42318; font-weight: 600; }
  .st-skipped { color: #92400e; font-weight: 600; }
  .evi { margin: 4px 0 0; padding-left: 16px; }
  .evi li { margin-bottom: 4px; }
  .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 16px 0; }
  .stat { border: 1px solid #e4e6eb; border-radius: 8px; padding: 12px 14px; }
  .stat .v { font-size: 20px; font-weight: 700; }
  ul.warnings { background: #fdf2f2; border: 1px solid #f3c6c6; border-radius: 8px; padding: 10px 28px; }
  .interp { white-space: pre-wrap; background: #f6f7f9; border-radius: 8px; padding: 14px 16px; font-size: 13.5px; line-height: 1.55; }
  footer { margin-top: 40px; color: #6b7280; font-size: 12px; border-top: 1px solid #e4e6eb; padding-top: 12px; }
  @media print { body { background: #fff; } .page { padding: 0; } }
</style>
</head>
<body>
<div class="page">
  <h1>AIDetective — Analysis Report</h1>
  <div class="muted">Report ID: ${escapeHtml(a.id)} · Generated ${escapeHtml(new Date().toISOString())}</div>

  <div class="disclaimer"><strong>Honesty notice.</strong> ${escapeHtml(REPORT_DISCLAIMER)}</div>

  <h2>Summary</h2>
  <div class="grid">
    <div class="stat"><div class="muted">Classification</div><div class="v" style="font-size:15px"><span class="badge ${classificationClass}">${escapeHtml((a.classification ?? "inconclusive").replace(/_/g, " "))}</span></div></div>
    <div class="stat"><div class="muted">Likelihood score</div><div class="v">${a.likelihoodScore !== null ? pct(a.likelihoodScore) : "n/a"}</div></div>
    <div class="stat"><div class="muted">Confidence</div><div class="v">${a.confidence !== null ? pct(a.confidence) : "n/a"}</div></div>
    <div class="stat"><div class="muted">Modality</div><div class="v" style="font-size:15px">${escapeHtml(a.modality)} (${escapeHtml(a.inputType)})</div></div>
  </div>
  <p class="muted">Created ${escapeHtml(a.createdAt)} · Completed ${escapeHtml(a.completedAt ?? "—")} · Processing ${a.processingTime ?? "—"} ms${a.fileName ? ` · File: ${escapeHtml(a.fileName)}` : ""}</p>

  ${a.warnings.length ? `<h2>Warnings</h2><ul class="warnings">${a.warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join("")}</ul>` : ""}

  <h2>Detector runs</h2>
  <table><thead><tr><th>Detector</th><th>Status</th><th>Duration</th><th>Summary / error</th></tr></thead><tbody>${runsRows}</tbody></table>

  <h2>Signals &amp; evidence</h2>
  ${a.signals.length ? `<table><thead><tr><th>Signal</th><th>Value</th><th>Direction</th><th>AI score</th><th>Weight</th><th>Evidence</th></tr></thead><tbody>${signalsRows}</tbody></table>` : `<p class="muted">No quantifiable signals were produced.</p>`}

  ${a.llmInterpretation ? `<h2>LLM interpretation (${escapeHtml(a.llmProvider ?? "")} · ${escapeHtml(a.llmModel ?? "")})</h2><div class="interp">${escapeHtml(a.llmInterpretation)}</div><p class="muted">The LLM explanation layer did not influence the verdict.</p>` : ""}

  ${a.errors.length ? `<h2>Errors</h2><ul class="warnings">${a.errors.map((e) => `<li>${escapeHtml(e)}</li>`).join("")}</ul>` : ""}

  <h2>Metadata</h2>
  <pre class="interp">${escapeHtml(JSON.stringify(a.metadata ?? {}, null, 2))}</pre>

  <footer>
    ${escapeHtml(APP_NAME)} v${escapeHtml(APP_VERSION)} · analysis engine v${escapeHtml(ENGINE_VERSION)} · report spec 1.0<br>
    ${escapeHtml(REPORT_DISCLAIMER)}
  </footer>
</div>
</body>
</html>`;
}

export const builtinExporters: ReportExporter[] = [new JsonReportExporter(), new HtmlReportExporter()];
