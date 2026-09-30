# Changelog

All notable changes to Nokran are listed here.

## 0.4.0

- The chat shows an activity trail with each step of a scan or question, folded away when the
  request finishes.
- During a scan, each finding card appears as soon as its verdict is ready, and its
  explanation and suggested fix are written out live.
- Requires a harness at milestone M13 or later for these updates. Older servers still work,
  without them.

## 0.3.1

- The API key can be entered in the settings (`nokran.apiKey`) as well as with
  **Nokran: Set API Key**.

## 0.3.0

- Renamed from Security Chat to **Nokran**. All commands and settings now start with `nokran`.
- Nokran is now purely an MCP client. It connects to a server you run, at `nokran.mcpBaseUrl`,
  instead of starting the harness itself.
- Added API key support. The key is sent as a Bearer token.
- Added `nokran.sourceMode`, so the server can get your code as a local path, by cloning your
  Git branch, or as an upload. Added `nokran.maxUploadMB`.

## 0.2.0

- Answers to questions are written out live, and finding cards appear as each finding is
  judged.

## 0.1.0

- First release, as Security Chat: a chat panel that scans a folder or file and answers
  questions through the harness, with finding cards, links to the code and Problems panel
  entries.
