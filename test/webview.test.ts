// @vitest-environment jsdom
// The chat webview, driven with the messages a real scan and ask produce.
import { beforeAll, describe, expect, it } from "vitest";
import type { Card } from "../src/report";
import type { ToWebview } from "../src/protocol";

const sent: unknown[] = [];

beforeAll(async () => {
  document.body.innerHTML = `
    <main id="messages"></main>
    <div id="status" hidden><span id="status-text"></span></div>
    <form id="composer"><textarea id="input"></textarea><button id="send"></button><button id="stop" hidden></button></form>
    <button id="new-chat"></button>`;
  (globalThis as any).acquireVsCodeApi = () => ({ postMessage: (m: unknown) => sent.push(m) });
  // Render "frames" immediately so streamed text is visible synchronously.
  (globalThis as any).requestAnimationFrame = (fn: () => void) => (fn(), 0);
  await import("../media/main");
});

const post = (msg: ToWebview) => window.dispatchEvent(new MessageEvent("message", { data: msg }));
const messages = () => document.getElementById("messages")!;

const card = (over: Partial<Card> = {}): Card => ({
  id: "VULN-001", vulnerabilityType: "SQL Injection", severity: "High", status: "Likely Vulnerable",
  confidence: "High", file: "db/repo.py", absPath: "/p/db/repo.py", line: 17, ruleId: "sqli", message: "m",
  source: "request.args", sink: "execute", dataFlow: [], evidence: "", impact: "", explanation: "", suggestedFix: "",
  ...over,
});

describe("streaming in the chat", () => {
  it("an ask shows its activity trail, then types out the answer", () => {
    post({ type: "clear" });
    post({ type: "busy", busy: true });
    post({ type: "activity", text: "Reading routes/search.py — the route handler" });
    post({ type: "activity", text: "Looking up search_users" });

    const trail = messages().querySelector("details.activity") as HTMLDetailsElement;
    expect(trail.open).toBe(true);
    expect([...trail.querySelectorAll("li")].map((li) => li.textContent)).toEqual([
      "Reading routes/search.py — the route handler",
      "Looking up search_users",
    ]);

    post({ type: "token", text: "The **search" });
    post({ type: "token", text: "** route builds SQL" });
    const answer = messages().querySelector(".message.assistant .markdown")!;
    expect(answer.classList.contains("streaming")).toBe(true);
    expect(answer.textContent!.trim()).toBe("The search route builds SQL");
    expect(answer.querySelector("strong")?.textContent).toBe("search");

    post({ type: "reply", markdown: "The **search** route builds SQL by concatenation." });
    post({ type: "busy", busy: false });
    expect(answer.classList.contains("streaming")).toBe(false);
    expect(answer.textContent!.trim()).toBe("The search route builds SQL by concatenation.");
    expect(trail.open).toBe(false);
    expect(trail.querySelector("summary")!.textContent).toMatch(/^Activity · 2 steps · \d+s$/);
  });

  it("a scan shows each card at its verdict, types its explanation and fix, then the sorted report", () => {
    post({ type: "clear" });
    post({ type: "busy", busy: true });
    post({ type: "activity", text: "Running Semgrep on /p with 5 ruleset(s)" });
    post({ type: "activity", text: "Semgrep: Syntax error at mvnw:86", warning: true });

    post({ type: "finding", number: 1, card: card(), done: 0, total: 2, final: false });
    const live = () => messages().querySelector("article.card")!;
    expect(live().classList.contains("live")).toBe(true);
    expect(live().querySelector<HTMLElement>('[data-field="explanation"]')!.hidden).toBe(true);

    post({ type: "findingText", number: 1, field: "explanation", text: "The `q` parameter " });
    post({ type: "findingText", number: 1, field: "explanation", text: "reaches the query." });
    const explanation = live().querySelector<HTMLElement>('[data-field="explanation"]')!;
    expect(explanation.hidden).toBe(false);
    expect(explanation.textContent).toContain("The q parameter reaches the query.");
    expect(explanation.querySelector(".markdown")!.classList.contains("streaming")).toBe(true);

    post({ type: "findingText", number: 1, field: "suggested_fix", text: "Use a parameterized query." });
    // The explanation is done once the fix starts.
    expect(explanation.querySelector(".markdown")!.classList.contains("streaming")).toBe(false);

    post({ type: "finding", number: 1, card: card({ explanation: "The q parameter reaches the query.", suggestedFix: "Use a parameterized query." }), done: 1, total: 2, final: true });
    expect(messages().querySelectorAll("article.card")).toHaveLength(1); // replaced, not duplicated
    expect(live().classList.contains("live")).toBe(false);
    expect([...live().querySelectorAll("details")].every((d) => (d as HTMLDetailsElement).open)).toBe(true);
    expect(messages().querySelector(".report .summary")!.textContent).toBe("Analyzing findings… 1 of 2 done.");
    expect(messages().querySelector(".activity li.warning")?.textContent).toMatch(/Syntax error/);

    post({ type: "report", summary: "Scanned 9 files. 2 candidates.", cards: [card({ id: "VULN-002" }), card()] });
    post({ type: "busy", busy: false });
    expect([...messages().querySelectorAll(".card-id")].map((e) => e.textContent)).toEqual(["VULN-002", "VULN-001"]);
    expect(messages().querySelectorAll(".report")).toHaveLength(1);
  });

  it("a stopped scan keeps what streamed and says it is partial", () => {
    post({ type: "clear" });
    post({ type: "busy", busy: true });
    post({ type: "finding", number: 1, card: card(), done: 0, total: 3, final: false });
    post({ type: "findingText", number: 1, field: "explanation", text: "Half an expla" });
    post({ type: "busy", busy: false });

    expect(messages().querySelector(".report .summary")!.textContent).toMatch(/^Partial results: 0 of 3/);
    expect(messages().textContent).toContain("Half an expla");
    expect(messages().querySelector(".streaming")).toBeNull();
  });
});
