import { spawn, type SpawnOptions } from "node:child_process";
import type { CommandResult } from "../types.js";

/**
 * Execute a command as a child process with timeout, output capture,
 * and exit-code reporting. Used both for running Codex CLI and for
 * the user-supplied `commands_to_run` (lint, typecheck, test, ...).
 *
 * stdout/stderr are captured but also tee'd to the parent's stderr
 * (NEVER stdout — stdout belongs to the MCP transport).
 */
export interface RunCommandOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  /** Stdin to feed to the child process. */
  stdin?: string;
  /** If true, the command is wrapped with `sh -c` so shell syntax works. */
  shell?: boolean;
  /** Max bytes to retain from each of stdout/stderr (the rest is truncated). */
  maxOutputBytes?: number;
}

const DEFAULT_TIMEOUT_MS = 600_000; // 10 minutes
const DEFAULT_MAX_OUTPUT_BYTES = 1_000_000; // ~1 MB per stream

export interface RawCommandResult {
  command: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  durationMs: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/**
 * Spawn `command` (with optional args) and return a RawCommandResult.
 * Never throws on non-zero exit — callers decide how to handle failures.
 */
export async function runCommand(
  command: string,
  args: string[],
  options: RunCommandOptions,
): Promise<RawCommandResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;

  const start = Date.now();

  return new Promise((resolve) => {
    const spawnOpts: SpawnOptions = {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
      shell: options.shell ?? false,
    };

    const child = spawn(command, args, spawnOpts);

    let stdout = "";
    let stderr = "";
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      // SIGTERM first, then SIGKILL after a grace period.
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed) child.kill("SIGKILL");
      }, 5_000);
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdoutTruncated) return;
      const next = stdout + chunk.toString("utf8");
      if (next.length > maxBytes) {
        stdout = next.slice(0, maxBytes) + "\n... [stdout truncated]";
        stdoutTruncated = true;
      } else {
        stdout = next;
      }
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderrTruncated) return;
      const next = stderr + chunk.toString("utf8");
      if (next.length > maxBytes) {
        stderr = next.slice(0, maxBytes) + "\n... [stderr truncated]";
        stderrTruncated = true;
      } else {
        stderr = next;
      }
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        command: formatCommand(command, args),
        exitCode: null,
        signal: null,
        durationMs: Date.now() - start,
        stdout,
        stderr: stderr + `\nspawn error: ${err.message}`,
        timedOut: false,
      });
    });

    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({
        command: formatCommand(command, args),
        exitCode: code,
        signal,
        durationMs: Date.now() - start,
        stdout,
        stderr,
        timedOut,
      });
    });

    if (options.stdin !== undefined) {
      child.stdin?.write(options.stdin);
      child.stdin?.end();
    }
  });
}

/**
 * Run a user-supplied shell command string (e.g., "npm run lint")
 * and produce the structured CommandResult shape that tool outputs use.
 */
export async function runUserCommand(
  command: string,
  cwd: string,
  timeoutMs?: number,
): Promise<CommandResult> {
  const raw = await runCommand("sh", ["-c", command], {
    cwd,
    timeoutMs,
    shell: false,
  });

  const passed = raw.exitCode === 0 && !raw.timedOut;
  const summary = summarizeOutput(raw);

  return {
    command,
    status: passed ? "passed" : "failed",
    exitCode: raw.exitCode,
    durationMs: raw.durationMs,
    stdout: raw.stdout,
    stderr: raw.stderr,
    output_summary: summary,
  };
}

function formatCommand(command: string, args: string[]): string {
  return [command, ...args].join(" ");
}

/**
 * Heuristic one-line summary of a command result. Looks at the tail of
 * stdout/stderr because most lint/typecheck/test runners put their
 * verdict at the end.
 */
function summarizeOutput(raw: RawCommandResult): string {
  if (raw.timedOut) return `タイムアウト (${raw.durationMs}ms)`;
  if (raw.exitCode === 0) {
    const tail = lastNonEmptyLine(raw.stdout) ?? lastNonEmptyLine(raw.stderr);
    return tail ? `OK: ${tail.slice(0, 200)}` : "OK";
  }
  const tail = lastNonEmptyLine(raw.stderr) ?? lastNonEmptyLine(raw.stdout);
  return tail
    ? `exit=${raw.exitCode}: ${tail.slice(0, 200)}`
    : `exit=${raw.exitCode}`;
}

function lastNonEmptyLine(s: string): string | undefined {
  const lines = s.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]?.trim();
    if (line) return line;
  }
  return undefined;
}
