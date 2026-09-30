# How it works

Nokran is a thin client. The analysis happens in the harness; Nokran decides what to ask for,
sends the request, and shows the results.

## The big picture

```
┌──────────── VS Code ────────────┐                  ┌──────── harness (scan-mcp) ────────┐
│                                 │                  │                                    │
│  Chat webview  ⇄  Extension     │  MCP over HTTP   │  scan: Semgrep → context → AI      │
│  (media/)         host (src/)  ─┼─────────────────►│  ask:  AI agent with code tools    │
│                                 │ ◄──── events ────┤                                    │
└─────────────────────────────────┘                  └──────────────┬─────────────────────┘
                                                                    │
                                                                    ▼
                                                              AI model (LLM)
```

1. **The chat webview** shows messages and sends what you type to the extension.
2. **The extension host** decides whether the message is a scan or a question, works out how
   to give the server your code, and calls the server.
3. **The MCP client** connects to the server over Streamable HTTP, sends the API key, and
   passes on the events the server streams back.
4. **The harness** does the work and streams progress, findings and text while it runs.

## A scan, step by step

1. You type `scan this code for me`. The router sees the word *scan* and chooses a folder scan.
2. Nokran finds the workspace folder and, depending on the source mode, turns it into a path,
   a Git URL and branch, or a zip upload.
3. It calls the server's `scan` tool and waits, for up to `nokran.scanTimeoutMinutes`.
4. The server runs Semgrep, then asks the AI about each candidate. As it works it sends:
   - log lines, shown in the activity trail;
   - each finding's verdict, which creates a card;
   - the explanation and suggested fix, piece by piece, typed into the card;
   - the finished finding, which replaces the card.
5. The server returns the full report. Nokran shows the summary and the sorted cards, and adds
   the findings to the Problems panel.

File paths in a report are relative to the scanned folder. Nokran joins them to the folder on
your machine, so links work even when the server scanned a clone or an upload.

## A question, step by step

1. Any message that is not a scan becomes a call to the server's `ask` tool, together with the
   conversation so far.
2. The server's agent picks a tool (read a file, search, look up a symbol, run Semgrep), runs
   it, and repeats until it can answer. Each step is streamed to the activity trail.
3. The answer is streamed word by word into the chat.
4. The server returns the answer and an updated conversation transcript. Nokran keeps the
   transcript and sends it with your next question. The server itself remembers nothing
   between requests.

## The server's tools

The harness exposes two MCP tools.

**`scan`** takes exactly one way of naming the code:

| Argument | Meaning |
| --- | --- |
| `path` | An absolute folder or file path on the server. |
| `repo`, `branch` | A Git URL to clone, and optionally the branch. |
| `archive` | A base64-encoded zip of the files. |
| `subpath` | With `repo` or `archive`: scan only this folder or file inside it. |

It returns the scan report: the number of files scanned, the number of candidates, and one
item per finding with its verdict, explanation and suggested fix.

**`ask`** takes the same `path`, `repo`, `branch` or `archive` arguments, a `question`, and an
optional `transcript` from the previous answer. It returns the `answer` and the new
`transcript`.

## Streaming

MCP lets a server send progress notifications while a tool runs. Nokran asks for them, and the
harness uses each notification's message to carry one JSON event:

| Event | Sent by | Meaning |
| --- | --- | --- |
| `log` | both | A line of the server's progress, with its level. |
| `step` | `ask` | The agent used a tool; includes the tool, its arguments and the agent's reason. |
| `token` | `ask` | The next piece of the answer. |
| `analysis` | `scan` | A finding's verdict is ready. |
| `finding_text` | `scan` | The next piece of a finding's explanation or suggested fix. |
| `finding` | `scan` | A finding is complete. |

A client that does not ask for progress gets the same final result, just without the live
updates.

## Security

- **Authentication.** When the server has `MCP_API_KEY` set, it rejects every request without
  the matching `Authorization: Bearer` header.
- **Content Security Policy.** The chat webview only runs Nokran's own bundled script, and
  everything from the server is treated as untrusted. Plain text is inserted as text, and
  Markdown is sanitized before it is displayed. Links in answers are disabled so they cannot
  navigate the panel.
- **Uploads.** The server checks the size of every upload and refuses zip entries that would
  land outside its upload folder.
- **Git URLs.** The server only clones `https://`, `ssh://` and `git@` URLs, so a request
  cannot use `file://` to read the server's own disk.
- **No code changes.** Neither Nokran nor the harness modifies your code. Fixes are
  suggestions only.

## Source layout

| Path | Responsibility |
| --- | --- |
| `src/extension.ts` | Activation, commands and the API key. |
| `src/chatView.ts` | The chat panel: routes messages, calls the server, relays streamed events. |
| `src/router.ts` | Decides whether a message is a scan, a file scan, a question or help. |
| `src/source.ts` | Turns a folder or file into `path`, `git` or `upload` arguments. |
| `src/paths.ts` | Picks the workspace folder and the active file; offers to save unsaved files. |
| `src/mcpClient.ts` | The MCP connection, timeouts and error messages. |
| `src/report.ts` | Turns report items into finding cards and the summary line. |
| `src/protocol.ts` | The messages exchanged between the extension and the webview. |
| `media/main.ts`, `media/main.css` | The chat webview itself. |
