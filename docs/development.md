# Development

This page is for people who want to change Nokran itself.

## Prerequisites

- Node.js 18 or later and npm.
- VS Code.
- A running harness MCP server for manual testing (see [Getting started](getting-started.md)).
- Git, which the tests for `git` and `upload` mode use.

## Setup

```sh
npm install
npm run build
```

`npm run build` uses esbuild to produce two bundles: `dist/extension.js` for the extension
host and `dist/webview.js` for the chat panel. `npm run watch` rebuilds them on every change.

## Running the extension

Open this folder in VS Code and press **F5**. A second VS Code window opens with Nokran loaded
from source. The launch configuration builds the extension first.

If a `dev.code-workspace` file exists, F5 opens it in the new window. It is not committed,
because it contains paths on your machine. A typical one opens the harness's vulnerable sample
app:

```json
{
  "folders": [{ "path": "/path/to/harness/tests/vulnerable_samples/flask_app" }],
  "settings": { "nokran.mcpBaseUrl": "http://127.0.0.1:8001/mcp", "nokran.sourceMode": "path" }
}
```

Start the server before pressing F5. After changing code, run **Developer: Reload Window** in
the development window.

## Checks

```sh
npm run typecheck    # TypeScript, no output files
npm test             # unit tests with Vitest
```

The tests cover:

- `router.test.ts`: which action each kind of message leads to;
- `report.test.ts`: turning a saved scan report into cards and a summary;
- `source.test.ts`: `path`, `git` and `upload` mode, using temporary Git repositories;
- `describeStep.test.ts`: the activity trail's labels for agent steps;
- `webview.test.ts`: the chat panel itself, run in jsdom and driven with the same messages a
  real scan and question produce, including streaming and a stopped scan.

The MCP connection is not covered by unit tests. Test it by hand against a real server.

## Packaging

```sh
npm run package
```

This builds minified bundles and creates `nokran-<version>.vsix`. Install it with
`code --install-extension nokran-<version>.vsix`. `.vscodeignore` keeps the package down to
the bundles, the stylesheet, the icon, the manifest and the documentation files.

Update `version` in `package.json` and add an entry to `CHANGELOG.md` for each release.

## Working with the harness

Nokran and the harness share a contract: the `scan` and `ask` tool arguments, the report
format, and the streamed events described in [How it works](how-it-works.md#streaming). If
you change one side, change the other in the same piece of work:

- tool arguments and events are defined in the harness's `app/mcp_server.py`;
- the report format is in its `app/models/`;
- Nokran's side is `HarnessEvent` in `src/mcpClient.ts`, the arguments in `src/source.ts`,
  and the report types in `src/report.ts`.

## Conventions

- Keep the webview free of `vscode` and Node imports. It is bundled for the browser, and
  anything it shares with the extension lives in `src/protocol.ts` or `src/report.ts`.
- Treat everything from the server as untrusted. Insert plain text with `textContent`, and pass
  Markdown through DOMPurify.
- Messages shown to the user should say what went wrong and what to do about it. Offer a
  button (open settings, set API key, show log) when there is an obvious next step.
