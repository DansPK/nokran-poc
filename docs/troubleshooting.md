# Troubleshooting

Most problems show up as a red message in the chat, often with a button to fix them. For more
detail, open the log with **Nokran: Show Output Log**. It includes the server's own progress
messages.

To test the connection without scanning anything, run **Nokran: Reconnect to Server**.

## Connecting

**"Cannot reach the MCP server at …"**

Nokran could not open a connection.

- Check that the server is running (`uv run scan-mcp` in the harness folder) and printed
  `MCP server on http://…/mcp`.
- Check that `nokran.mcpBaseUrl` matches that address, including the port and the `/mcp` at
  the end.
- If the server is on another machine, make sure it was started with `MCP_HOST=0.0.0.0` and
  that no firewall blocks the port.

**"Nothing answers MCP at …"**

Something answered at that address, but it is not the MCP endpoint. The URL usually needs to
end in `/mcp`.

**"The server rejected the API key (or none was set)"**

The key Nokran sent does not match the server's `MCP_API_KEY`.

- Copy the value from the harness's `.env` into the **Api Key** setting, or run
  **Nokran: Set API Key**.
- If you use both, remember that the setting wins over secret storage.
- If you changed `MCP_API_KEY`, restart the server.

## Scanning

**"Path does not exist" in `path` mode**

The server cannot see the path, usually because it runs on another machine or in a container.
Switch `nokran.sourceMode` to `git` or `upload`.

**"… is not in a Git repository" or "no `origin` remote"**

`git` mode needs a repository with an `origin` remote the server can clone. Use `upload`
mode for code that is not in Git.

**"Could not clone …"**

The server could not clone your repository. Push your branch, and for private repositories
give the server Git credentials. The error includes Git's own message.

**"The upload would be … MB, over the … MB limit"**

Raise `nokran.maxUploadMB`, or make sure build output and dependencies are ignored by your
`.gitignore`. If the server refuses the upload instead, raise its `MAX_UPLOAD_MB`.

**The scan says "No issues found", but I expected some**

A scan only reviews what Semgrep flags. If no rule matches, the AI never looks at that code.
Try asking a question about the area you are worried about.

**The scan takes a long time**

Each finding needs about three AI calls. Watch the activity trail to see progress. If scans
time out, raise `nokran.scanTimeoutMinutes`.

**"The scan took longer than … minutes and was cancelled"**

Raise `nokran.scanTimeoutMinutes` or `nokran.askTimeoutMinutes`.

## The chat

**Nothing streams while a request runs**

Streaming needs a harness at milestone M13 or later. An older server still works, but results
appear only at the end. Update the harness and restart it.

**"The server reported an error: …"**

The harness failed and returned its own message. Common causes are a missing or invalid
`LLM_API_KEY` in its `.env`, or a Semgrep failure. The server's log has the details.

**A link opens the wrong file, or nothing**

Links point to files in the folder you scanned. If the files have moved or been deleted since
the scan, run the scan again.

## Still stuck?

Collect the Nokran output log and the server's terminal output, and include the source mode
you use and whether the server runs on the same machine.
