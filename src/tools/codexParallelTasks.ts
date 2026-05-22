import { z } from "zod";
import path from "node:path";
import { createWorktree, removeWorktree } from "../core/git.js";
import { AuditLogger } from "../core/logger.js";
import { normalizePath } from "../core/pathGuard.js";
import {
  handleCodexImplement,
  type CodexImplementContext,
} from "./codexImplement.js";
import type {
  CodexImplementOutput,
  ParallelTask,
  ParallelTaskResult,
} from "../types.js";

/**
 * Run multiple Codex tasks in parallel, each in its own git worktree.
 *
 * Safety constraints (enforced BEFORE any worktree is created):
 *   - No file may appear in more than one task's allowed_paths.
 *   - No task may touch migrations / package.json / shared type defs /
 *     API layer (heuristic: those paths in any task's allowed_paths
 *     reject the whole batch).
 *
 * The bias here is "fail the whole batch if anything looks risky" — it's
 * cheaper than half-merging worktrees that conflict downstream.
 */

const TaskSchema = z
  .object({
    task_title: z.string().min(3).max(200),
    branch_name: z
      .string()
      .min(1)
      .regex(/^[A-Za-z0-9._\-\/]+$/, "branch_name に使える文字は英数字 . _ - / のみです。"),
    worktree_path: z.string().min(1),
    objective: z.string().min(10).max(4000),
    allowed_paths: z.array(z.string().min(1)).min(1),
    forbidden_paths: z.array(z.string().min(1)).optional(),
    commands_to_run: z.array(z.string().min(1)).optional(),
    constraints: z.array(z.string().min(1)).optional(),
  })
  .strict();

export const CodexParallelTasksInputSchema = z
  .object({
    tasks: z
      .array(TaskSchema)
      .min(2, "並列実行は2件以上のタスクが必要です。1件なら codex_implement を使ってください。")
      .max(5, "1バッチあたり5タスクが上限です。"),
  })
  .strict();

export interface CodexParallelTasksContext {
  projectRoot: string;
  logger: AuditLogger;
}

const RISKY_PARALLEL_PATTERNS: ReadonlyArray<{ pattern: RegExp; reason: string }> = [
  { pattern: /(^|\/)migrations?\//, reason: "migrationを含むタスクは並列禁止" },
  { pattern: /(^|\/)prisma\//, reason: "prisma変更を含むタスクは並列禁止" },
  { pattern: /package\.json$/, reason: "package.json変更を含むタスクは並列禁止" },
  { pattern: /pyproject\.toml$/, reason: "pyproject.toml変更を含むタスクは並列禁止" },
  { pattern: /(^|\/)types?\//, reason: "共通型定義の変更を含むタスクは並列禁止" },
  { pattern: /(^|\/)api\//, reason: "API仕様変更を含むタスクは並列禁止" },
];

export interface CodexParallelTasksOutput {
  status: "success" | "partial" | "failed" | "rejected";
  results: ParallelTaskResult[];
  reject_reason?: string;
  next_action: string;
}

export async function handleCodexParallelTasks(
  input: { tasks: ParallelTask[] },
  ctx: CodexParallelTasksContext,
): Promise<CodexParallelTasksOutput> {
  // ---- Pre-flight: detect risky paths ----
  const risky: string[] = [];
  for (const t of input.tasks) {
    for (const p of t.allowed_paths) {
      const n = normalizePath(p);
      for (const { pattern, reason } of RISKY_PARALLEL_PATTERNS) {
        if (pattern.test(n)) risky.push(`${t.task_title}: ${reason} (${p})`);
      }
    }
  }
  if (risky.length > 0) {
    return {
      status: "rejected",
      results: [],
      reject_reason: `並列実行不可: ${risky.join("; ")}`,
      next_action: "対象を絞るか、codex_implement で順次実行してください。",
    };
  }

  // ---- Pre-flight: overlapping allowed_paths ----
  const overlap = detectAllowedPathOverlap(input.tasks);
  if (overlap) {
    return {
      status: "rejected",
      results: [],
      reject_reason: `タスク間で allowed_paths が重複しています: ${overlap}`,
      next_action: "同じファイル/ディレクトリを触るタスクは順次実行してください。",
    };
  }

  // ---- Run each task in its own worktree, in parallel ----
  const runTask = async (t: ParallelTask): Promise<ParallelTaskResult> => {
    const wtAbs = path.isAbsolute(t.worktree_path)
      ? t.worktree_path
      : path.resolve(ctx.projectRoot, t.worktree_path);

    const create = await createWorktree(ctx.projectRoot, wtAbs, t.branch_name);
    if (!create.ok) {
      return {
        task_title: t.task_title,
        branch_name: t.branch_name,
        worktree_path: wtAbs,
        result: {
          status: "rejected",
          changed_files: [],
          diff_stat: "",
          summary: `worktree作成失敗: ${create.error}`,
          commands_result: [],
          warnings: [],
          violations: [],
          next_action: "worktree先パスや既存ブランチの状態を確認してください。",
          log_id: "",
        } satisfies CodexImplementOutput,
      };
    }

    const subCtx: CodexImplementContext = {
      projectRoot: wtAbs,
      logger: ctx.logger,
    };

    let result: CodexImplementOutput;
    try {
      result = await handleCodexImplement(
        {
          task_title: t.task_title,
          objective: t.objective,
          allowed_paths: t.allowed_paths,
          forbidden_paths: t.forbidden_paths,
          commands_to_run: t.commands_to_run,
          constraints: t.constraints,
        },
        subCtx,
      );
    } finally {
      // We intentionally do NOT auto-remove the worktree on success — the
      // user needs the tree to review diff / merge. Only remove on
      // hard reject so we don't litter the filesystem.
      // (See README "Cleanup" section.)
    }

    return {
      task_title: t.task_title,
      branch_name: t.branch_name,
      worktree_path: wtAbs,
      result,
    };
  };

  const settled = await Promise.allSettled(input.tasks.map(runTask));
  const results: ParallelTaskResult[] = [];

  for (let i = 0; i < settled.length; i++) {
    const r = settled[i];
    const t = input.tasks[i]!;
    if (r.status === "fulfilled") {
      results.push(r.value);
    } else {
      results.push({
        task_title: t.task_title,
        branch_name: t.branch_name,
        worktree_path: t.worktree_path,
        result: {
          status: "failed",
          changed_files: [],
          diff_stat: "",
          summary: `unexpected error: ${String(r.reason)}`,
          commands_result: [],
          warnings: [],
          violations: [],
          next_action: "ログを確認してください。",
          log_id: "",
        },
      });
    }
  }

  const okCount = results.filter((r) => r.result.status === "success").length;
  const total = results.length;
  const status: CodexParallelTasksOutput["status"] =
    okCount === total ? "success" : okCount === 0 ? "failed" : "partial";

  return {
    status,
    results,
    next_action:
      status === "success"
        ? "各worktreeで git diff を確認してください。"
        : "失敗したタスクは個別に codex_implement で再実行を検討してください。",
  };
}

/**
 * Return a description of the first overlapping path pair found between
 * tasks, or null if every task's scope is disjoint.
 *
 * "Overlap" = one task's allowed path is the same as, or a prefix of,
 * another task's allowed path.
 */
function detectAllowedPathOverlap(tasks: ParallelTask[]): string | null {
  for (let i = 0; i < tasks.length; i++) {
    for (let j = i + 1; j < tasks.length; j++) {
      const a = tasks[i]!.allowed_paths.map(normalizePath);
      const b = tasks[j]!.allowed_paths.map(normalizePath);
      for (const p1 of a) {
        for (const p2 of b) {
          if (pathsOverlap(p1, p2)) {
            return `"${tasks[i]!.task_title}" の ${p1} と "${tasks[j]!.task_title}" の ${p2}`;
          }
        }
      }
    }
  }
  return null;
}

function pathsOverlap(a: string, b: string): boolean {
  if (a === b) return true;
  const aPrefix = a.endsWith("/") ? a : a + "/";
  const bPrefix = b.endsWith("/") ? b : b + "/";
  return b.startsWith(aPrefix) || a.startsWith(bPrefix);
}

// Re-export removeWorktree so the public-facing index can offer a
// dedicated cleanup tool later if desired.
export { removeWorktree };
