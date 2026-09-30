// Work out the absolute path the server should look at. The server reads from disk,
// so unsaved editor changes are offered a save first.

import * as vscode from "vscode";
import { UserFacingError } from "./mcpClient";

/** The workspace folder for this chat. Asks once when there are several, then remembers. */
export async function pickFolder(remembered: string | undefined): Promise<string> {
  const folders = (vscode.workspace.workspaceFolders ?? []).filter((f) => f.uri.scheme === "file");
  if (folders.length === 0) throw new UserFacingError("Open a folder first.");
  if (remembered && folders.some((f) => f.uri.fsPath === remembered)) return remembered;
  if (folders.length === 1) return folders[0].uri.fsPath;

  const pick = await vscode.window.showQuickPick(
    folders.map((f) => ({ label: f.name, description: f.uri.fsPath, path: f.uri.fsPath })),
    { placeHolder: "Which folder should Nokran use?" },
  );
  if (!pick) throw new UserFacingError("No folder chosen.");
  return pick.path;
}

/** The file in the active editor, saved to disk. */
export async function activeFile(): Promise<string> {
  const doc = vscode.window.activeTextEditor?.document ?? lastFileEditor()?.document;
  if (!doc || doc.uri.scheme !== "file") {
    throw new UserFacingError("No file is open. Open a file in the editor, then try `/scan-file` again.");
  }
  await ensureSaved([doc]);
  return doc.uri.fsPath;
}

/** Offer to save dirty files inside `folder` before the server reads them. */
export async function saveDirtyIn(folder: string): Promise<void> {
  const dirty = vscode.workspace.textDocuments.filter(
    (d) => d.isDirty && d.uri.scheme === "file" && d.uri.fsPath.startsWith(folder),
  );
  await ensureSaved(dirty);
}

async function ensureSaved(docs: vscode.TextDocument[]): Promise<void> {
  const dirty = docs.filter((d) => d.isDirty);
  if (dirty.length === 0) return;
  const what = dirty.length === 1 ? vscode.workspace.asRelativePath(dirty[0].uri) : `${dirty.length} files`;
  const choice = await vscode.window.showWarningMessage(
    `${what} has unsaved changes. The scanner reads files from disk.`,
    "Save and continue",
    "Continue without saving",
  );
  if (choice === "Save and continue") {
    await Promise.all(dirty.map((d) => d.save()));
  } else if (choice !== "Continue without saving") {
    throw new UserFacingError("Cancelled.");
  }
}

// When the chat view has focus there is no active text editor; fall back to a visible one.
function lastFileEditor(): vscode.TextEditor | undefined {
  return vscode.window.visibleTextEditors.find((e) => e.document.uri.scheme === "file");
}
