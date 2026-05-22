import path from "node:path";
import {
  ALWAYS_FORBIDDEN_PATHS,
  LOCKFILE_PAIRS,
  SECRET_FILENAME_SUBSTRINGS,
} from "./policy.js";
import type { PathGuardResult, PathViolation } from "../types.js";

/**
 * Normalize a path to POSIX style with no leading "./" so comparisons
 * are stable across OSes and how the caller typed the path.
 */
export function normalizePath(p: string): string {
  // path.posix.normalize collapses "..", duplicate slashes, etc.
  let n = p.replace(/\\/g, "/");
  if (n.startsWith("./")) n = n.slice(2);
  n = path.posix.normalize(n);
  if (n.startsWith("/")) n = n.slice(1);
  return n;
}

/**
 * True if `file` is inside (or equal to) `dirOrFile`. Directory match
 * requires the dir prefix to end at a path separator so that
 * "src/feature" does NOT match "src/feature-extra/file.ts".
 */
export function isUnder(file: string, dirOrFile: string): boolean {
  const f = normalizePath(file);
  const d = normalizePath(dirOrFile);
  if (f === d) return true;
  // If the rule looks like a directory (ends with "/" or has no extension and
  // is being used as a prefix), require the next char in `f` to be "/".
  const dirPrefix = d.endsWith("/") ? d : d + "/";
  return f.startsWith(dirPrefix);
}

/**
 * Returns true when the basename of `file` looks like a credential file.
 */
function looksLikeSecretFile(file: string): boolean {
  const base = path.posix.basename(normalizePath(file)).toLowerCase();
  return SECRET_FILENAME_SUBSTRINGS.some((s) => base.includes(s));
}

export interface ValidateChangedFilesOptions {
  changedFiles: string[];
  allowedPaths: string[];
  forbiddenPaths?: string[];
  /** True if the diff is allowed to touch package.json + lockfiles together. */
  allowDependencyChanges?: boolean;
}

/**
 * Validate the file list produced by Codex against the caller's
 * allowed/forbidden constraints PLUS the gateway's hard-coded rules.
 *
 * Returns ok=false with a list of violations if anything is off.
 */
export function validateChangedFiles(
  opts: ValidateChangedFilesOptions,
): PathGuardResult {
  const { changedFiles, allowedPaths, forbiddenPaths = [], allowDependencyChanges = false } = opts;
  const violations: PathViolation[] = [];

  const normalizedAllowed = allowedPaths.map(normalizePath);
  const normalizedForbidden = [
    ...forbiddenPaths.map(normalizePath),
    ...ALWAYS_FORBIDDEN_PATHS.map(normalizePath),
  ];

  for (const raw of changedFiles) {
    const file = normalizePath(raw);

    // Rule 1: must be inside at least one allowed path.
    const insideAllowed = normalizedAllowed.some((a) => isUnder(file, a));
    if (!insideAllowed) {
      violations.push({
        path: file,
        reason: "outside_allowed_paths",
        detail: `allowed_paths のいずれの配下にも含まれていません: ${normalizedAllowed.join(", ") || "(空)"}`,
      });
      // Even if outside, continue checking other rules so we surface
      // every reason in a single pass.
    }

    // Rule 2: must not match a forbidden path.
    const hitsForbidden = normalizedForbidden.find((f) => isUnder(file, f));
    if (hitsForbidden) {
      violations.push({
        path: file,
        reason: "matches_forbidden_path",
        detail: `forbidden_paths に該当: ${hitsForbidden}`,
      });
    }

    // Rule 3: never let a credential/secret file slip through, even if
    // it happens to be inside allowed_paths.
    if (looksLikeSecretFile(file)) {
      violations.push({
        path: file,
        reason: "always_forbidden_secret",
        detail: `クレデンシャルらしきファイル名です (basename: ${path.posix.basename(file)})`,
      });
    }
  }

  // Rule 4: lockfile-without-manifest check.
  if (!allowDependencyChanges) {
    const normalizedSet = new Set(changedFiles.map(normalizePath));
    for (const pair of LOCKFILE_PAIRS) {
      const lockTouched = [...normalizedSet].some((f) =>
        path.posix.basename(f) === pair.lockfile,
      );
      const manifestTouched = [...normalizedSet].some((f) =>
        path.posix.basename(f) === pair.manifest,
      );
      if (lockTouched && !manifestTouched) {
        violations.push({
          path: pair.lockfile,
          reason: "lockfile_without_package_json",
          detail: `${pair.lockfile} のみが変更されています。${pair.manifest} を伴わない依存変更は許可されていません。`,
        });
      }
      // Inverse case (manifest without lockfile) is allowed — version-bump
      // commits sometimes hand-edit only one file.
    }
  }

  return { ok: violations.length === 0, violations };
}

/**
 * Validate that allowed_paths itself is sensible (non-empty, not the
 * project root, no path-traversal escapes).
 */
export function validateAllowedPathsInput(allowedPaths: string[]): string[] {
  const errors: string[] = [];
  if (!allowedPaths || allowedPaths.length === 0) {
    errors.push("allowed_paths は1つ以上指定してください。");
  }
  for (const p of allowedPaths ?? []) {
    const n = normalizePath(p);
    if (n === "" || n === "." || n === "/") {
      errors.push(`allowed_paths にプロジェクト全体 ("${p}") を指定することは禁止されています。`);
    }
    if (n.includes("..")) {
      errors.push(`allowed_paths にパストラバーサルが含まれています: "${p}"`);
    }
  }
  return errors;
}
