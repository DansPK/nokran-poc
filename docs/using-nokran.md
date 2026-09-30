# Using Nokran

Nokran is a chat. You type what you want, and it decides whether to scan or to ask a
question. This page explains both, and how to read what comes back.

## Opening the chat

Click the Nokran icon in the activity bar, or run **Nokran: Open Chat** from the Command
Palette. Press Enter to send a message and Shift+Enter to start a new line.

## How Nokran understands your message

Nokran follows simple, predictable rules rather than guessing:

1. **Slash commands come first.**
   - `/scan` scans the whole workspace folder.
   - `/scan-file` scans the file open in the editor.
   - `/ask <question>` asks a question.
   - `/help` lists these commands.
2. **Then keywords.** A message that mentions *scan*, *audit* or *check … for
   vulnerabilities* starts a scan. If it also says *this file* or *current file*, only that
   file is scanned.
3. **Everything else is a question.**

After each message, a small line tells you what Nokran chose, for example
`Scanning folder: shop-api (local path)` or `Asking about: shop-api (upload, 312 files, 4.1 MB)`.
If Nokran misunderstood, use a slash command to be explicit. For example, "what does the scan
function do?" starts a scan because it contains *scan*; `/ask what does the scan function do?`
asks it as a question.

If your workspace has several folders, Nokran asks which one to use the first time and
remembers your choice for the rest of the chat.

## Scanning

You can start a scan in several ways:

- type `/scan`, `/scan-file`, or a message such as "scan this code for me";
- run **Nokran: Scan Workspace** or **Nokran: Scan Current File** from the Command Palette;
- right-click in an editor and choose **Nokran: Scan Current File**.

If you have unsaved changes, Nokran offers to save them first, because the server reads files
from disk.

### What happens during a scan

The server first runs Semgrep to find *candidate* problems. It then asks the AI model to look
at each candidate, together with the code around it and the code that calls it, and decide
whether it is real.

While this happens, the chat shows:

- **An activity trail** listing each step, such as `Running Semgrep…`,
  `Candidate findings: 23` and `VULN-004: Likely Vulnerable`. Warnings are shown in yellow.
- **A card for each finding** as soon as the AI reaches a verdict. The card has a dashed
  border while its explanation and suggested fix are still being written, and you can watch
  the text appear.

When the scan finishes, the activity trail folds into a single line such as
`Activity · 31 steps · 130s`, and the cards are replaced by the full report, sorted with the
most serious findings first.

### Reading a finding card

Each card shows:

- **The ID and type**, for example `VULN-002 SQL Injection`, and a coloured **severity** badge
  (Critical, High, Medium, Low or Info).
- **The status**, which says how likely the finding is to be real:
  - *Likely Vulnerable*: the AI found a clear path from untrusted input to a dangerous
    operation.
  - *Possible Vulnerability*: it may be real, but something could not be confirmed.
  - *Likely False Positive*: the code appears to be protected.
  - *Needs Manual Review*: there was not enough information to decide.
- **The confidence** of that judgement: High, Medium or Low.
- **Location**: a `file:line` link. Click it to open the file at that line.
- **Source and sink**: where untrusted data enters, and the dangerous operation it reaches.
- **Data flow**: the chain of files the data passes through, for example
  `UserController.java → UserService.java → UserRepository.java`.
- **Explanation** and **Suggested fix**, folded by default. Click to expand them.

No finding is ever presented as confirmed. Treat every result as a lead to check, not a proof.

Findings are also added to the **Problems** panel (`Ctrl+Shift+M`). Critical and High
findings appear as errors, Medium as warnings, and Low and Info as information. Each new scan
replaces the previous findings.

### When nothing is found

"No issues found" means no Semgrep rule matched anything worth reviewing. It does not prove
the code is safe. Logic flaws such as missing permission checks rarely match a rule, so ask
about them instead.

## Asking questions

Anything that is not a scan is sent as a question, for example:

- `where does user input reach the database?`
- `which endpoints don't check that the user owns the resource?`
- `how is the password reset token validated?`

The server runs an AI agent that explores the code step by step: it lists files, reads them,
searches for text, looks up where functions are defined and called, and can run Semgrep on
part of the project. The activity trail shows each step and the agent's reason for it, such as
`Reading routes/search.py — the route handler`. The answer is then written out below the
trail.

Follow-up questions keep the context of the conversation, so you can ask "and how would I fix
that?" after an answer. The conversation starts over when you click **New chat** or switch to
a different folder.

Answers are the AI's reading of the code. Check them the way you would check a colleague's
review comments.

## Stopping and starting over

- **Stop** cancels the current request. Anything already shown stays in the chat, marked as
  partial. The server may finish the step it is working on in the background.
- **New chat** clears the chat and the question history.

## Commands

| Command | What it does |
| --- | --- |
| Nokran: Open Chat | Opens the chat panel. |
| Nokran: Scan Workspace | Scans the workspace folder. |
| Nokran: Scan Current File | Scans the file in the editor. Also in the editor's right-click menu. |
| Nokran: Set API Key | Saves the server's API key in VS Code's secret storage. |
| Nokran: Clear API Key | Removes the key from secret storage. |
| Nokran: Reconnect to Server | Drops the connection and connects again, to check the settings. |
| Nokran: Show Output Log | Opens the Nokran output log, which includes the server's progress. |
