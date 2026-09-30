// How the server gets the code, per the `nokran.sourceMode` setting:
//   path   -- send the absolute path; the server must see the same disk (same machine).
//   git    -- send the origin URL and current branch; the server clones what is pushed.
//   upload -- zip the files and send them; works with any server, but the code leaves here.
// No vscode import, so it is unit tested directly.

import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";
import { zipSync } from "fflate";

export type SourceMode = "path" | "git" | "upload";

/** Tool arguments naming the code, exactly as the harness's `scan`/`ask` take them. */
export interface SourceArgs {
  path?: string;
  repo?: string;
  branch?: string;
  archive?: string;
  subpath?: string;
}

export interface ResolvedSource {
  args: SourceArgs;
  /** Shown in the chat's routing line, e.g. "Git: https://… @ main". */
  describe: string;
  /** Things the user should know, e.g. uncommitted changes that git mode will not scan. */
  warnings: string[];
}

/** Thrown for problems the user can fix; the message is shown as is. */
export class SourceError extends Error {}

// Mirrors the harness's file_filter.py, so an upload holds what a scan would look at.
const SKIP_DIRS = new Set([
  ".git", ".venv", "venv", "node_modules", "vendor", "dist", "build", ".cache", "__pycache__",
  ".pytest_cache", ".idea", ".mypy_cache", "target", ".gradle", "obj", ".next", ".nuxt",
  "coverage", ".terraform", ".claude", ".kilo", ".worktrees",
]);
const MAX_FILE_BYTES = 1_000_000;
const REMOTE_URL = /^(https:\/\/|ssh:\/\/|git@)/;

const run = promisify(execFile);

async function git(cwd: string, ...args: string[]): Promise<string> {
  try {
    const { stdout } = await run("git", args, { cwd, timeout: 15_000, maxBuffer: 64 * 1024 * 1024 });
    return stdout.trim();
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: string };
    if (e.code === "ENOENT") throw new SourceError("Git is not installed, or not on the PATH.");
    throw Object.assign(new Error((e.stderr ?? e.message).trim()), { git: true });
  }
}

/**
 * Name `target` (a folder, or a file when `isFile`) for the server in `mode`.
 * Finding paths in the result are relative to the folder, or to the file's folder.
 */
export async function resolveSource(
  mode: SourceMode,
  target: string,
  isFile: boolean,
  maxUploadMB: number,
): Promise<ResolvedSource> {
  if (mode === "git") return fromGit(target, isFile);
  if (mode === "upload") return fromUpload(target, isFile, maxUploadMB);
  return { args: { path: target }, describe: "local path", warnings: [] };
}

async function fromGit(target: string, isFile: boolean): Promise<ResolvedSource> {
  const folder = isFile ? path.dirname(target) : target;
  let top: string;
  try {
    top = await git(folder, "rev-parse", "--show-toplevel");
  } catch (err) {
    if (err instanceof SourceError) throw err;
    throw new SourceError(
      `${folder} is not in a Git repository. Use \`upload\` or \`path\` for \`nokran.sourceMode\`.`,
    );
  }
  const repo = await git(top, "remote", "get-url", "origin").catch(() => "");
  if (!repo) throw new SourceError("This repository has no `origin` remote for the server to clone.");
  if (!REMOTE_URL.test(repo)) {
    throw new SourceError(`The server can only clone https://, ssh:// or git@ URLs; \`origin\` is ${repo}.`);
  }
  const branch = await git(top, "rev-parse", "--abbrev-ref", "HEAD");
  if (branch === "HEAD") throw new SourceError("HEAD is detached. Check out a branch, or use `upload` mode.");

  const subpath = toPosix(path.relative(await fs.realpath(top), await fs.realpath(target)));
  const warnings: string[] = [];
  if (await git(top, "status", "--porcelain", "--", target)) {
    warnings.push(`You have uncommitted changes. The server scans what is pushed to \`${branch}\`, not your working copy.`);
  }
  const ahead = await git(top, "rev-list", "--count", "@{u}..HEAD").catch(() => "none");
  if (ahead === "none") {
    warnings.push(`Branch \`${branch}\` has no upstream. Push it first, or the server cannot clone it.`);
  } else if (ahead !== "0") {
    warnings.push(`${ahead} local commit(s) on \`${branch}\` are not pushed and will not be scanned.`);
  }
  return {
    args: { repo, branch, ...(subpath ? { subpath } : {}) },
    describe: `Git: ${repo} @ ${branch}`,
    warnings,
  };
}

async function fromUpload(target: string, isFile: boolean, maxUploadMB: number): Promise<ResolvedSource> {
  const base = isFile ? path.dirname(target) : target;
  const files = isFile ? [path.basename(target)] : await listFiles(base);

  const entries: Record<string, Uint8Array> = {};
  let count = 0;
  for (const rel of files) {
    const data = await fs.readFile(path.join(base, rel)).catch(() => undefined); // deleted but still tracked
    if (!data || data.length > MAX_FILE_BYTES) continue;
    entries[toPosix(rel)] = data;
    count += 1;
  }
  if (count === 0) throw new SourceError("There are no files to upload.");

  const zip = zipSync(entries, { level: 6 });
  const mb = zip.length / 2 ** 20;
  if (mb > maxUploadMB) {
    throw new SourceError(
      `The upload would be ${mb.toFixed(1)} MB, over the ${maxUploadMB} MB limit (\`nokran.maxUploadMB\`).`,
    );
  }
  return {
    args: { archive: Buffer.from(zip).toString("base64"), ...(isFile ? { subpath: path.basename(target) } : {}) },
    describe: `upload, ${count} file${count === 1 ? "" : "s"}, ${mb.toFixed(1)} MB`,
    warnings: [],
  };
}

/** Files under `folder`, relative to it: Git's view when it is a repository (so .gitignore
 * applies and uncommitted files are included), otherwise a walk skipping build output. */
export async function listFiles(folder: string): Promise<string[]> {
  try {
    const out = await git(folder, "ls-files", "-z", "--cached", "--others", "--exclude-standard");
    return out.split("\0").filter((f) => f && !f.split("/").some((part) => SKIP_DIRS.has(part)));
  } catch {
    return walk(folder, ""); // not a repository, or no git installed
  }
}

async function walk(root: string, rel: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await fs.readdir(path.join(root, rel), { withFileTypes: true })) {
    const child = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) found.push(...(await walk(root, child)));
    } else if (entry.isFile()) {
      found.push(child);
    }
  }
  return found;
}

const toPosix = (p: string) => p.split(path.sep).join("/");
