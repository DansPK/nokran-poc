// Decide what the user wants from what they typed. Deterministic on purpose: slash
// commands first, then a few keyword rules, and everything else is a question.

export type Route =
  | { kind: "scan" }
  | { kind: "scanFile" }
  | { kind: "ask"; question: string }
  | { kind: "help" }
  | { kind: "invalid"; message: string };

const SCAN_WORDS = /\b(scan|scanning|audit|auditing)\b|\bcheck\b.*\b(vulnerabilit(y|ies)|vulns?|security)\b/i;
const FILE_WORDS = /\b(this|current|open|active)\s+file\b/i;

export function route(input: string): Route {
  const text = input.trim();

  if (text.startsWith("/")) {
    const command = text.split(/\s+/)[0];
    const arg = text.slice(command.length).trim();
    switch (command.toLowerCase()) {
      case "/scan":
        return { kind: "scan" };
      case "/scan-file":
        return { kind: "scanFile" };
      case "/help":
        return { kind: "help" };
      case "/ask":
        return arg
          ? { kind: "ask", question: arg }
          : { kind: "invalid", message: "Type a question after `/ask`." };
      default:
        return { kind: "invalid", message: `Unknown command \`${command}\`. Type \`/help\` to see what I can do.` };
    }
  }

  if (SCAN_WORDS.test(text)) {
    return FILE_WORDS.test(text) ? { kind: "scanFile" } : { kind: "scan" };
  }
  return { kind: "ask", question: text };
}

export const HELP_TEXT = `**What I can do**

- \`/scan\` — scan the whole workspace folder for vulnerabilities.
- \`/scan-file\` — scan the file open in the editor.
- \`/ask <question>\` — ask a question about the code.
- \`/help\` — show this message.

Plain text works too: "scan this code for me", "audit the current file", or any question such as
"where does user input reach the database?". Follow-up questions keep the conversation until you press **New chat**.`;
