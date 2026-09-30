# Configuration

All of Nokran's settings are under **Nokran** in the VS Code settings (`Ctrl+,`). You can
also set them in `settings.json`:

```json
{
  "nokran.mcpBaseUrl": "http://127.0.0.1:8001/mcp",
  "nokran.apiKey": "",
  "nokran.sourceMode": "path",
  "nokran.maxUploadMB": 50,
  "nokran.scanTimeoutMinutes": 30,
  "nokran.askTimeoutMinutes": 5
}
```

Changes take effect on your next message. There is no need to reload VS Code.

## Server address

**`nokran.mcpBaseUrl`** (default `http://127.0.0.1:8001/mcp`)

The address of the harness's MCP server. It is the host and port the server listens on,
followed by `/mcp`. The default matches a server started with `uv run scan-mcp` on the same
machine.

## API key

**`nokran.apiKey`** (default empty)

The key the server expects, which is the `MCP_API_KEY` value in the harness's `.env` file.
Nokran sends it with every request as `Authorization: Bearer <key>`.

You can store the key in one of two places:

| Where | How | Notes |
| --- | --- | --- |
| Settings | Fill in **Api Key**. | Easy to see and change. Stored as plain text in `settings.json`, and copied to your other machines if Settings Sync is on. |
| Secret storage | Run **Nokran: Set API Key**. | Encrypted by VS Code and never written to a settings file. Remove it with **Nokran: Clear API Key**. |

If both are set, the setting is used.

If the server has no `MCP_API_KEY`, it accepts requests without a key and prints a warning
when it starts. That is only reasonable when the server listens on `127.0.0.1`.

## Source mode

**`nokran.sourceMode`** (default `path`)

The harness reads code from its own disk. This setting decides how it gets your code.

### `path`: the server is on this machine

Nokran sends the absolute path of the folder or file. Nothing is copied and your code never
leaves the machine. This only works when the server can read the same disk, which normally
means it runs on the same computer.

### `git`: the server clones your repository

Nokran sends the URL of your repository's `origin` remote and the name of your current
branch. The server clones that branch and scans it.

- Only what is **pushed** is scanned. If you have uncommitted changes or unpushed commits,
  the chat shows a warning so you are not surprised by the results.
- The server needs permission to clone the repository. For a private repository, set up
  Git credentials on the server.
- The remote must be an `https://`, `ssh://` or `git@` URL.
- Your branch must have been pushed at least once, and you cannot be on a detached HEAD.

### `upload`: Nokran sends a copy of your files

Nokran zips your project and sends it to the server with the request. This works with any
server, wherever it runs, but your code is sent to that server.

- In a Git repository, the upload contains tracked files and new files that are not ignored.
  Your `.gitignore` is respected and unsaved edits are not included, but saved edits are.
- Outside Git, Nokran includes every file except dependency and build folders such as
  `node_modules`, `target`, `build`, `dist` and `.venv`.
- Files larger than 1 MB are skipped, as the scanner would skip them anyway.
- When you scan a single file, only that file is sent.
- The server keeps one copy of each distinct upload, so repeated questions about an unchanged
  project do not fill its disk.

### Which mode should I use?

| Situation | Mode |
| --- | --- |
| The server runs on your computer | `path` |
| A shared server, and your work is pushed | `git` |
| A shared server, and you want to scan unpushed work | `upload` |

## Upload limit

**`nokran.maxUploadMB`** (default `50`)

The largest upload Nokran will send in `upload` mode, measured after compression. If a
project is too big, the chat says so before anything is sent. The server has its own limit,
`MAX_UPLOAD_MB` (default 100), and refuses anything larger.

## Timeouts

**`nokran.scanTimeoutMinutes`** (default `30`) and **`nokran.askTimeoutMinutes`** (default `5`)

How long Nokran waits for a scan or a question before giving up. A scan makes about three AI
calls per finding, so large projects may need more time. When a request times out, the chat
names the setting to raise.

## Server settings

These belong to the harness, in its `.env` file, not to Nokran. They are listed here because
they affect how Nokran connects.

| Variable | Default | Meaning |
| --- | --- | --- |
| `MCP_API_KEY` | empty | The key clients must send. Empty means no key is required. |
| `MCP_HOST` | `127.0.0.1` | Where the server listens. Use `0.0.0.0` to accept other machines. |
| `MCP_PORT` | `8001` | The server's port. |
| `MAX_UPLOAD_MB` | `100` | The largest upload the server accepts. |

Restart the server after changing them.
