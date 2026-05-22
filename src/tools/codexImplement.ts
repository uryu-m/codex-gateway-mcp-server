import { z } from "zod";
import {
  classifyCommands,
  resolveApproval,
  resolveSandbox,
  resolveTimeoutSeconds,
  runCodexExec,
} from "../core/codexExec.js";
import {
  getChangedFilesIncludingUntracked,
  getDiffPatch,
  getWorkingTreeStatIncludingUntracked,
  getStatus,
} from "../core/git.js";
import { AuditLogger } from "../core/logger.js";
import {
  validateAllowedPathsInput,
  validateChangedFiles,
} from "../core/pathGuard.js";
import { PROTECTED_BRANCHES } from "../core/policy.js";
import { buildImplementPrompt } from "../core/promptBuilder.js";
import { runUserCommand } from "../core/runCommand.js";
import type {
  CodexImplementInput,
  CodexImplementOutput,
  CommandResult,
} from "../types.js";

// ---------------------------------------------------------------------------
// Zod schema (the single source of truth for runtime validation)
// ---------------------------------------------------------------------------

export const CodexImplementInputSchema = z
  .object({
    task_title: z
      .string()
      .min(3, "task_title は3文字以上")
      .max(200, "task_title は200文字以内")
      .describe("タスクの短いタイトル。ログとレビュー時の識別に使われます。"),
    objective: z
      .string()
      .min(10, "objective は10文字以上で具体的に")
      .max(4000, "objective は4000文字以内")
      .describe("Codexが何を実装すべきかの具体的な目的。設計判断ではなく実装内容を書く。"),
    allowed_paths: z
      .array(z.string().min(1))
      .min(1, "allowed_paths は1つ以上指定してください。")
      .describe("Codexの変更を許可するパスのリスト (ディレクトリまたはファイル)。"),
    forbidden_paths: z
      .array(z.string().min(1))
      .optional()
      .describe("allowed_paths配下であっても変更を禁止するパス。"),
    commands_to_run: z
      .array(z.string().min(1))
      .optional()
      .describe("Codex実装後に実行するコマンド (例: ['npm run lint', 'npm test'])。"),
    constraints: z
      .array(z.string().min(1))
      .optional()
      .describe("追加の制約 (例: ['UI文言は既存トーンに合わせる'])。"),
    model: z
      .string()
      .optional()
      .describe("Codexのモデル指定 (例: 'gpt-5-codex')。未指定時はCodexの既定。"),
    sandbox: z
      .enum(["read-only", "workspace-write", "danger-full-access"])
      .optional()
      .describe("Codexのsandboxモード。既定は workspace-write。"),
    approval: z
      .enum(["never", "on-request", "on-failure", "untrusted"])
      .optional()
      .describe("Codexの承認ポリシー。既定は on-request。"),
  })
  .strict();

export const CodexImplementOutputSchema = z.object({
  status: z.enum(["success", "failed", "rejected"]),
  changed_files: z.array(z.string()),
  diff_stat: z.string(),
  summary: z.string(),
  commands_result: z.array(
    z.object({
      command: z.string(),
      status: z.enum(["passed", "failed", "skipped"]),
      exitCode: z.number().nullable(),
      durationMs: z.number(),
      stdout: z.string(),
      stderr: z.string(),
      output_summary: z.string(),
    }),
  ),
  warnings: z.array(z.string()),
  violations: z.array(
    z.object({
      path: z.string(),
      reason: z.string(),
      detail: z.string(),
    }),
  ),
  next_action: z.string(),
  log_id: z.string(),
});

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export interface CodexImplementContext {
  projectRoot: string;
  logger: AuditLogger;
}

/**
 * Execute a Codex implementation request, end-to-end.
 *
 * Steps follow the spec:
 *   1. git status check (refuse on dirty tree or protected branch)
 *   2. validate allowed_paths input
 *   3. classify commands_to_run (forbid/ask)
 *   4. run Codex via stdin
 *   5. collect changed files
 *   6. validate changed files against allowed/forbidden
 *   7. run commands_to_run
 *   8. write audit log
 *   9. return structured result
 */
export async function handleCodexImplement(
  input: CodexImplementInput,
  ctx: CodexImplementContext,
): Promise<CodexImplementOutput> {
  const { projectRoot, logger } = ctx;
  const { logId, basename } = logger.newLogId();
  const warnings: string[] = [];
  const startedAt = Date.now();

  await logger.writeTask(basename, { tool: "codex_implement", input, started_at: new Date().toISOString() });

  // ---- Step 1: git status check ----
  const status = await getStatus(projectRoot);
  if (status.branch && PROTECTED_BRANCHES.includes(status.branch)) {
    return reject(
      logger,
      basename,
      logId,
      `保護ブランチ "${status.branch}" 上での実行は禁止されています。feature ブランチを切ってから再実行してください。`,
    );
  }
  if (!status.clean) {
    warnings.push(
      `作業ツリーに未コミットの変更があります (${status.dirtyFiles.length}件)。Codexの変更と混ざる可能性があるため、commit/stash を推奨します。`,
    );
  }

  // ---- Step 2: allowed_paths validation ----
  const inputErrors = validateAllowedPathsInput(input.allowed_paths);
  if (inputErrors.length > 0) {
    return reject(logger, basename, logId, inputErrors.join(" / "));
  }

  // ---- Step 3: command classification ----
  const cmdClass = classifyCommands(input.commands_to_run ?? []);
  if (cmdClass.forbidden.length > 0) {
    return reject(
      logger,
      basename,
      logId,
      `禁止コマンドが含まれています: ${cmdClass.forbidden.join(", ")}`,
    );
  }
  for (const c of cmdClass.ask) {
    warnings.push(`要承認コマンドが含まれています: ${c} (Claude Code側で必要性を確認してください)`);
  }

  // ---- Step 4: run Codex ----
  const prompt = buildImplementPrompt(input);
  await logger.writePrompt(basename, prompt);

  const codexRes = await runCodexExec({
    prompt,
    cwd: projectRoot,
    sandbox: resolveSandbox(input.sandbox),
    approval: resolveApproval(input.approval),
    model: input.model,
    timeoutSeconds: resolveTimeoutSeconds(),
  });

  if (!codexRes.ok) {
    const summary = codexRes.timedOut
      ? `Codex がタイムアウトしました (${codexRes.durationMs}ms)。`
      : `Codex が失敗しました (exit=${codexRes.exitCode})。`;
    await logger.writeResult(basename, {
      log_id: logId,
      tool: "codex_implement",
      task_title: input.task_title,
      objective: input.objective,
      allowed_paths: input.allowed_paths,
      forbidden_paths: input.forbidden_paths ?? [],
      changed_files: [],
      commands_result: [],
      status: "failed",
      created_at: new Date().toISOString(),
      duration_ms: Date.now() - startedAt,
    });
    return {
      status: "failed",
      changed_files: [],
      diff_stat: "",
      summary,
      commands_result: [],
      warnings: [...warnings, codexRes.stderr.trim().split("\n").slice(-5).join(" / ")].filter(Boolean),
      violations: [],
      next_action: "Codex の stderr ログを確認してください。",
      log_id: logId,
    };
  }

  // ---- Step 5: collect changed files ----
  const changedFiles = await getChangedFilesIncludingUntracked(projectRoot);

  // ---- Step 6: path guard ----
  const guard = validateChangedFiles({
    changedFiles,
    allowedPaths: input.allowed_paths,
    forbiddenPaths: input.forbidden_paths ?? [],
  });

  // ---- Step 7: run user commands (only if guard passed — otherwise it's noise) ----
  const commandsResult: CommandResult[] = [];
  if (guard.ok) {
    for (const cmd of input.commands_to_run ?? []) {
      const res = await runUserCommand(cmd, projectRoot, resolveTimeoutSeconds() * 1000);
      commandsResult.push(res);
    }
  } else {
    for (const cmd of input.commands_to_run ?? []) {
      commandsResult.push({
        command: cmd,
        status: "skipped",
        exitCode: null,
        durationMs: 0,
        stdout: "",
        stderr: "path guard violation のため未実行",
        output_summary: "skipped (path guard violation)",
      });
    }
  }

  // ---- Step 8: gather diff + write audit log ----
  const diffStat = await getWorkingTreeStatIncludingUntracked(projectRoot);
  const diffPatch = await getDiffPatch(projectRoot);
  await logger.writeDiff(basename, diffPatch);
  await logger.writeCommandLog(basename, commandsResult);

  const allCommandsPassed = commandsResult.every((c) => c.status === "passed");
  const finalStatus: CodexImplementOutput["status"] = !guard.ok
    ? "rejected"
    : allCommandsPassed
    ? "success"
    : "failed";

  await logger.writeResult(basename, {
    log_id: logId,
    tool: "codex_implement",
    task_title: input.task_title,
    objective: input.objective,
    allowed_paths: input.allowed_paths,
    forbidden_paths: input.forbidden_paths ?? [],
    changed_files: changedFiles,
    commands_result: commandsResult,
    status: finalStatus,
    created_at: new Date().toISOString(),
    duration_ms: Date.now() - startedAt,
  });

  // ---- Step 9: build summary + next_action ----
  const codexSummary = extractSummary(codexRes.stdout);
  const nextAction = !guard.ok
    ? "path guard 違反です。Codexが対象外を変更しています。git checkout で破棄するか、allowed_paths を見直してください。"
    : !allCommandsPassed
    ? "lint / typecheck / test の失敗を確認し、必要なら codex_review_fix で修正を依頼してください。"
    : "Claude Code で git diff を読み、問題なければ commit してください。";

  return {
    status: finalStatus,
    changed_files: changedFiles,
    diff_stat: diffStat,
    summary: codexSummary,
    commands_result: commandsResult,
    warnings,
    violations: guard.violations,
    next_action: nextAction,
    log_id: logId,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function reject(
  logger: AuditLogger,
  basename: string,
  logId: string,
  reason: string,
): CodexImplementOutput {
  // Fire-and-forget log write — we don't want reject() to be async-noisy
  // for the caller's sake, and any I/O failure here is non-critical.
  void logger.writeResult(basename, {
    log_id: logId,
    tool: "codex_implement",
    task_title: "",
    objective: "",
    allowed_paths: [],
    forbidden_paths: [],
    changed_files: [],
    commands_result: [],
    status: "rejected",
    created_at: new Date().toISOString(),
    duration_ms: 0,
  });
  return {
    status: "rejected",
    changed_files: [],
    diff_stat: "",
    summary: reason,
    commands_result: [],
    warnings: [],
    violations: [],
    next_action: "リクエスト内容を見直して再実行してください。",
    log_id: logId,
  };
}

/**
 * Pull the "## 変更概要" section out of Codex's stdout if present,
 * otherwise return the last ~10 non-empty lines as a fallback.
 */
function extractSummary(stdout: string): string {
  const m = stdout.match(/##\s*変更概要\s*\n([\s\S]*?)(?:\n##|\n#|$)/);
  if (m && m[1]) return m[1].trim();
  const lines = stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.slice(-10).join("\n");
}
