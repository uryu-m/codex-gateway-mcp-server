import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { AuditLogEntry, CommandResult } from "../types.js";

/**
 * Audit log writer. Every gateway invocation produces:
 *   logs/<timestamp>-<log_id>-task.json
 *   logs/<timestamp>-<log_id>-prompt.txt
 *   logs/<timestamp>-<log_id>-result.json
 *   logs/<timestamp>-<log_id>-diff.patch
 *
 * These are append-only — the gateway never deletes logs. Operators
 * are expected to rotate `logs/` themselves.
 */

export class AuditLogger {
  constructor(private readonly logDir: string) {}

  /** Create a fresh log_id with a sortable timestamp prefix. */
  newLogId(): { logId: string; basename: string } {
    const ts = new Date().toISOString().replace(/[:.]/g, "").replace("T", "T");
    const id = randomUUID().slice(0, 8);
    const basename = `${ts}-${id}`;
    return { logId: id, basename };
  }

  async ensureDir(): Promise<void> {
    await fs.mkdir(this.logDir, { recursive: true });
    // Keep the gateway's own audit logs out of git. If LOG_DIR sits inside
    // the target repo (the README's recommended layout), `git ls-files
    // --others` would otherwise report our task.json/prompt.txt — which are
    // written BEFORE change-collection — as untracked changes, and the path
    // guard would falsely reject a perfectly valid Codex run. A self-ignoring
    // ".gitignore" makes git skip everything under the log dir.
    const gitignore = path.join(this.logDir, ".gitignore");
    try {
      await fs.access(gitignore);
    } catch {
      await fs.writeFile(gitignore, "*\n", "utf8");
    }
  }

  async writePrompt(basename: string, prompt: string): Promise<void> {
    await this.ensureDir();
    await fs.writeFile(path.join(this.logDir, `${basename}-prompt.txt`), prompt, "utf8");
  }

  async writeTask(basename: string, task: Record<string, unknown>): Promise<void> {
    await this.ensureDir();
    await fs.writeFile(
      path.join(this.logDir, `${basename}-task.json`),
      JSON.stringify(task, null, 2),
      "utf8",
    );
  }

  async writeResult(basename: string, result: AuditLogEntry): Promise<void> {
    await this.ensureDir();
    await fs.writeFile(
      path.join(this.logDir, `${basename}-result.json`),
      JSON.stringify(result, null, 2),
      "utf8",
    );
  }

  async writeDiff(basename: string, diff: string): Promise<void> {
    if (!diff) return;
    await this.ensureDir();
    await fs.writeFile(
      path.join(this.logDir, `${basename}-diff.patch`),
      diff,
      "utf8",
    );
  }

  async writeCommandLog(
    basename: string,
    commands: CommandResult[],
  ): Promise<void> {
    if (commands.length === 0) return;
    await this.ensureDir();
    const text = commands
      .map((c) =>
        [
          `$ ${c.command}`,
          `# exit=${c.exitCode} status=${c.status} duration=${c.durationMs}ms`,
          "--- stdout ---",
          c.stdout || "(empty)",
          "--- stderr ---",
          c.stderr || "(empty)",
          "",
        ].join("\n"),
      )
      .join("\n");
    await fs.writeFile(
      path.join(this.logDir, `${basename}-commands.log`),
      text,
      "utf8",
    );
  }
}
