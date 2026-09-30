// The sidebar chat: renders the webview, routes what the user types, calls the MCP server
// and sends the results back. Holds the per-chat state (ask transcript, chosen folder).

import * as path from "node:path";
import * as vscode from "vscode";
import { McpConnection, UserFacingError, type HarnessEvent } from "./mcpClient";
import { activeFile, pickFolder, saveDirtyIn } from "./paths";
import type { FromWebview, ToWebview } from "./protocol";
import { diagnosticLevel, isScanReport, reportToView, toCard, type Card } from "./report";
import { HELP_TEXT, route, type Route } from "./router";
import { resolveSource, SourceError, type ResolvedSource, type SourceMode } from "./source";

export class ChatViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewId = "nokran.chat";

  private view?: vscode.WebviewView;
  private ready = false;
  private pending: ToWebview[] = [];
  private busy?: AbortController;

  // Per-chat state. "New chat" resets it.
  private transcript: string[] | undefined;
  private folder: string | undefined;

  private readonly diagnostics = vscode.languages.createDiagnosticCollection("nokran");

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly server: McpConnection,
    private readonly log: vscode.OutputChannel,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    this.ready = false;
    const media = vscode.Uri.joinPath(this.extensionUri, "media");
    const dist = vscode.Uri.joinPath(this.extensionUri, "dist");
    view.webview.options = { enableScripts: true, localResourceRoots: [media, dist] };
    view.webview.html = this.html(view.webview);
    view.webview.onDidReceiveMessage((msg: FromWebview) => this.onMessage(msg));
    view.onDidDispose(() => {
      this.view = undefined;
      this.ready = false;
    });
  }

  /** Run a chat input as if the user typed it (used by commands). */
  async submit(text: string): Promise<void> {
    await this.reveal();
    await this.handle(text);
  }

  async reveal(): Promise<void> {
    await vscode.commands.executeCommand(`${ChatViewProvider.viewId}.focus`);
  }

  dispose(): void {
    this.busy?.abort();
    this.diagnostics.dispose();
  }

  private async onMessage(msg: FromWebview): Promise<void> {
    switch (msg.type) {
      case "ready":
        this.ready = true;
        this.pending.splice(0).forEach((m) => this.post(m));
        break;
      case "send":
        await this.handle(msg.text);
        break;
      case "stop":
        await this.stop();
        break;
      case "newChat":
        await this.stop();
        this.transcript = undefined;
        this.folder = undefined;
        this.post({ type: "clear" });
        break;
      case "openFile":
        await this.openFile(msg.path, msg.line);
        break;
      case "action":
        if (msg.action === "openSettings") await vscode.commands.executeCommand("workbench.action.openSettings", "nokran");
        else await vscode.commands.executeCommand(msg.action === "setApiKey" ? "nokran.setApiKey" : "nokran.showLog");
        break;
    }
  }

  private async handle(text: string): Promise<void> {
    if (!text.trim()) return;
    if (this.busy) {
      this.post({ type: "error", message: "A request is still running. Press Stop first." });
      return;
    }
    this.post({ type: "user", text });
    const r = route(text);
    if (r.kind === "help") return this.post({ type: "reply", markdown: HELP_TEXT });
    if (r.kind === "invalid") return this.post({ type: "error", message: r.message });

    const controller = new AbortController();
    this.busy = controller;
    this.post({ type: "busy", busy: true });
    try {
      await this.run(r, controller.signal);
    } catch (err) {
      if (controller.signal.aborted) {
        // A line, not a reply: a reply would replace the partly streamed answer.
        this.post({ type: "routed", text: "Stopped. The server may finish the current step in the background." });
      } else if (err instanceof UserFacingError) {
        this.post({ type: "error", message: err.message, action: err.action });
      } else if (err instanceof SourceError) {
        this.post({ type: "error", message: err.message, action: "openSettings" });
      } else {
        this.post({ type: "error", message: err instanceof Error ? err.message : String(err), action: "showLog" });
      }
    } finally {
      if (this.busy === controller) this.busy = undefined;
      this.post({ type: "busy", busy: false });
    }
  }

  private async run(r: Exclude<Route, { kind: "help" | "invalid" }>, signal: AbortSignal): Promise<void> {
    const cfg = vscode.workspace.getConfiguration("nokran");
    const minutes = (key: string, fallback: number) => Math.max(1, cfg.get<number>(key, fallback)) * 60_000;
    const mode = cfg.get<SourceMode>("sourceMode", "path");
    const source = (target: string, isFile: boolean) => {
      this.post({ type: "progress", text: mode === "upload" ? "Packing files to upload…" : "Preparing…" });
      return resolveSource(mode, target, isFile, Math.max(1, cfg.get<number>("maxUploadMB", 50)));
    };
    const announce = (text: string, resolved: ResolvedSource) => {
      this.post({ type: "routed", text: `${text} (${resolved.describe})` });
      resolved.warnings.forEach((w) => this.post({ type: "routed", text: `Warning: ${w}` }));
      this.post({ type: "progress", text: "Waiting for the server…" });
    };
    const logEvent = (event: HarnessEvent) => {
      if (event.type === "log") {
        this.log.appendLine(event.text);
        this.post({ type: "activity", text: event.text, warning: event.level === "warning" });
        this.post({ type: "progress", text: event.text });
      }
    };

    if (r.kind === "ask") {
      const folder = await this.chooseFolder();
      const resolved = await source(folder, false);
      announce(`Asking about: ${path.basename(folder)}`, resolved);
      const onEvent = (event: HarnessEvent) => {
        logEvent(event);
        if (event.type === "token") this.post({ type: "token", text: event.text });
        else if (event.type === "step") {
          const step = describeStep(event.tool, event.args);
          this.post({ type: "activity", text: event.why ? `${step} — ${event.why}` : step });
          this.post({ type: "progress", text: step });
        }
      };
      const result = (await this.server.callTool(
        "ask",
        { ...resolved.args, question: r.question, ...(this.transcript ? { transcript: this.transcript } : {}) },
        { timeoutMs: minutes("askTimeoutMinutes", 5), signal, timeoutSetting: "nokran.askTimeoutMinutes", onEvent },
      )) as { answer?: string; transcript?: string[] };
      if (signal.aborted) return;
      if (Array.isArray(result?.transcript)) this.transcript = result.transcript;
      this.post({ type: "reply", markdown: String(result?.answer ?? result ?? "") });
      return;
    }

    const isFile = r.kind === "scanFile";
    const target = isFile ? await activeFile() : await this.chooseFolder();
    if (!isFile) await saveDirtyIn(target);
    const resolved = await source(target, isFile);
    announce(
      isFile ? `Scanning file: ${vscode.workspace.asRelativePath(target)}` : `Scanning folder: ${path.basename(target)}`,
      resolved,
    );

    // Finding paths are relative to the scanned folder -- for a single file, its folder --
    // in every mode, so they map back to this machine even when the server scanned a
    // clone or an upload.
    const root = isFile ? path.dirname(target) : target;
    let done = 0;
    const onEvent = (event: HarnessEvent) => {
      logEvent(event);
      if (event.type === "analysis") {
        const id = `VULN-${String(event.number).padStart(3, "0")}`;
        const card = toCard(root, { id, finding: event.finding, analysis: event.analysis });
        this.post({ type: "finding", number: event.number, card, done, total: event.total, final: false });
        this.post({ type: "progress", text: `${id}: ${event.analysis.status} — writing the explanation…` });
      } else if (event.type === "finding_text") {
        this.post({ type: "findingText", number: event.number, field: event.field, text: event.text });
      } else if (event.type === "finding") {
        done += 1;
        const card = toCard(root, event.item);
        this.post({ type: "finding", number: event.number, card, done, total: event.total, final: true });
        this.post({ type: "progress", text: `Analyzed ${done} of ${event.total} findings` });
      }
    };
    const report = await this.server.callTool(
      "scan",
      resolved.args as Record<string, unknown>,
      { timeoutMs: minutes("scanTimeoutMinutes", 30), signal, timeoutSetting: "nokran.scanTimeoutMinutes", onEvent },
    );
    if (signal.aborted) return;
    if (!isScanReport(report)) {
      throw new UserFacingError("The server returned something that is not a scan report. See the output log.", "showLog");
    }
    const view = reportToView(report, root);
    this.post({ type: "report", summary: view.summary, cards: view.cards });
    this.publishDiagnostics(view.cards);
  }

  private async chooseFolder(): Promise<string> {
    const folder = await pickFolder(this.folder);
    if (this.folder && folder !== this.folder) this.transcript = undefined; // new folder, new conversation
    this.folder = folder;
    return folder;
  }

  private async stop(): Promise<void> {
    if (!this.busy) return;
    // Aborting cancels the MCP request. The harness runs the pipeline in a thread it
    // cannot interrupt, so the server may still finish the step it is on.
    this.busy.abort();
  }

  private publishDiagnostics(cards: Card[]): void {
    this.diagnostics.clear();
    const byFile = new Map<string, vscode.Diagnostic[]>();
    const levels = {
      error: vscode.DiagnosticSeverity.Error,
      warning: vscode.DiagnosticSeverity.Warning,
      information: vscode.DiagnosticSeverity.Information,
    };
    for (const card of cards) {
      const line = Math.max(0, card.line - 1);
      const d = new vscode.Diagnostic(
        new vscode.Range(line, 0, line, Number.MAX_SAFE_INTEGER),
        `${card.id} ${card.vulnerabilityType} (${card.status}, ${card.confidence} confidence): ${card.message}`,
        levels[diagnosticLevel(card.severity)],
      );
      d.source = "Nokran";
      d.code = card.ruleId;
      const list = byFile.get(card.absPath) ?? [];
      list.push(d);
      byFile.set(card.absPath, list);
    }
    for (const [file, list] of byFile) this.diagnostics.set(vscode.Uri.file(file), list);
  }

  private async openFile(file: string, line: number): Promise<void> {
    try {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
      const pos = new vscode.Position(Math.max(0, line - 1), 0);
      await vscode.window.showTextDocument(doc, {
        selection: new vscode.Range(pos, pos),
        viewColumn: vscode.ViewColumn.One,
      });
    } catch {
      this.post({ type: "error", message: `Could not open ${file}.` });
    }
  }

  private post(msg: ToWebview): void {
    if (this.view && this.ready) void this.view.webview.postMessage(msg);
    else this.pending.push(msg);
  }

  private html(webview: vscode.Webview): string {
    const nonce = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
    const script = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "webview.js"));
    const style = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "media", "main.css"));
    const csp = [
      "default-src 'none'",
      `style-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
      `img-src ${webview.cspSource} data:`,
      `font-src ${webview.cspSource}`,
    ].join("; ");
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${style}" rel="stylesheet">
  <title>Nokran</title>
</head>
<body>
  <header class="toolbar">
    <span class="title">Nokran</span>
    <button id="new-chat" class="icon-button" title="New chat">New chat</button>
  </header>
  <main id="messages" aria-live="polite"></main>
  <div id="status" class="status" hidden><span class="spinner"></span><span id="status-text"></span></div>
  <form id="composer" class="composer">
    <textarea id="input" rows="2" placeholder="Ask about the code, or type &quot;scan this code for me&quot; (/help)"></textarea>
    <div class="buttons">
      <button id="send" type="submit">Send</button>
      <button id="stop" type="button" class="secondary" hidden>Stop</button>
    </div>
  </form>
  <script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
  }
}

/** What the ask agent is doing, for the status line. Arguments come from the model. */
export function describeStep(tool: string, args: Record<string, unknown>): string {
  const arg = (key: string) => String(args[key] ?? "").slice(0, 80);
  switch (tool) {
    case "list_files":
      return "Listing the project's files";
    case "read_file":
      return `Reading ${arg("path")}`;
    case "search":
      return `Searching for ${arg("pattern")}`;
    case "find_symbol":
      return `Looking up ${arg("name")}`;
    case "run_scanner":
      return "Running Semgrep";
    default:
      return `Using ${tool}`;
  }
}
