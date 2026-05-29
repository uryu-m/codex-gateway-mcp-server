import { z } from "zod";
import {
  classifyCommands,
  preflightCodex,
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
  isGitRepo,
} from "../core/git.js";
import { AuditLogger } from "../core/logger.js";
import {
  validateAllowedPathsInput,
  validateChangedFiles,
} from "../core/pathGuard.js";
import { PROTECTED_BRANCHES } from "../core/policy.js";
import { buildReviewFixPrompt } from "../core/promptBuilder.js";
import { runUserCommand } from "../core/runCommand.js";
import type {
  CodexImplementOutput,
  CodexReviewFixInput,
  CommandResult,
} from "../types.js";

/**
 * codex_review_fix is a stricter, narrower version of codex_implement.
 * Only review comments may drive changes; allowed_paths is typically
 * scoped down to the exact files that were just reviewed.
 */

export const CodexReviewFixInputSchema = z
  .object({
    review_comments: z
      .array(z.string().min(1))
      .min(1, "review_comments を1つ以上指定してください。")
      .describe("Claude Codeのレビュー指摘。Codexはここに書かれた内容のみ修正します。"),
    allowed_paths: z
      .array(z.string().min(1))
      .min(1)
      .describe("変更を許可するパス。レビュー対象ファイルだけに絞ることを推奨。"),
    commands_to_run: z
      .array(z.string().min(1))
      .optional()
      .describe("修正後に実行するコマンド (lint/typecheck/test など)。"),
    model: z
      .string()
      .optional()
      .describe(
        "Codexのモデル指定 (例: 'gpt-5.5')。未指定時は CODEX_MODEL、さらに未設定なら Codex の既定。",
      ),
    sandbox: z
      .enum(["read-only", "workspace-write", "danger-full-access"])
      .optional(),
    approval: z
      .enum(["never", "on-request", "on-failure", "untrusted"])
      .optional(),
  })
  .strict();

export interface CodexReviewFixContext {
  projectRoot: string;
  logger: AuditLogger;
}

export async function handleCodexReviewFix(
  input: CodexReviewFixInput,
  ctx: CodexReviewFixContext,
): Promise<CodexImplementOutput> {
  const { projectRoot, logger } = ctx;
  const { logId, basename } = logger.newLogId();
  const warnings: string[] = [];
  const startedAt = Date.now();

  await logger.writeTask(basename, {
    tool: "codex_review_fix",
    input,
    started_at: new Date().toISOString(),
  });

  // Protected branch / allowed_paths input validation.
  if (!(await isGitRepo(projectRoot))) {
    return rejected(
      logger,
      basename,
      logId,
      `PROJECT_ROOT (${projectRoot}) は git リポジトリではありません。git 管理下のディレクトリを指定してください。`,
    );
  }

  const status = await getStatus(projectRoot);
  if (status.branch && PROTECTED_BRANCHES.includes(status.branch)) {
    return rejected(logger, basename, logId,
      `保護ブランチ "${status.branch}" 上での修正は禁止されています。`);
  }
  const inputErrors = validateAllowedPathsInput(input.allowed_paths);
  if (inputErrors.length > 0) {
    return rejected(logger, basename, logId, inputErrors.join(" / "));
  }

  const cmdClass = classifyCommands(input.commands_to_run ?? []);
  if (cmdClass.forbidden.length > 0) {
    return rejected(logger, basename, logId,
      `禁止コマンド: ${cmdClass.forbidden.join(", ")}`);
  }
  for (const c of cmdClass.ask) {
    warnings.push(`要承認コマンド: ${c}`);
  }

  const prompt = buildReviewFixPrompt(input);
  await logger.writePrompt(basename, prompt);

  const codexPreflight = await preflightCodex();
  if (!codexPreflight.ok) {
    return rejected(logger, basename, logId, codexPreflight.error ?? "Codex CLI の確認に失敗しました。");
  }

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
      ? `Codex タイムアウト (${codexRes.durationMs}ms)`
      : `Codex 失敗 (exit=${codexRes.exitCode})`;
    return {
      status: "failed",
      changed_files: [],
      diff_stat: "",
      summary,
      commands_result: [],
      warnings,
      violations: [],
      next_action: "stderrを確認してください。",
      log_id: logId,
    };
  }

  const changedFiles = await getChangedFilesIncludingUntracked(projectRoot);
  const guard = validateChangedFiles({
    changedFiles,
    allowedPaths: input.allowed_paths,
    forbiddenPaths: [],
  });

  const commandsResult: CommandResult[] = [];
  if (guard.ok) {
    for (const cmd of input.commands_to_run ?? []) {
      commandsResult.push(await runUserCommand(cmd, projectRoot, resolveTimeoutSeconds() * 1000));
    }
  } else {
    for (const cmd of input.commands_to_run ?? []) {
      commandsResult.push({
        command: cmd, status: "skipped", exitCode: null, durationMs: 0,
        stdout: "", stderr: "path guard violation", output_summary: "skipped",
      });
    }
  }

  const diffStat = await getWorkingTreeStatIncludingUntracked(projectRoot);
  const diffPatch = await getDiffPatch(projectRoot);
  await logger.writeDiff(basename, diffPatch);
  await logger.writeCommandLog(basename, commandsResult);

  const allPassed = commandsResult.every((c) => c.status === "passed");
  const finalStatus: CodexImplementOutput["status"] = !guard.ok
    ? "rejected"
    : allPassed
    ? "success"
    : "failed";

  await logger.writeResult(basename, {
    log_id: logId,
    tool: "codex_review_fix",
    task_title: `review_fix (${input.review_comments.length}件)`,
    objective: input.review_comments.join(" / "),
    allowed_paths: input.allowed_paths,
    forbidden_paths: [],
    changed_files: changedFiles,
    commands_result: commandsResult,
    status: finalStatus,
    created_at: new Date().toISOString(),
    duration_ms: Date.now() - startedAt,
  });

  return {
    status: finalStatus,
    changed_files: changedFiles,
    diff_stat: diffStat,
    summary: extractFixSummary(codexRes.stdout),
    commands_result: commandsResult,
    warnings,
    violations: guard.violations,
    next_action: !guard.ok
      ? "path guard 違反。git checkout で破棄してください。"
      : !allPassed
      ? "コマンド失敗を確認してください。"
      : "Claude Code で再レビューしてください。",
    log_id: logId,
  };
}

function rejected(
  logger: AuditLogger,
  basename: string,
  logId: string,
  reason: string,
): CodexImplementOutput {
  void logger.writeResult(basename, {
    log_id: logId,
    tool: "codex_review_fix",
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
    next_action: "入力を見直してください。",
    log_id: logId,
  };
}

function extractFixSummary(stdout: string): string {
  const m = stdout.match(/##\s*修正サマリー\s*\n([\s\S]*?)(?:\n##|\n#|$)/);
  if (m && m[1]) return m[1].trim();
  return stdout.split(/\r?\n/).filter((l) => l.trim()).slice(-10).join("\n");
}
