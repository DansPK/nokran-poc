# Nokran

Nokran is a chat panel for VS Code that helps you find security problems in your code. You
type a request in plain language, such as "scan this code for me" or "where does user input
reach the database?", and Nokran answers in the chat. Scan results appear as finding cards you
can click to jump straight to the code.

Nokran does not analyze code itself. It is an [MCP](https://modelcontextprotocol.io) client
that talks to the **source-code-vuln-poc** harness, which runs Semgrep and an AI model to judge
each finding. Nokran connects to the harness over Streamable HTTP, so the harness can run on
your own machine or on a shared server.

## Features

- **Chat to scan or ask.** Scan a whole folder or a single file, or ask questions about the
  code. Follow-up questions remember the conversation.
- **Live results.** You see what the server is doing while it works. Finding cards appear as
  soon as each verdict is ready, and explanations and answers are written out as the AI
  produces them.
- **Clear verdicts.** Each finding shows how likely it is to be real (Likely Vulnerable,
  Possible Vulnerability, Likely False Positive or Needs Manual Review), its severity, where
  untrusted data comes from and where it ends up.
- **Jump to the code.** Click any `file:line` link to open it. Findings are also listed in the
  Problems panel.
- **Works with a local or remote server.** Send the server a local path, a Git URL, or an
  upload of your files, depending on where it runs.
- **Read-only.** Nokran suggests fixes but never changes your code.

## Requirements

- VS Code 1.90 or later.
- A running **source-code-vuln-poc** MCP server (`scan-mcp`), with an LLM key configured in
  its `.env` file. See [Getting started](docs/getting-started.md).

## Quick start

1. Start the server in the harness folder:
   ```sh
   uv sync
   echo "MCP_API_KEY=$(openssl rand -hex 32)" >> .env
   uv run scan-mcp
   ```
2. Install the extension:
   ```sh
   code --install-extension nokran-0.4.0.vsix
   ```
3. In VS Code settings, search for **Nokran** and paste the server's `MCP_API_KEY` into
   **Api Key**.
4. Open a project folder, click the Nokran icon in the activity bar, and type
   `scan this code for me`.

## Using the chat

| Type this | What happens |
| --- | --- |
| `/scan`, or "scan this code" | Scans the whole workspace folder. |
| `/scan-file`, or "scan this file" | Scans the file open in the editor. |
| `/ask <question>`, or any other text | Asks the AI a question about the code. |
| `/help` | Lists what the chat can do. |

You can also run **Nokran: Scan Workspace** and **Nokran: Scan Current File** from the Command
Palette, or right-click in an editor and choose **Scan Current File**. More detail is in
[Using Nokran](docs/using-nokran.md).

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `nokran.mcpBaseUrl` | `http://127.0.0.1:8001/mcp` | Address of the MCP server. |
| `nokran.apiKey` | empty | The server's API key. You can use **Nokran: Set API Key** instead. |
| `nokran.sourceMode` | `path` | How the server gets your code: `path`, `git` or `upload`. |
| `nokran.maxUploadMB` | `50` | Largest upload allowed in `upload` mode. |
| `nokran.scanTimeoutMinutes` | `30` | How long a scan may run. |
| `nokran.askTimeoutMinutes` | `5` | How long a question may take. |

See [Configuration](docs/configuration.md) for the details of each setting and how to choose
a source mode.

## Documentation

- [Getting started](docs/getting-started.md): install the server and the extension, and run
  your first scan.
- [Using Nokran](docs/using-nokran.md): scanning, asking questions, reading the results.
- [Configuration](docs/configuration.md): every setting, the API key and the source modes.
- [How it works](docs/how-it-works.md): the architecture and the messages exchanged with the
  server.
- [Troubleshooting](docs/troubleshooting.md): common errors and how to fix them.
- [Development](docs/development.md): building, testing and packaging the extension.

## Privacy and security

- In `path` and `git` mode, Nokran sends the server only a path or a repository URL. In
  `upload` mode it sends a zip of your project files to the server you configured.
- The harness sends code excerpts to the AI model configured on the server. Nokran never
  talks to an AI model directly.
- The API key is sent only to the configured server. Keep it in secret storage with
  **Nokran: Set API Key** if you do not want it in `settings.json`.
- Findings are AI-assisted judgements, not confirmed vulnerabilities. Review each one.

## Known limitations

- A scan only looks at what Semgrep flags. If no rule matches, the AI never sees the code, so
  "no issues found" means no known pattern matched. Use questions to look for logic flaws
  such as missing authorization checks.
- Pressing **Stop** cancels the request, but the server may finish the step it is working on.
- Each finding takes about three AI calls, so large projects can take several minutes.

## Release notes

See [CHANGELOG.md](CHANGELOG.md).
