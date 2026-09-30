import { describe, expect, it } from "vitest";
import sample from "./fixtures/sample-report.json";
import { diagnosticLevel, isScanReport, reportToView, summarize, toCard, type ScanReport } from "../src/report";

const report = sample as unknown as ScanReport;

describe("reportToView", () => {
  it("recognises a scan report", () => {
    expect(isScanReport(report)).toBe(true);
    expect(isScanReport({ answer: "x" })).toBe(false);
  });

  it("keeps the server's order and joins paths to the repository root", () => {
    const view = reportToView(report, "/projects/DSVW");
    expect(view.cards.map((c) => c.id)).toEqual(report.items.map((i) => i.id));
    expect(view.cards[0].absPath).toBe("/projects/DSVW/dsvw.py");
    expect(view.cards[0].line).toBe(report.items[0].finding.line);
    expect(view.cards[0].severity).toBe("Critical");
  });

  it("summarises counts by status", () => {
    expect(summarize(report)).toBe("Scanned 12 files. 3 candidates. 3 likely vulnerable.");
  });

  it("says clearly when nothing was found", () => {
    const empty: ScanReport = { repository_root: "/r", files_scanned: 1, candidates_found: 0, items: [] };
    expect(summarize(empty)).toBe("Scanned 1 file. 0 candidates. No issues found.");
    expect(reportToView(empty, "/r").cards).toEqual([]);
  });

  it("fills missing optional fields with empty values", () => {
    const minimal: ScanReport = {
      repository_root: "/r",
      files_scanned: 1,
      candidates_found: 1,
      items: [
        {
          id: "VULN-001",
          finding: { file: "a/b.py", line: 3, rule_id: "r", message: "m" },
          analysis: { vulnerability_type: "XSS", status: "Needs Manual Review", severity: "Low", confidence: "Low" },
        },
      ],
    };
    const [card] = reportToView(minimal, "/r").cards;
    expect(card).toMatchObject({ absPath: "/r/a/b.py", dataFlow: [], source: "", suggestedFix: "" });
    expect(summarize(minimal)).toContain("1 needs manual review.");
  });

  it("maps severity to Problems panel levels", () => {
    expect(["Critical", "High", "Medium", "Low", "Info"].map(diagnosticLevel)).toEqual([
      "error", "error", "warning", "information", "information",
    ]);
  });
});

describe("toCard", () => {
  it("resolves a streamed finding against the scanned folder", () => {
    const [item] = report.items;
    expect(toCard("/work/proj", item).absPath).toBe(`/work/proj/${item.finding.file}`);
    expect(toCard("/work/proj", item)).toEqual(reportToView(report, "/work/proj").cards[0]);
  });
});
