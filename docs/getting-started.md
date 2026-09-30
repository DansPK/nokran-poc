# Getting started

This guide takes you from nothing to your first scan. It has three parts: start the server,
install the extension, and connect the two.

## 1. Start the MCP server

Nokran needs the **source-code-vuln-poc** harness running as an MCP server. You can run it on
the same machine as VS Code or on another one.

1. Get the harness and install its dependencies. It uses [uv](https://docs.astral.sh/uv/):
   ```sh
   git clone https://github.com/DansPK/source-code-analysis-poc.git
   cd source-code-analysis-poc
   uv sync
   ```
2. Copy `.env.example` to `.env` and fill in the settings for your AI model (`LLM_API_KEY`,
   and `LLM_BASE_URL` and `LLM_MODEL` if you do not use the defaults).
3. Choose an API key for the MCP server, so that only you can use it:
   ```sh
   echo "MCP_API_KEY=$(openssl rand -hex 32)" >> .env
   ```
4. Start the server:
   ```sh
   uv run scan-mcp
   ```
   It prints `MCP server on http://127.0.0.1:8001/mcp` when it is ready. Leave it running.

By default the server only accepts connections from the same machine. To let other machines
connect, add `MCP_HOST=0.0.0.0` to `.env`. Always set `MCP_API_KEY` when you do this.

## 2. Install the extension

Build the extension from [DansPK/nokran-poc](https://github.com/DansPK/nokran-poc) and install
it:

```sh
git clone https://github.com/DansPK/nokran-poc.git
cd nokran-poc
npm install
npm run package
code --install-extension nokran-0.4.0.vsix
```

Or, in VS Code, open the Extensions view, click the **…** menu, choose **Install from
VSIX…** and pick the file. Reload the window when asked.

A shield icon labelled **Nokran** appears in the activity bar.

## 3. Connect Nokran to the server

1. Open the settings (`Ctrl+,`, or `Cmd+,` on macOS) and search for **Nokran**.
2. If the server is not on this machine at the default port, set **Mcp Base Url** to its
   address. It usually ends in `/mcp`, for example `http://192.168.1.20:8001/mcp`.
3. Paste the server's `MCP_API_KEY` into **Api Key**.
4. Set **Source Mode**:
   - `path` if the server runs on this machine (the default);
   - `git` if the server should clone your repository;
   - `upload` if the server is remote and should receive a copy of your files.

   [Configuration](configuration.md#source-mode) explains the choice in more detail.

If you prefer not to keep the key in `settings.json`, leave **Api Key** empty and run
**Nokran: Set API Key** from the Command Palette instead. The key is then kept in VS Code's
encrypted secret storage.

## 4. Run your first scan

1. Open a project folder in VS Code.
2. Click the Nokran icon to open the chat.
3. Type `scan this code for me` and press Enter.

A small line confirms what Nokran is doing, for example
`Scanning folder: my-app (local path)`. The activity trail below it shows the server's
progress, and finding cards appear as each one is judged. When the scan finishes, you get a
summary and the full list of findings.

To try Nokran on code with a known problem, open the harness's
`tests/vulnerable_samples/flask_app` folder and scan it. You should see a SQL injection marked
**Likely Vulnerable**.

Next, read [Using Nokran](using-nokran.md) to learn what else the chat can do.
