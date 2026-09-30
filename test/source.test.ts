import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { resolveSource, SourceError } from "../src/source";

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, encoding: "utf8" });

/** A repository with an origin URL, one commit, and a mix of files. */
function repo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "nokran-"));
  git(dir, "init", "-q", "-b", "main");
  mkdirSync(path.join(dir, "src"));
  mkdirSync(path.join(dir, "node_modules"));
  writeFileSync(path.join(dir, "src", "app.py"), "x = 1\n");
  writeFileSync(path.join(dir, "node_modules", "dep.js"), "junk\n");
  writeFileSync(path.join(dir, ".gitignore"), "secret.env\n");
  writeFileSync(path.join(dir, "secret.env"), "KEY=1\n");
  git(dir, "add", "src", ".gitignore");
  git(dir, "commit", "-q", "-m", "init");
  git(dir, "remote", "add", "origin", "https://example.com/team/app.git");
  return dir;
}

const unzip = (archive?: string) => Object.keys(unzipSync(Buffer.from(archive!, "base64"))).sort();

describe("resolveSource", () => {
  it("path mode sends the path as is", async () => {
    expect((await resolveSource("path", "/some/folder", false, 50)).args).toEqual({ path: "/some/folder" });
  });

  it("git mode sends origin and the current branch, and says what will not be scanned", async () => {
    const dir = repo();
    writeFileSync(path.join(dir, "src", "app.py"), "x = 2\n"); // uncommitted edit

    const resolved = await resolveSource("git", dir, false, 50);

    expect(resolved.args).toEqual({ repo: "https://example.com/team/app.git", branch: "main" });
    expect(resolved.warnings.join(" ")).toMatch(/uncommitted/);
    expect(resolved.warnings.join(" ")).toMatch(/no upstream/);
  });

  it("git mode narrows to a subfolder or file with a POSIX subpath", async () => {
    const dir = repo();
    const resolved = await resolveSource("git", path.join(dir, "src", "app.py"), true, 50);
    expect(resolved.args.subpath).toBe("src/app.py");
  });

  it("git mode refuses a folder outside Git, pointing at the other modes", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "nokran-plain-"));
    await expect(resolveSource("git", dir, false, 50)).rejects.toThrow(/not in a Git repository/);
  });

  it("upload mode zips what Git tracks plus new files, never ignored or vendored ones", async () => {
    const dir = repo();
    writeFileSync(path.join(dir, "src", "new.py"), "y = 1\n"); // untracked, not ignored

    const resolved = await resolveSource("upload", dir, false, 50);

    expect(unzip(resolved.args.archive)).toEqual([".gitignore", "src/app.py", "src/new.py"]);
    expect(resolved.describe).toMatch(/^upload, 3 files/);
  });

  it("upload mode walks a folder outside Git, skipping build output", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "nokran-plain-"));
    mkdirSync(path.join(dir, "target"));
    writeFileSync(path.join(dir, "Main.java"), "class Main {}\n");
    writeFileSync(path.join(dir, "target", "Main.class"), "bytes");

    expect(unzip((await resolveSource("upload", dir, false, 50)).args.archive)).toEqual(["Main.java"]);
  });

  it("upload mode sends one file with its name as the subpath", async () => {
    const dir = repo();
    const resolved = await resolveSource("upload", path.join(dir, "src", "app.py"), true, 50);
    expect(unzip(resolved.args.archive)).toEqual(["app.py"]);
    expect(resolved.args.subpath).toBe("app.py");
  });

  it("upload mode enforces the size limit", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "nokran-big-"));
    // Random bytes do not compress, so 0.9 MB of them stays 0.9 MB zipped.
    writeFileSync(path.join(dir, "blob.bin"), Buffer.from(Array.from({ length: 900_000 }, () => Math.random() * 256)));
    const err = await resolveSource("upload", dir, false, 0.5).catch((e) => e);
    expect(err).toBeInstanceOf(SourceError);
    expect(err.message).toMatch(/over the 0.5 MB limit/);
  });
});
