import { describe, expect, it } from "vitest";
import { route } from "../src/router";

describe("route", () => {
  it.each([
    ["/scan", "scan"],
    ["/SCAN", "scan"],
    ["/scan-file", "scanFile"],
    ["/help", "help"],
    ["/ask", "invalid"],
    ["/frobnicate", "invalid"],
    ["scan this code for me", "scan"],
    ["Scan the project", "scan"],
    ["please audit this repo", "scan"],
    ["check for vulnerabilities", "scan"],
    ["can you check this code for security issues", "scan"],
    ["scan this file", "scanFile"],
    ["audit the current file please", "scanFile"],
    ["check the open file for vulnerabilities", "scanFile"],
    ["where does user input reach the database?", "ask"],
    ["explain the login flow", "ask"],
    ["what does this file do?", "ask"],
    ["describe the scanner module", "ask"],
    ["check the tests pass", "ask"],
  ])("%s -> %s", (text, kind) => {
    expect(route(text).kind).toBe(kind);
  });

  it("keeps the question text for /ask and plain questions", () => {
    expect(route("/ask  where is the db?")).toEqual({ kind: "ask", question: "where is the db?" });
    expect(route("  how is auth done?  ")).toEqual({ kind: "ask", question: "how is auth done?" });
  });
});
