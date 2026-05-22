import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { runCommand } from "./runCommand.js";

/**
 * Minimal git wrapper. All functions are read-only EXCEPT createWorktree /
 * removeWorktree which are used by codex_parallel_tasks. Anything that
 * could rewrite history or push lives outside this module on purpose.
 */

export interface GitStatusInfo {
  branch: string | null;
  clean: boolean;
  /** Files in working tree (modified, untracked, staged...). */
  dirtyFiles: string[];
}

export interface GitWorktreeInfo {
  path: string;
  branch: string | null;
  isMain: boolean;
}

export async function isGitRepo(cwd: string): Promise<boolean> {
  const res = await runCommand("git", ["rev-parse", "--is-inside-work-tree"], { cwd });
  return res.exitCode === 0 && res.stdout.trim() === "true";
}

export async function getStatus(cwd: string): Promise<GitStatusInfo> {
  const [branchRes, statusRes] = await Promise.all([
    runCommand("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd }),
    runCommand("git", ["status", "--porcelain=v1"], { cwd }),
  ]);

  const branch = branchRes.exitCode === 0 ? branchRes.stdout.trim() || null : null;

  const dirtyFiles: string[] = [];
  if (statusRes.exitCode === 0) {
    for (const line of statusRes.stdout.split(/\r?\n/)) {
      if (!line.trim()) continue;
      // Porcelain v1: "XY filename" (XY = 2-char status code)
      const filename = line.slice(3).trim();
      if (filename) dirtyFiles.push(filename);
    }
  }

  return {
    branch,
    clean: dirtyFiles.length === 0,
    dirtyFiles,
  };
}

/**
 * List files changed between two refs, or between a ref and the working
 * tree if `target` is omitted.
 */
export async function getChangedFiles(
  cwd: string,
  base: string,
  target?: string,
): Promise<string[]> {
  const args = ["diff", "--name-only"];
  if (target) {
    args.push(`${base}..${target}`);
  } else {
    args.push(base);
  }
  const res = await runCommand("git", args, { cwd });
  if (res.exitCode !== 0) return [];
  return res.stdout
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Like getChangedFiles, but covers untracked-new files too by combining
 * `git diff --name-only HEAD` with `git ls-files --others --exclude-standard`.
 * This is what we use after a Codex run, since new files won't show up
 * in diff against HEAD alone until they're staged.
 */
export async function getChangedFilesIncludingUntracked(cwd: string): Promise<string[]> {
  const [diffRes, untrackedRes] = await Promise.all([
    runCommand("git", ["diff", "--name-only", "HEAD"], { cwd }),
    runCommand("git", ["ls-files", "--others", "--exclude-standard"], { cwd }),
  ]);

  const files = new Set<string>();
  for (const res of [diffRes, untrackedRes]) {
    if (res.exitCode !== 0) continue;
    for (const line of res.stdout.split(/\r?\n/)) {
      const f = line.trim();
      if (f) files.add(f);
    }
  }
  return [...files];
}

/**
 * Diff summary (`git diff --stat`) between two refs or against HEAD.
 */
export async function getDiffStat(
  cwd: string,
  base?: string,
  target?: string,
): Promise<string> {
  const args = ["diff", "--stat"];
  if (base && target) {
    args.push(`${base}..${target}`);
  } else if (base) {
    args.push(base);
  } else {
    args.push("HEAD");
  }
  const res = await runCommand("git", args, { cwd });
  return res.exitCode === 0 ? res.stdout.trim() : "";
}

/**
 * Diff summary of the working tree against HEAD that ALSO accounts for
 * new (untracked) files. Plain `git diff --stat HEAD` omits untracked
 * files, so a Codex run that only adds new files would otherwise report an
 * empty diff_stat. We stage everything into a THROWAWAY index (via
 * GIT_INDEX_FILE) so the real index and working tree are never touched.
 */
export async function getWorkingTreeStatIncludingUntracked(cwd: string): Promise<string> {
  const tmpIndex = path.join(os.tmpdir(), `cgmcp-index-${randomUUID()}`);
  const env = { ...process.env, GIT_INDEX_FILE: tmpIndex };
  try {
    // Seed the temp index from HEAD, then stage the full working tree into
    // it (respecting .gitignore). `git diff --cached` then sees both tracked
    // edits and brand-new files.
    const seed = await runCommand("git", ["read-tree", "HEAD"], { cwd, env });
    if (seed.exitCode !== 0) return ""; // empty repo / no HEAD — nothing to compare
    await runCommand("git", ["add", "-A"], { cwd, env });
    const res = await runCommand("git", ["diff", "--cached", "--stat", "HEAD"], { cwd, env });
    return res.exitCode === 0 ? res.stdout.trim() : "";
  } finally {
    await fs.rm(tmpIndex, { force: true }).catch(() => {});
  }
}

/**
 * Capture the full patch (used for audit logging).
 */
export async function getDiffPatch(
  cwd: string,
  base?: string,
  target?: string,
): Promise<string> {
  const args = ["diff"];
  if (base && target) {
    args.push(`${base}..${target}`);
  } else if (base) {
    args.push(base);
  } else {
    args.push("HEAD");
  }
  const res = await runCommand("git", args, { cwd });
  return res.exitCode === 0 ? res.stdout : "";
}

/**
 * Check that `ref` exists. Returns false for refs git doesn't recognize.
 */
export async function refExists(cwd: string, ref: string): Promise<boolean> {
  const res = await runCommand("git", ["rev-parse", "--verify", "--quiet", ref], { cwd });
  return res.exitCode === 0;
}

/**
 * List registered git worktrees. The first porcelain record is the main
 * working tree.
 */
export async function listWorktrees(
  cwd: string,
): Promise<Array<{ path: string; branch: string | null; isMain: boolean }>> {
  const res = await runCommand("git", ["worktree", "list", "--porcelain"], { cwd });
  if (res.exitCode !== 0) return [];

  return res.stdout
    .split(/\r?\n\r?\n/)
    .map((record, index) => parseWorktreeRecord(record, index === 0))
    .filter((worktree): worktree is GitWorktreeInfo => worktree !== null);
}

function parseWorktreeRecord(record: string, isMain: boolean): GitWorktreeInfo | null {
  const lines = record.split(/\r?\n/).filter(Boolean);
  const worktreeLine = lines.find((line) => line.startsWith("worktree "));
  if (!worktreeLine) return null;

  const branchLine = lines.find((line) => line.startsWith("branch "));
  const isDetachedOrBare = lines.some((line) => line === "detached" || line === "bare");
  const branchRef = branchLine?.slice("branch ".length).trim();
  const branch =
    !isDetachedOrBare && branchRef
      ? branchRef.replace(/^refs\/heads\//, "")
      : null;

  return {
    path: worktreeLine.slice("worktree ".length).trim(),
    branch,
    isMain,
  };
}

/**
 * Create a worktree at `worktreePath` for `branchName`. If the branch
 * does not exist yet, it is created from HEAD.
 */
export async function createWorktree(
  cwd: string,
  worktreePath: string,
  branchName: string,
): Promise<{ ok: boolean; error?: string }> {
  // Try existing branch first, fall back to -b to create a new one.
  const exists = await refExists(cwd, branchName);
  const args = exists
    ? ["worktree", "add", worktreePath, branchName]
    : ["worktree", "add", "-b", branchName, worktreePath];
  const res = await runCommand("git", args, { cwd });
  return res.exitCode === 0
    ? { ok: true }
    : { ok: false, error: res.stderr.trim() || `git worktree add exited ${res.exitCode}` };
}

/**
 * Remove a worktree. `force` is used because aborted Codex runs may
 * leave dirty trees that `git worktree remove` would normally refuse.
 */
export async function removeWorktree(
  cwd: string,
  worktreePath: string,
  force = true,
): Promise<{ ok: boolean; error?: string }> {
  const args = ["worktree", "remove"];
  if (force) args.push("--force");
  args.push(worktreePath);
  const res = await runCommand("git", args, { cwd });
  return res.exitCode === 0
    ? { ok: true }
    : { ok: false, error: res.stderr.trim() || `git worktree remove exited ${res.exitCode}` };
}
