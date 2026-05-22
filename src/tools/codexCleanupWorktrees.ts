import path from "node:path";
import { realpath } from "node:fs/promises";
import { z } from "zod";
import { listWorktrees, removeWorktree } from "../core/git.js";
import type { CodexCleanupWorktreesOutput } from "../types.js";

/**
 * codex_cleanup_worktrees lists registered git worktrees and optionally
 * removes selected non-main worktrees.
 *
 * This tool does NOT call Codex. Removal is limited to paths reported by
 * `git worktree list --porcelain`, and the main working tree is never removed.
 */

export const CodexCleanupWorktreesInputSchema = z
  .object({
    worktree_paths: z
      .array(z.string().min(1))
      .optional()
      .describe("削除する worktree のパス一覧。相対パスは projectRoot から解決します。"),
  })
  .strict()
  .describe("git worktree の一覧取得、または指定 worktree の安全削除を行う入力。");

export interface CodexCleanupWorktreesContext {
  projectRoot: string;
}

export async function handleCodexCleanupWorktrees(
  input: { worktree_paths?: string[] },
  ctx: CodexCleanupWorktreesContext,
): Promise<CodexCleanupWorktreesOutput> {
  const requestedPaths = input.worktree_paths ?? [];
  const worktrees = await listWorktrees(ctx.projectRoot);

  if (requestedPaths.length === 0) {
    return {
      worktrees,
      removed: [],
      errors: [],
      next_action: "削除するには worktree_paths を指定してください。",
    };
  }

  const removed: string[] = [];
  const errors: Array<{ path: string; reason: string }> = [];

  for (const requestedPath of requestedPaths) {
    const absPath = path.isAbsolute(requestedPath)
      ? requestedPath
      : path.resolve(ctx.projectRoot, requestedPath);
    let normalizedPath: string;
    try {
      normalizedPath = await realpath(absPath);
    } catch {
      errors.push({ path: absPath, reason: "登録された worktree ではありません" });
      continue;
    }

    const worktree = worktrees.find((w) => w.path === normalizedPath);

    if (!worktree) {
      errors.push({ path: absPath, reason: "登録された worktree ではありません" });
      continue;
    }

    if (worktree.isMain) {
      errors.push({ path: normalizedPath, reason: "メイン作業ツリーは削除できません" });
      continue;
    }

    const result = await removeWorktree(ctx.projectRoot, normalizedPath, true);
    if (result.ok) {
      removed.push(normalizedPath);
    } else {
      errors.push({ path: normalizedPath, reason: result.error ?? "worktree の削除に失敗しました" });
    }
  }

  const latestWorktrees = await listWorktrees(ctx.projectRoot);

  return {
    worktrees: latestWorktrees,
    removed,
    errors,
    next_action: buildNextAction(removed, errors),
  };
}

function buildNextAction(
  removed: string[],
  errors: Array<{ path: string; reason: string }>,
): string {
  if (removed.length > 0 && errors.length === 0) {
    return "指定された worktree を削除しました。";
  }
  if (removed.length > 0) {
    return "一部の worktree を削除しました。errors を確認してください。";
  }
  return "削除できた worktree はありません。errors を確認してください。";
}
