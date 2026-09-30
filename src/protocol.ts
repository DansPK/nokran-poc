// The fixed set of messages between the webview and the extension host.
// Shared by both bundles, so it must not import vscode or node modules.

import type { Card } from "./report";

// Buttons an error can offer. Kept here rather than imported from mcpClient, which
// imports vscode and so cannot be bundled into the webview.
export type ErrorAction = "openSettings" | "showLog" | "setApiKey";

export type FromWebview =
  | { type: "send"; text: string }
  | { type: "stop" }
  | { type: "newChat" }
  | { type: "openFile"; path: string; line: number }
  | { type: "action"; action: ErrorAction }
  | { type: "ready" };

export type ToWebview =
  | { type: "user"; text: string }
  | { type: "routed"; text: string }
  | { type: "reply"; markdown: string }
  | { type: "report"; summary: string; cards: Card[] }
  // During a scan: a card as soon as its verdict is in (final: false), its explanation and
  // fix as they are written, then the finished card (final: true). `number` keys the card.
  | { type: "finding"; number: number; card: Card; done: number; total: number; final: boolean }
  | { type: "findingText"; number: number; field: "explanation" | "suggested_fix"; text: string }
  // A line in the activity trail: a scan's progress or an ask's tool use.
  | { type: "activity"; text: string; warning?: boolean }
  | { type: "token"; text: string } // a piece of the answer, streamed during an ask
  | { type: "progress"; text: string }
  | { type: "busy"; busy: boolean }
  | { type: "error"; message: string; action?: ErrorAction }
  | { type: "clear" };
