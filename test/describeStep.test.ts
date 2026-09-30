import { describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({}));
const { describeStep } = await import("../src/chatView");

describe("describeStep", () => {
  it("names what the ask agent is doing", () => {
    expect(describeStep("read_file", { path: "routes/search.py" })).toBe("Reading routes/search.py");
    expect(describeStep("search", { pattern: "execute\\(" })).toBe("Searching for execute\\(");
    expect(describeStep("find_symbol", { name: "search_users" })).toBe("Looking up search_users");
    expect(describeStep("list_files", {})).toBe("Listing the project's files");
    expect(describeStep("run_scanner", { path: "." })).toBe("Running Semgrep");
    expect(describeStep("new_tool", {})).toBe("Using new_tool");
  });

  it("keeps a long model-supplied argument short", () => {
    expect(describeStep("read_file", { path: "x".repeat(500) }).length).toBeLessThan(100);
  });
});
