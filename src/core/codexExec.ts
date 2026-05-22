import { runCommand } from "./runCommand.js";
import { FORBIDDEN_COMMAND_PATTERNS, ASK_COMMAND_PATTERNS } from "./policy.js";
import type {
  CodexApprovalPolicy,
  CodexExecOptions,
  CodexSandbox,
} from "../types.js";

/**
 * Run `codex exec` with strict sandbox/approval settings and pipe the
 * prompt in via stdin. The wrapper centralizes how Codex is invoked so
 * each tool doesn't reinvent the flag set.
 *
 * Why stdin? Long structured prompts in argv risk OS argv-length limits
 * (~128KB on Linux) and shell quoting bugs. Codex reads the prompt body
 * from stdin reliably.
 */

export interface CodexExecResult {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

export async function preflightCodex(): Promise<{ ok: boolean; error?: string }> {
  const bin = process.env.CODEX_BIN ?? "codex";
  const res = await runCommand(bin, ["--version"], {
    cwd: process.cwd(),
    timeoutMs: 15_000,
  });

  if (res.exitCode === 0) {
    return { ok: true };
  }

  if (res.exitCode === null || /ENOENT|spawn error/i.test(res.stderr)) {
    return {
      ok: false,
      error: `Codex CLI (${bin}) が見つからないか実行できません。インストールと PATH を確認してください (codex --version)。CODEX_BIN で明示指定も可能です。`,
    };
  }

  const stderrTail = res.stderr.trim().split(/\r?\n/).slice(-5).join(" / ");
  return {
    ok: false,
    error: `Codex CLI (${bin}) の確認に失敗しました (exit=${res.exitCode}): ${stderrTail}`,
  };
}

export async function runCodexExec(opts: CodexExecOptions): Promise<CodexExecResult> {
  const bin = process.env.CODEX_BIN ?? "codex";

  const args = [
    "exec",
    "--cd",
    opts.cwd,
    "--sandbox",
    opts.sandbox,
    // codex >= 0.130 removed `--ask-for-approval` from the `exec` subcommand.
    // Approval policy is now set via a config override; the value portion is
    // parsed as TOML, so it is quoted to be an explicit string.
    "-c",
    `approval_policy="${opts.approval}"`,
    "--skip-git-repo-check",
  ];

  if (opts.model) {
    args.push("--model", opts.model);
  }

  // Hyphen tells codex to read the prompt body from stdin.
  args.push("-");

  const result = await runCommand(bin, args, {
    cwd: opts.cwd,
    stdin: opts.prompt,
    timeoutMs: opts.timeoutSeconds * 1000,
    env: {
      ...process.env,
      // Make Codex non-interactive even if its config has TTY hints.
      CI: process.env.CI ?? "1",
    },
  });

  return {
    ok: result.exitCode === 0 && !result.timedOut,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    durationMs: result.durationMs,
    timedOut: result.timedOut,
  };
}

/**
 * Resolve the effective sandbox setting: caller override > env > default.
 */
export function resolveSandbox(override?: CodexSandbox): CodexSandbox {
  if (override) return override;
  const env = process.env.CODEX_SANDBOX as CodexSandbox | undefined;
  if (env === "read-only" || env === "workspace-write" || env === "danger-full-access") {
    return env;
  }
  return "workspace-write";
}

export function resolveApproval(override?: CodexApprovalPolicy): CodexApprovalPolicy {
  if (override) return override;
  const env = process.env.CODEX_APPROVAL as CodexApprovalPolicy | undefined;
  if (env === "never" || env === "on-request" || env === "on-failure" || env === "untrusted") {
    return env;
  }
  return "on-request";
}

export function resolveTimeoutSeconds(): number {
  const v = parseInt(process.env.CODEX_TIMEOUT_SECONDS ?? "600", 10);
  return Number.isFinite(v) && v > 0 ? v : 600;
}

/**
 * Inspect a list of shell commands the user wants to run after Codex
 * finishes. Returns { forbidden, ask } where `forbidden` MUST cause the
 * tool to abort, and `ask` should be surfaced as a warning.
 */
export function classifyCommands(commands: string[]): {
  forbidden: string[];
  ask: string[];
} {
  const forbidden: string[] = [];
  const ask: string[] = [];
  for (const c of commands) {
    if (FORBIDDEN_COMMAND_PATTERNS.some((re) => re.test(c))) {
      forbidden.push(c);
      continue;
    }
    if (ASK_COMMAND_PATTERNS.some((re) => re.test(c))) {
      ask.push(c);
    }
  }
  return { forbidden, ask };
}
