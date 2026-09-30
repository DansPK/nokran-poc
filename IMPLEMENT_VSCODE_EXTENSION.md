# Implement: VS Code extension (MCP client with a chat UI)

This file explains what to build and why. It has no code on purpose.
Claude Code should read it and implement the extension in a new, separate repo or folder.

## Goal

Build a VS Code extension that works like a chat panel, similar to the Codex chat in VS Code.

- The user types a message, like "scan this code for me".
- The extension works out what the user wants.
- It sends the request to the source-code-analysis harness through MCP.
- It shows the result in the chat.

The extension is the **MCP client**.
The harness (`source-code-analysis-poc`) is the **MCP server**.
The server is described in `IMPLEMENT_MCP_SERVER.md`.

## What the server offers

The server has two tools. The extension only needs these.

1. **`scan`**
   - Input: `path` (absolute path to a folder or a file).
   - Output: a scan report as JSON.
   - Can take several minutes.
2. **`ask`**
   - Input: `path`, `question`, and an optional `transcript`.
   - Output: `answer` and `transcript`.

## Big picture

There are four parts:

1. **Chat view.** A webview in the sidebar. It shows messages and has an input box.
2. **Extension host code.** It receives messages from the webview and decides what to do.
3. **MCP client.** It starts the server and calls its tools.
4. **Server process.** The harness, started as a child process.

The flow for "scan this code for me":

1. The user types the message in the chat view.
2. The webview sends the text to the extension host.
3. The extension host sees it is a scan request.
4. It gets the current workspace folder path.
5. It calls the `scan` tool with that path.
6. While it waits, it shows progress in the chat.
7. When the report arrives, it shows the findings in the chat.

## Language and tools

- TypeScript.
- Use the official MCP TypeScript SDK (`@modelcontextprotocol/sdk`).
  Use its `Client` and its stdio client transport.
- No UI framework is needed. Plain HTML, CSS and a small script in the webview are enough.
- Use a bundler (esbuild is simple) so the SDK is packed into the extension.
- Package with `vsce` into a `.vsix` file.

## Part 1: The chat view

Use a **webview view** in its own sidebar container (an activity bar icon).
Give it a clear name, for example "Security Chat".

What it shows:

- A list of messages. User messages on one side, replies on the other.
- An input box at the bottom. Enter sends. Shift+Enter makes a new line.
- A send button, and a stop button while a request runs.
- A small status line for live progress, like "Running Semgrep…".
- A "new chat" button that clears the messages and the ask transcript.

How replies look:

- Plain answers are shown as Markdown.
- Scan results are shown as finding cards (see "Showing scan results").
- Errors are shown in a clear error style, with the message from the server.

Look and feel:

- Use VS Code theme CSS variables (like `--vscode-editor-background`).
  Then it looks right in light and dark themes.
- Keep it simple and readable.

Security of the webview:

- Set a strict Content Security Policy.
- Load scripts only from the extension's own folder, with a nonce.
- Treat all text from the server as untrusted. Escape it before showing it.
  If you render Markdown, sanitize the HTML.

Messages between webview and extension:

- The webview sends: "user sent a message", "stop", "new chat", "open this file at this line".
- The extension sends: "add a reply", "update progress", "request finished", "show error".
- Keep a small, fixed set of message types.

## Part 2: Deciding what the user wants

Keep this simple and predictable. Do not use an LLM for it.

Slash commands come first. They are exact:

- `/scan` — scan the whole workspace folder.
- `/scan-file` — scan the file open in the editor.
- `/ask <question>` — ask a question.
- `/help` — show what the chat can do.

Then plain text, using simple keyword rules:

- If the text mentions "scan" (or "audit", "check for vulnerabilities") → scan.
  - If it also says "this file" or "current file" → scan the active file.
  - Otherwise → scan the workspace folder.
- Anything else → send it to `ask` as a question.

Show the user which action was chosen, as a small line in the chat.
For example: "Scanning folder: my-project".
This makes the routing clear, and the user can correct it.

## Part 3: Getting the path

The server needs an **absolute path**.

- Workspace folder: use the first workspace folder's file system path.
- If there are several folders, ask the user which one (a quick pick). Remember the choice for this chat.
- Active file: use the active text editor's file path.
- If no folder is open, reply with a friendly message: "Open a folder first."
- If no file is open for `/scan-file`, say so.

Do not send unsaved changes. The server reads files from disk.
If the active file has unsaved changes, offer to save first.

## Part 4: The MCP client

### Starting the server

Start the server as a child process over stdio.
The command comes from settings (see "Settings").

The default command is:
`uv run --directory <harness path> scan-mcp`

- The harness path is a setting. The user must set it once.
- `--directory` makes uv use the harness's own environment and `.env` file.
- If the harness path is not set, show a message with a button to open settings.

### When to connect

- Connect lazily, on the first request. Not when VS Code starts.
- Reuse one connection for the whole session.
- If the process dies, show an error. Reconnect on the next request.
- Close the connection and stop the process when the extension deactivates.
- Restart the server when the relevant settings change.

### Timeouts (important)

The TypeScript SDK has a **default request timeout of about 60 seconds**.
A scan often takes longer. With the default, scans will fail.

- Pass a long timeout on each `scan` call. Make it a setting. Default: 30 minutes.
- `ask` can use a shorter timeout. Default: 5 minutes.

### Stopping a request

The stop button must really stop the request.

- Pass an abort signal to the tool call.
- When the user presses stop, abort it.
- If the server keeps working anyway, it is fine to restart the server process.

### Live progress

The server's pipeline writes log lines to **stderr**.
Examples: "Source: …", "Candidate findings: 3", "VULN-001: Likely Vulnerable…".

- Ask the stdio transport to pipe stderr, instead of ignoring it.
- Read stderr line by line.
- Show the latest line in the chat status line.
- Also write every line to a VS Code **Output channel** named after the extension.
  This helps with debugging.

### Reading tool results

- The result comes back as content. The JSON is in the first text item.
  Newer SDK versions may also give `structuredContent`. Prefer it when present.
- If the result says it is an error, show the error text in the chat.

## Part 5: Showing scan results

The scan report has:

- `repository_root`, `files_scanned`, `candidates_found`.
- `items`, one per finding. Each item has:
  - `id` (like `VULN-001`).
  - `finding`: `file`, `line`, `rule_id`, `message`.
  - `analysis`: `vulnerability_type`, `status`, `severity`, `confidence`, `source`, `sink`, `data_flow`, `evidence`, `impact`.
  - `explanation` and `suggested_fix`.

Show it like this:

1. **A summary line first.** For example: "Scanned 42 files. 5 candidates. 2 likely vulnerable."
2. **One card per finding.** Each card shows:
   - The id, the vulnerability type, and the severity as a colored badge.
   - The status and confidence.
   - The file and line, as a **clickable link**. Clicking opens the file at that line in the editor.
   - Source and sink.
   - The data flow as a short chain of files.
   - The explanation and suggested fix, folded by default. The user can expand them.
3. **Sort** by the order the server gives. The server already sorts them.
4. If there are no findings, say so clearly. "No issues found" is a good result.

Status matters. Keep the four statuses visible and distinct:
"Likely Vulnerable", "Possible Vulnerability", "Likely False Positive", "Needs Manual Review".
Do not present any finding as confirmed. The server's wording already avoids that. Keep it.

File paths in findings are relative to `repository_root`.
Join them to get the full path before opening the file.

### Optional: Problems panel

As an extra, add each finding to VS Code's **Problems** panel with a diagnostic collection.

- Map severity: Critical and High → error, Medium → warning, Low and Info → information.
- Clear old diagnostics before a new scan.

Do this after the chat works. It is not required for the first version.

## Part 6: Follow-up questions

The server is stateless. The client keeps the conversation.

- Store the `transcript` from each `ask` answer, per chat.
- Send it back with the next question.
- "New chat" clears it.
- If the user changes the folder, start a new transcript.

## Settings

Keep the list short:

- **Harness path** — the folder of the `source-code-analysis-poc` repo. Required.
- **Server command** — default `uv`. Lets a user point to a full path to `uv`.
- **Server args** — default `run --directory ${harnessPath} scan-mcp`.
- **Scan timeout (minutes)** — default 30.
- **Ask timeout (minutes)** — default 5.

The LLM key is **not** a setting here. It lives in the harness's `.env` file.
The extension never sees the key.

## Commands

Register a few commands in the Command Palette:

- Open the chat.
- Scan workspace.
- Scan current file.
- Restart the server.
- Show the output log.

Also add "Scan this file" to the editor right-click menu. It opens the chat and runs the scan.

## Error cases to handle

Handle each with a clear, plain message in the chat:

- Harness path not set → button to open settings.
- `uv` not found → "Install uv, or set the full path in settings."
- Server exits at start → show the last stderr lines. Often it is a missing `.env` or `uv sync` not run.
- Tool error (for example Semgrep failed, or LLM key missing) → show the server's message.
- Timeout → say the scan took too long, and name the timeout setting.
- No folder open → "Open a folder first."

## Things the extension must not do

- It must not change the user's code. The harness only recommends fixes. The extension only shows them.
- It must not send code anywhere except to the local server process.
- It must not store the LLM key.

## Suggested file layout

A small layout is enough:

- `package.json` — extension manifest, contributions, settings, commands.
- `src/extension` — activation, command registration.
- `src/mcpClient` — start, connect, call tools, read stderr, restart.
- `src/router` — decide scan, scan-file or ask from the text.
- `src/chatView` — the webview view provider and message handling.
- `media/` — the webview HTML script and CSS.
- `README.md` — setup steps.

## Build order

Build in small steps. Check each one works before the next.

1. Empty extension with the sidebar chat view. Echo the user's message back.
2. MCP client: start the server, list tools, log them to the Output channel.
3. `/scan` with a long timeout. Show the raw JSON.
4. Replace raw JSON with the summary and finding cards. Add click to open a file.
5. Live progress from stderr.
6. `/ask` and follow-up questions with the transcript.
7. Plain-text routing ("scan this code for me").
8. Stop button, restart command, error messages.
9. Optional: Problems panel.
10. Package as `.vsix` and write the README.

## How to test

- Unit test the router: many example sentences, check each picks the right action.
- Unit test the report-to-card logic with a saved sample report JSON.
- Manual test with the real harness:
  1. Set the harness path.
  2. Open the harness's own `tests/vulnerable_samples/flask_app` folder in VS Code.
  3. Type "scan this code for me".
  4. Check that you see progress, then a SQL injection card.
  5. Click the file link. The editor should jump to the right line.
  6. Ask "where does user input reach the database?", then a follow-up question.

## README for users

The README should explain setup in short steps:

1. Clone `source-code-analysis-poc`. Run `uv sync`. Set the LLM key in its `.env`.
2. Install the `.vsix`.
3. Set the harness path in settings.
4. Open a folder. Open the chat. Type "scan this code for me".
