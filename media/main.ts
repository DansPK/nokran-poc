// Webview script. Everything from the extension (and so from the server) is untrusted:
// plain text goes in with textContent, Markdown goes through DOMPurify.

import DOMPurify from "dompurify";
import { marked } from "marked";
import type { Card } from "../src/report";
import type { ErrorAction, FromWebview, ToWebview } from "../src/protocol";

declare function acquireVsCodeApi(): { postMessage(msg: FromWebview): void };
const vscode = acquireVsCodeApi();
const send = (msg: FromWebview) => vscode.postMessage(msg);

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const messages = $<HTMLElement>("messages");
const input = $<HTMLTextAreaElement>("input");
const sendButton = $<HTMLButtonElement>("send");
const stopButton = $<HTMLButtonElement>("stop");
const status = $<HTMLElement>("status");
const statusText = $<HTMLElement>("status-text");

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function markdown(text: string): HTMLElement {
  const div = el("div", "markdown");
  fillMarkdown(div, text);
  return div;
}

function fillMarkdown(div: HTMLElement, text: string): void {
  div.innerHTML = DOMPurify.sanitize(marked.parse(text, { async: false }) as string);
  // Links in answers would navigate the webview; open nothing, show the target instead.
  div.querySelectorAll("a").forEach((a) => {
    a.removeAttribute("href");
    a.title = a.textContent ?? "";
  });
}

/** Run a DOM change, and keep the view pinned to the bottom if it was there before. */
function keepScrolled(change: () => void): void {
  const stick = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 40;
  change();
  if (stick) messages.scrollTop = messages.scrollHeight;
}

function append(node: HTMLElement): void {
  keepScrolled(() => messages.append(node));
}

function bubble(kind: "user" | "assistant" | "error", content: HTMLElement): HTMLElement {
  const b = el("div", `message ${kind}`);
  b.append(content);
  append(b);
  return b;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z]+/g, "-");

function fileLink(card: Card): HTMLElement {
  const a = el("a", "file-link", `${card.file}:${card.line}`);
  a.href = "#";
  a.title = `Open ${card.absPath}`;
  a.addEventListener("click", (e) => {
    e.preventDefault();
    send({ type: "openFile", path: card.absPath, line: card.line });
  });
  return a;
}

function row(label: string, value: string | HTMLElement): HTMLElement {
  const r = el("div", "row");
  r.append(el("span", "label", label));
  const v = typeof value === "string" ? el("span", "value", value) : value;
  v.classList.add("value");
  r.append(v);
  return r;
}

function fold(title: string, body: string, open: boolean): HTMLElement {
  const d = el("details");
  d.open = open;
  d.append(el("summary", undefined, title), markdown(body));
  return d;
}

/** Markdown still being written: re-rendered at most once a frame, however fast it comes. */
class LiveMarkdown {
  text = "";
  private scheduled = false;
  private finished = false;

  constructor(readonly div: HTMLElement) {
    div.classList.add("streaming");
  }

  add(piece: string): void {
    this.text += piece;
    if (this.scheduled) return;
    this.scheduled = true;
    requestAnimationFrame(() => {
      this.scheduled = false;
      if (!this.finished) keepScrolled(() => fillMarkdown(this.div, this.text));
    });
  }

  /** Stop the caret; show `final` (the text as the server settled it) if given. */
  finish(final?: string): void {
    this.finished = true;
    this.div.classList.remove("streaming");
    keepScrolled(() => fillMarkdown(this.div, final ?? this.text));
  }
}

const LIVE_FIELDS = [["explanation", "Explanation"], ["suggested_fix", "Suggested fix"]] as const;

/**
 * `live`: the verdict is in but the explanation and fix are still being written, so the
 * card gets empty slots for them to stream into. `open`: show the folded sections expanded.
 */
function renderCard(card: Card, live = false, open = false): HTMLElement {
  const c = el("article", `card status-${slug(card.status)}`);

  const head = el("div", "card-head");
  head.append(
    el("span", "card-id", card.id),
    el("span", "card-type", card.vulnerabilityType),
    el("span", `badge severity-${slug(card.severity)}`, card.severity),
  );
  c.append(head);

  const meta = el("div", "card-meta");
  meta.append(el("span", `status-pill status-${slug(card.status)}`, card.status), el("span", "confidence", `${card.confidence} confidence`));
  c.append(meta);

  c.append(row("Location", fileLink(card)));
  if (card.source) c.append(row("Source", el("code", undefined, card.source)));
  if (card.sink) c.append(row("Sink", el("code", undefined, card.sink)));
  if (card.dataFlow.length) {
    const flow = el("span", "flow");
    card.dataFlow.forEach((step, i) => {
      if (i) flow.append(el("span", "arrow", " → "));
      flow.append(el("span", "step", step));
    });
    c.append(row("Data flow", flow));
  }
  if (card.message) c.append(row("Rule", `${card.ruleId}: ${card.message}`));

  const why = [card.explanation, card.impact && `**Impact:** ${card.impact}`, card.evidence && `**Evidence:** ${card.evidence}`]
    .filter(Boolean)
    .join("\n\n");
  if (live) {
    c.classList.add("live");
    for (const [field, title] of LIVE_FIELDS) {
      const slot = el("section", "live-field");
      slot.dataset.field = field;
      slot.hidden = true; // until its first words arrive
      slot.append(el("div", "live-label", title), el("div", "markdown"));
      c.append(slot);
    }
    return c;
  }
  if (why) c.append(fold("Explanation", why, open));
  if (card.suggestedFix) c.append(fold("Suggested fix", card.suggestedFix, open));
  return c;
}

const DISCLAIMER = "Findings are AI-assisted judgements, not confirmed vulnerabilities. Review each one.";

// What is being streamed right now, if anything. The final reply or report replaces it.
let liveAnswer: LiveMarkdown | undefined;
let liveReport:
  | {
      bubble: HTMLElement;
      wrap: HTMLElement;
      summary: HTMLElement;
      done: number;
      total: number;
      cards: Map<number, { el: HTMLElement; fields: Map<string, LiveMarkdown> }>;
    }
  | undefined;
let activity: { box: HTMLDetailsElement; list: HTMLElement; summary: HTMLElement; count: number; started: number } | undefined;

/** One line in the activity trail: what the server or the agent is doing right now. */
function addActivity(text: string, warning = false): void {
  if (!activity) {
    const box = el("details", "activity") as HTMLDetailsElement;
    box.open = true;
    const summary = el("summary");
    const list = el("ol");
    box.append(summary, list);
    append(box);
    activity = { box, list, summary, count: 0, started: Date.now() };
  }
  const trail = activity;
  trail.count += 1;
  trail.summary.textContent = `Working… ${trail.count} step${trail.count === 1 ? "" : "s"}`;
  keepScrolled(() => trail.list.append(el("li", warning ? "warning" : undefined, text)));
}

/** Fold the trail away once the request is over, keeping it one click from view. */
function endActivity(): void {
  if (!activity) return;
  const { box, summary, count, started } = activity;
  const seconds = Math.round((Date.now() - started) / 1000);
  summary.textContent = `Activity · ${count} step${count === 1 ? "" : "s"} · ${seconds}s`;
  box.open = false;
  activity = undefined;
}

function streamToken(text: string): void {
  if (!liveAnswer) {
    const div = el("div", "markdown");
    bubble("assistant", div);
    liveAnswer = new LiveMarkdown(div);
  }
  liveAnswer.add(text);
}

function renderReply(text: string): void {
  if (!liveAnswer) return void bubble("assistant", markdown(text));
  liveAnswer.finish(text);
  liveAnswer = undefined;
}

function streamFinding(number: number, card: Card, done: number, total: number, final: boolean): void {
  if (!liveReport) {
    const wrap = el("div", "report");
    const summary = el("p", "summary");
    wrap.append(summary);
    liveReport = { bubble: bubble("assistant", wrap), wrap, summary, done, total, cards: new Map() };
  }
  const report = liveReport;
  Object.assign(report, { done, total });
  report.summary.textContent = `Analyzing findings… ${done} of ${total} done.`;

  // A finished card keeps its sections open: the user just watched them being written.
  const next = renderCard(card, !final, true);
  const existing = report.cards.get(number);
  keepScrolled(() => (existing ? existing.el.replaceWith(next) : report.wrap.append(next)));
  report.cards.set(number, { el: next, fields: new Map() });
}

function streamFindingText(number: number, field: string, text: string): void {
  const entry = liveReport?.cards.get(number);
  const slot = entry?.el.querySelector<HTMLElement>(`[data-field="${field}"]`);
  if (!entry || !slot) return;
  slot.hidden = false;
  let live = entry.fields.get(field);
  if (!live) {
    live = new LiveMarkdown(slot.querySelector<HTMLElement>(".markdown")!);
    entry.fields.set(field, live);
    // The previous section is complete once the next one starts.
    entry.fields.forEach((other, name) => name !== field && other.finish());
  }
  live.add(text);
}

function renderReport(summary: string, cards: Card[]): void {
  const wrap = el("div", "report");
  wrap.append(el("p", "summary", summary));
  if (cards.length === 0) wrap.append(el("p", "no-issues", "No issues found. That is a good result."));
  cards.forEach((card) => wrap.append(renderCard(card)));
  wrap.append(el("p", "disclaimer", DISCLAIMER));
  if (!liveReport) return void bubble("assistant", wrap);
  // Replace the streamed cards: the final report is sorted by status and severity.
  const target = liveReport.bubble;
  liveReport = undefined;
  keepScrolled(() => target.replaceChildren(wrap));
}

/** A request ended. Fold the trail; if it ended without its final result (stopped or
 * failed), keep what streamed. */
function endStreams(): void {
  endActivity();
  liveAnswer?.finish();
  liveAnswer = undefined;
  if (liveReport) {
    const { summary, wrap, done, total, cards } = liveReport;
    cards.forEach((entry) => entry.fields.forEach((live) => live.finish()));
    summary.textContent = `Partial results: ${done} of ${total} findings were analyzed before the scan ended.`;
    wrap.append(el("p", "disclaimer", DISCLAIMER));
    liveReport = undefined;
  }
}

const ACTION_LABELS = { openSettings: "Open settings", showLog: "Show output log", setApiKey: "Set API key" };

function renderError(message: string, action?: ErrorAction): void {
  const wrap = el("div");
  wrap.append(markdown(message));
  if (action) {
    const b = el("button", "secondary", ACTION_LABELS[action]);
    b.addEventListener("click", () => send({ type: "action", action }));
    wrap.append(b);
  }
  bubble("error", wrap);
}

function setBusy(busy: boolean): void {
  sendButton.hidden = busy;
  stopButton.hidden = !busy;
  status.hidden = !busy;
  if (!busy) statusText.textContent = "";
}

window.addEventListener("message", (event: MessageEvent<ToWebview>) => {
  const msg = event.data;
  switch (msg.type) {
    case "user":
      bubble("user", el("div", "plain", msg.text));
      break;
    case "routed":
      append(el("div", "routed", msg.text));
      break;
    case "reply":
      renderReply(msg.markdown);
      break;
    case "report":
      renderReport(msg.summary, msg.cards);
      break;
    case "token":
      streamToken(msg.text);
      break;
    case "finding":
      streamFinding(msg.number, msg.card, msg.done, msg.total, msg.final);
      break;
    case "findingText":
      streamFindingText(msg.number, msg.field, msg.text);
      break;
    case "activity":
      addActivity(msg.text, msg.warning);
      break;
    case "progress":
      statusText.textContent = msg.text;
      break;
    case "busy":
      if (!msg.busy) endStreams();
      setBusy(msg.busy);
      break;
    case "error":
      renderError(msg.message, msg.action);
      break;
    case "clear":
      liveAnswer = liveReport = activity = undefined;
      messages.replaceChildren();
      setBusy(false);
      break;
  }
});

function submit(): void {
  const text = input.value.trim();
  if (!text || !stopButton.hidden) return;
  send({ type: "send", text });
  input.value = "";
}

$<HTMLFormElement>("composer").addEventListener("submit", (e) => {
  e.preventDefault();
  submit();
});
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    submit();
  }
});
stopButton.addEventListener("click", () => send({ type: "stop" }));
$<HTMLButtonElement>("new-chat").addEventListener("click", () => send({ type: "newChat" }));

send({ type: "ready" });
