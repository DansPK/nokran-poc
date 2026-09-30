// Turn a ScanReport from the server into what the chat shows. Pure, so it is unit tested
// without VS Code. Shapes mirror app/models/*.py in source-code-vuln-poc.

import * as path from "node:path";

export type Status =
  | "Likely Vulnerable"
  | "Possible Vulnerability"
  | "Likely False Positive"
  | "Needs Manual Review";
export type Severity = "Critical" | "High" | "Medium" | "Low" | "Info";

export interface ScanReport {
  repository_root: string;
  files_scanned: number;
  candidates_found: number;
  items: ReportItem[];
}

export interface ReportItem {
  id: string;
  finding: { file: string; line: number; rule_id: string; message: string; vulnerability_type?: string };
  analysis: {
    vulnerability_type: string;
    status: Status;
    severity: Severity;
    confidence: string;
    source?: string;
    source_file?: string;
    sink?: string;
    sink_file?: string;
    data_flow?: string[];
    evidence?: string;
    impact?: string;
  };
  explanation?: string;
  suggested_fix?: string;
}

/** A finding card as the webview renders it. All strings are untrusted server text. */
export interface Card {
  id: string;
  vulnerabilityType: string;
  severity: string;
  status: string;
  confidence: string;
  file: string; // relative, for display
  absPath: string; // for opening
  line: number;
  ruleId: string;
  message: string;
  source: string;
  sink: string;
  dataFlow: string[];
  evidence: string;
  impact: string;
  explanation: string;
  suggestedFix: string;
}

export interface ReportView {
  summary: string;
  cards: Card[];
}

export const STATUSES: Status[] = [
  "Likely Vulnerable",
  "Possible Vulnerability",
  "Likely False Positive",
  "Needs Manual Review",
];

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function summarize(report: ScanReport): string {
  const parts = [`Scanned ${plural(report.files_scanned, "file")}.`, `${plural(report.candidates_found, "candidate")}.`];
  if (report.items.length === 0) {
    parts.push("No issues found.");
    return parts.join(" ");
  }
  for (const status of STATUSES) {
    const n = report.items.filter((i) => i.analysis.status === status).length;
    if (n > 0) parts.push(`${n} ${status.toLowerCase()}.`);
  }
  return parts.join(" ");
}

/**
 * `root` is the scanned folder on this machine. The report's own `repository_root` is a
 * path on the server -- a clone or an upload when the server is remote -- so it is not used.
 */
export function reportToView(report: ScanReport, root: string): ReportView {
  // Keep the server's order: it already sorts by status and severity.
  return { summary: summarize(report), cards: report.items.map((item) => toCard(root, item)) };
}

/** One finding as a card. `root` is the scanned folder; finding paths are relative to it. */
export function toCard(root: string, item: ReportItem): Card {
  return {
    id: item.id,
    vulnerabilityType: item.analysis.vulnerability_type || item.finding.vulnerability_type || "Finding",
    severity: item.analysis.severity,
    status: item.analysis.status,
    confidence: item.analysis.confidence,
    file: item.finding.file,
    absPath: path.resolve(root, item.finding.file),
    line: item.finding.line,
    ruleId: item.finding.rule_id,
    message: item.finding.message,
    source: item.analysis.source ?? "",
    sink: item.analysis.sink ?? "",
    dataFlow: item.analysis.data_flow ?? [],
    evidence: item.analysis.evidence ?? "",
    impact: item.analysis.impact ?? "",
    explanation: item.explanation ?? "",
    suggestedFix: item.suggested_fix ?? "",
  };
}

/** Problems panel level, as a name so this module stays free of the vscode import. */
export function diagnosticLevel(severity: string): "error" | "warning" | "information" {
  if (severity === "Critical" || severity === "High") return "error";
  if (severity === "Medium") return "warning";
  return "information";
}

export function isScanReport(value: unknown): value is ScanReport {
  const v = value as ScanReport;
  return !!v && typeof v === "object" && typeof v.repository_root === "string" && Array.isArray(v.items);
}
