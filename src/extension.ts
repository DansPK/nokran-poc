import * as vscode from "vscode";
import { ChatViewProvider } from "./chatView";
import { McpConnection } from "./mcpClient";

// The API key comes from the `nokran.apiKey` setting when it is filled in, and otherwise
// from VS Code's secret storage (Nokran: Set API Key), which keeps it out of settings.json.
const API_KEY = "nokran.apiKey";

async function apiKey(context: vscode.ExtensionContext): Promise<string | undefined> {
  const fromSettings = vscode.workspace.getConfiguration("nokran").get<string>("apiKey", "").trim();
  return fromSettings || (await context.secrets.get(API_KEY));
}

export function activate(context: vscode.ExtensionContext): void {
  const log = vscode.window.createOutputChannel("Nokran");
  const server = new McpConnection(log, () => apiKey(context));
  const chat = new ChatViewProvider(context.extensionUri, server, log);

  context.subscriptions.push(
    log,
    server,
    chat,
    vscode.window.registerWebviewViewProvider(ChatViewProvider.viewId, chat, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand("nokran.openChat", () => chat.reveal()),
    vscode.commands.registerCommand("nokran.scanWorkspace", () => chat.submit("/scan")),
    vscode.commands.registerCommand("nokran.scanFile", async (uri?: vscode.Uri) => {
      // From the editor context menu, make sure the clicked file is the active one.
      if (uri instanceof vscode.Uri && uri.scheme === "file") {
        await vscode.window.showTextDocument(uri, { preview: false });
      }
      await chat.submit("/scan-file");
    }),
    vscode.commands.registerCommand("nokran.setApiKey", async () => {
      const key = await vscode.window.showInputBox({
        title: "Nokran: MCP server API key",
        prompt: "The server's MCP_API_KEY. Stored in VS Code's secret storage.",
        password: true,
        ignoreFocusOut: true,
      });
      if (key === undefined) return;
      await context.secrets.store(API_KEY, key.trim());
      await server.disconnect(); // reconnect with the new key on the next request
      const shadowed = vscode.workspace.getConfiguration("nokran").get<string>("apiKey", "").trim();
      vscode.window.showInformationMessage(
        shadowed
          ? "Nokran: API key saved, but the `nokran.apiKey` setting is also set and takes precedence."
          : "Nokran: API key saved.",
      );
    }),
    vscode.commands.registerCommand("nokran.clearApiKey", async () => {
      await context.secrets.delete(API_KEY);
      await server.disconnect();
      vscode.window.showInformationMessage("Nokran: API key removed.");
    }),
    vscode.commands.registerCommand("nokran.reconnect", async () => {
      await server.disconnect();
      try {
        await server.ensureConnected();
        vscode.window.showInformationMessage("Nokran: connected to the MCP server.");
      } catch (err) {
        vscode.window.showErrorMessage(`Nokran: ${err instanceof Error ? err.message : String(err)}`);
      }
    }),
    vscode.commands.registerCommand("nokran.showLog", () => log.show(true)),
    vscode.workspace.onDidChangeConfiguration((e) => {
      // The next request connects with the new URL or key.
      if (e.affectsConfiguration("nokran.mcpBaseUrl") || e.affectsConfiguration("nokran.apiKey")) {
        void server.disconnect();
      }
    }),
  );
}

export function deactivate(): void {
  // Disposables in context.subscriptions close the connection.
}
