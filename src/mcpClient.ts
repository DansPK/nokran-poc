// The MCP connection to the harness: Streamable HTTP to `nokran.mcpBaseUrl`, with the API
// key (the `nokran.apiKey` setting, or secret storage) sent as a Bearer token. The server runs elsewhere --
// this machine or another -- and Nokran only ever talks to it over MCP.

import * as vscode from "vscode";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport, StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import type { ErrorAction } from "./protocol";
import type { ReportItem } from "./report";

/**
 * What the harness streams while a tool runs, one per MCP progress notification (its
 * `message` is the JSON event). See app/mcp_server.py in the harness.
 */
export type HarnessEvent =
  | { type: "analysis"; number: number; total: number; finding: ReportItem["finding"]; analysis: ReportItem["analysis"] }
  | { type: "finding_text"; number: number; field: "explanation" | "suggested_fix"; text: string }
  | { type: "finding"; number: number; total: number; item: ReportItem }
  | { type: "step"; tool: string; args: Record<string, unknown>; why: string }
  | { type: "token"; text: string }
  | { type: "log"; level?: string; text: string };


/** An error whose message is fit to show the user as is. */
export class UserFacingError extends Error {
  constructor(
    message: string,
    readonly action?: ErrorAction,
  ) {
    super(message);
  }
}

export function readBaseUrl(): string {
  return vscode.workspace.getConfiguration("nokran").get<string>("mcpBaseUrl", "").trim();
}

export class McpConnection implements vscode.Disposable {
  private client?: Client;
  private connecting?: Promise<Client>;

  constructor(
    private readonly log: vscode.OutputChannel,
    private readonly apiKey: () => Thenable<string | undefined>,
  ) {}

  /** Connect lazily, and reuse the connection until it fails or settings change. */
  ensureConnected(): Promise<Client> {
    if (this.client) return Promise.resolve(this.client);
    this.connecting ??= this.connect().finally(() => (this.connecting = undefined));
    return this.connecting;
  }

  async callTool(
    name: "scan" | "ask",
    args: Record<string, unknown>,
    opts: {
      timeoutMs: number;
      signal: AbortSignal;
      timeoutSetting: string;
      onEvent?: (event: HarnessEvent) => void;
    },
  ): Promise<unknown> {
    const client = await this.ensureConnected();
    let result;
    try {
      // The SDK's default timeout is 60s; scans take minutes, so always pass ours.
      result = await client.callTool({ name, arguments: args }, undefined, {
        timeout: opts.timeoutMs,
        signal: opts.signal,
        resetTimeoutOnProgress: false,
        // Passing onprogress makes the SDK send a progress token, which is what turns
        // streaming on in the harness.
        onprogress: opts.onEvent && ((p) => parseEvent(p.message, opts.onEvent!)),
      });
    } catch (err) {
      if (opts.signal.aborted) throw err;
      if (err instanceof McpError && err.code === ErrorCode.RequestTimeout) {
        const minutes = Math.round(opts.timeoutMs / 60_000);
        throw new UserFacingError(
          `The ${name} took longer than ${minutes} minutes and was cancelled. You can raise the limit with the \`${opts.timeoutSetting}\` setting.`,
          "openSettings",
        );
      }
      // The connection may be gone (server restarted, network): start over next time.
      await this.disconnect();
      throw this.friendly(err);
    }

    const text = (result.content as { type: string; text?: string }[] | undefined)?.find((c) => c.type === "text")?.text;
    if (result.isError) {
      const detail = (text ?? "unknown error").replace(/^Error executing tool \w+:\s*/, "");
      throw new UserFacingError(`The server reported an error: ${detail}`, "showLog");
    }
    if (result.structuredContent) return result.structuredContent;
    if (text === undefined) throw new UserFacingError("The server returned an empty result.", "showLog");
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  async disconnect(): Promise<void> {
    const client = this.client;
    this.client = undefined;
    await client?.close().catch(() => undefined);
  }

  dispose(): void {
    void this.disconnect();
  }

  private async connect(): Promise<Client> {
    const base = readBaseUrl();
    let url: URL;
    try {
      url = new URL(base);
    } catch {
      throw new UserFacingError(
        base ? `\`nokran.mcpBaseUrl\` is not a valid URL: ${base}` : "Set `nokran.mcpBaseUrl` to your MCP server's URL.",
        "openSettings",
      );
    }
    const key = await this.apiKey();
    const transport = new StreamableHTTPClientTransport(url, {
      requestInit: { headers: key ? { Authorization: `Bearer ${key}` } : {} },
    });
    const client = new Client({ name: "nokran", version: "0.3.0" });
    this.log.appendLine(`[nokran] connecting to ${url.href}${key ? " with an API key" : " without an API key"}`);
    try {
      await client.connect(transport);
    } catch (err) {
      await client.close().catch(() => undefined);
      throw this.friendly(err);
    }
    client.onclose = () => {
      if (this.client === client) this.client = undefined;
    };
    this.client = client;
    try {
      const { tools } = await client.listTools();
      this.log.appendLine(`[nokran] connected; tools: ${tools.map((t) => t.name).join(", ")}`);
    } catch (err) {
      this.log.appendLine(`[nokran] connected; listing tools failed: ${String(err)}`);
    }
    return client;
  }

  /** Turn transport failures into something the user can act on. */
  private friendly(err: unknown): Error {
    if (err instanceof UserFacingError) return err;
    this.log.appendLine(`[nokran] ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
    const base = readBaseUrl();
    if (err instanceof StreamableHTTPError && (err.code === 401 || err.code === 403)) {
      return new UserFacingError(
        "The server rejected the API key (or none was set). Set `nokran.apiKey` in settings, or run **Nokran: Set API Key**, with the key from the server's `MCP_API_KEY`.",
        "setApiKey",
      );
    }
    if (err instanceof StreamableHTTPError && err.code === 404) {
      return new UserFacingError(`Nothing answers MCP at ${base}. The URL usually ends in \`/mcp\`.`, "openSettings");
    }
    const cause = (err as { cause?: { code?: string } })?.cause?.code;
    if (cause === "ECONNREFUSED" || cause === "ENOTFOUND" || cause === "EHOSTUNREACH" || /fetch failed/i.test(String(err))) {
      return new UserFacingError(
        `Cannot reach the MCP server at ${base}. Is it running (\`uv run scan-mcp\` in the harness)?`,
        "openSettings",
      );
    }
    return new UserFacingError(err instanceof Error ? err.message : String(err), "showLog");
  }
}

function parseEvent(message: string | undefined, onEvent: (event: HarnessEvent) => void): void {
  if (!message) return;
  let event: HarnessEvent;
  try {
    event = JSON.parse(message);
  } catch {
    return; // a server that sends plain progress text: nothing to stream
  }
  onEvent(event);
}
