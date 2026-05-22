#!/usr/bin/env node
/**
 * codex-gateway-mcp-server
 *
 * MCP gateway that exposes Codex CLI as four controlled tools:
 *   - codex_implement     : limited-scope implementation
 *   - codex_review_fix    : post-review fixes (no new design)
 *   - codex_inspect_diff  : structured diff review packet for Claude
 *   - codex_parallel_tasks: parallel execution via git worktrees
 *
 * Transport: stdio (this server is launched as a subprocess by Claude
 * Code or any other MCP-compatible client).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import path from "node:path";
import fs from "node:fs";

import { AuditLogger } from "./core/logger.js";
import {
  CodexImplementInputSchema,
  CodexImplementOutputSchema,
  handleCodexImplement,
} from "./tools/codexImplement.js";
import {
  CodexReviewFixInputSchema,
  handleCodexReviewFix,
} from "./tools/codexReviewFix.js";
import {
  CodexInspectDiffInputSchema,
  handleCodexInspectDiff,
} from "./tools/codexInspectDiff.js";
import {
  CodexParallelTasksInputSchema,
  handleCodexParallelTasks,
} from "./tools/codexParallelTasks.js";

// ---------------------------------------------------------------------------
// Runtime configuration
// ---------------------------------------------------------------------------

function resolveProjectRoot(): string {
  const fromEnv = process.env.PROJECT_ROOT;
  if (fromEnv && fs.existsSync(fromEnv)) {
    return path.resolve(fromEnv);
  }
  // Fall back to the cwd the server was launched in.
  return process.cwd();
}

function resolveLogDir(projectRoot: string): string {
  const fromEnv = process.env.LOG_DIR;
  if (fromEnv) {
    return path.isAbsolute(fromEnv) ? fromEnv : path.resolve(projectRoot, fromEnv);
  }
  return path.resolve(projectRoot, "logs");
}

const PROJECT_ROOT = resolveProjectRoot();
const LOG_DIR = resolveLogDir(PROJECT_ROOT);
const logger = new AuditLogger(LOG_DIR);

// Eagerly create the log dir so the first tool call doesn't race on it.
fs.mkdirSync(LOG_DIR, { recursive: true });

// All diagnostic output MUST go to stderr — stdout is the MCP transport.
console.error(`[codex-gateway-mcp] project_root=${PROJECT_ROOT}`);
console.error(`[codex-gateway-mcp] log_dir=${LOG_DIR}`);

// ---------------------------------------------------------------------------
// Server setup
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: "codex-gateway-mcp-server",
  version: "0.1.0",
});

// ----- codex_implement -----

server.registerTool(
  "codex_implement",
  {
    title: "Codex に限定実装を依頼",
    description: `Codex CLI に対して、allowed_paths で指定された範囲だけの実装を依頼します。

Codex は設計判断をせず、与えられた objective を、与えられた範囲で実装することだけが許されます。
本ツールは以下を自動で行います:
  1. git の状態確認 (保護ブランチ・dirty tree)
  2. allowed_paths / forbidden_paths の入力検証
  3. commands_to_run の禁止コマンド検査
  4. Codex 実行 (stdin 経由でプロンプトを渡す)
  5. 変更ファイルの収集 (未追跡ファイルも含む)
  6. 変更が allowed_paths 内に収まっているかの検証
  7. lint / typecheck / test 等の実行
  8. 監査ログの保存 (logs/ 配下)
  9. status / changed_files / diff_stat / commands_result を返す

戻り値の status:
  - "success"  : 全コマンド成功、path guard 違反なし
  - "failed"   : path guard はOKだが lint/test 等が失敗
  - "rejected" : 入力 or path guard 違反のため Codex の出力を破棄すべき

成功時は Claude Code 側で git diff を読んでレビューしてください。
`,
    inputSchema: CodexImplementInputSchema.shape,
    outputSchema: CodexImplementOutputSchema.shape,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async (params) => {
    const output = await handleCodexImplement(params, {
      projectRoot: PROJECT_ROOT,
      logger,
    });
    return {
      content: [{ type: "text" as const, text: formatImplementResult(output) }],
      structuredContent: output as unknown as Record<string, unknown>,
    };
  },
);

// ----- codex_review_fix -----

server.registerTool(
  "codex_review_fix",
  {
    title: "レビュー指摘の修正を Codex に依頼",
    description: `codex_implement の後、Claude Code のレビューで挙がった指摘を Codex に修正させます。

新規設計・追加機能・"ついでの" リファクタは禁止です。
review_comments に書かれた内容のみが修正対象で、allowed_paths もレビュー対象ファイルだけに絞ることを推奨します。

戻り値は codex_implement と同形式です。
`,
    inputSchema: CodexReviewFixInputSchema.shape,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async (params) => {
    const output = await handleCodexReviewFix(params, {
      projectRoot: PROJECT_ROOT,
      logger,
    });
    return {
      content: [{ type: "text" as const, text: formatImplementResult(output) }],
      structuredContent: output as unknown as Record<string, unknown>,
    };
  },
);

// ----- codex_inspect_diff -----

server.registerTool(
  "codex_inspect_diff",
  {
    title: "差分をレビュー用に整理",
    description: `2つの ref 間の差分を取得し、Claude Code のレビュー材料として整理します。

Codex は呼び出しません (純粋な git read のみ)。

返却:
  - changed_files     : 変更ファイル一覧
  - diff_stat         : git diff --stat の出力
  - risk_points       : 高リスクパスへの変更があれば検出 (migration, package.json, API層 等)
  - review_checklist  : 既定のレビュー観点
`,
    inputSchema: CodexInspectDiffInputSchema.shape,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (params) => {
    const output = await handleCodexInspectDiff(params, { projectRoot: PROJECT_ROOT });
    return {
      content: [{ type: "text" as const, text: formatInspectResult(output) }],
      structuredContent: output as unknown as Record<string, unknown>,
    };
  },
);

// ----- codex_parallel_tasks -----

server.registerTool(
  "codex_parallel_tasks",
  {
    title: "独立タスクを worktree で並列実行",
    description: `複数の独立タスクを git worktree ごとに分けて並列実行します。

事前検査:
  - migration / prisma / package.json / 共通型 / API層を含むタスクは拒否
  - タスク間で allowed_paths が重複していたら拒否

各タスクは内部的に codex_implement を呼び出します。
worktree は意図的に自動削除しません (レビュー後にユーザーが削除)。
`,
    inputSchema: CodexParallelTasksInputSchema.shape,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async (params) => {
    const output = await handleCodexParallelTasks(params, {
      projectRoot: PROJECT_ROOT,
      logger,
    });
    return {
      content: [{ type: "text" as const, text: formatParallelResult(output) }],
      structuredContent: output as unknown as Record<string, unknown>,
    };
  },
);

// ---------------------------------------------------------------------------
// Human-friendly text renderers (the structured payload is the main contract;
// text is for chat display).
// ---------------------------------------------------------------------------

function formatImplementResult(o: {
  status: string;
  changed_files: string[];
  diff_stat: string;
  summary: string;
  commands_result: Array<{ command: string; status: string; output_summary: string }>;
  warnings: string[];
  violations: Array<{ path: string; reason: string; detail: string }>;
  next_action: string;
  log_id: string;
}): string {
  const lines: string[] = [];
  lines.push(`status: ${o.status}`);
  lines.push(`log_id: ${o.log_id}`);
  lines.push("");
  if (o.summary) {
    lines.push("## 変更概要");
    lines.push(o.summary);
    lines.push("");
  }
  if (o.changed_files.length > 0) {
    lines.push(`## 変更ファイル (${o.changed_files.length})`);
    for (const f of o.changed_files) lines.push(`- ${f}`);
    lines.push("");
  }
  if (o.diff_stat) {
    lines.push("## diff_stat");
    lines.push("```");
    lines.push(o.diff_stat);
    lines.push("```");
    lines.push("");
  }
  if (o.commands_result.length > 0) {
    lines.push("## 実行コマンド結果");
    for (const c of o.commands_result) {
      lines.push(`- [${c.status}] ${c.command} — ${c.output_summary}`);
    }
    lines.push("");
  }
  if (o.warnings.length > 0) {
    lines.push("## warnings");
    for (const w of o.warnings) lines.push(`- ${w}`);
    lines.push("");
  }
  if (o.violations.length > 0) {
    lines.push("## path guard violations");
    for (const v of o.violations) {
      lines.push(`- [${v.reason}] ${v.path}: ${v.detail}`);
    }
    lines.push("");
  }
  lines.push(`next_action: ${o.next_action}`);
  return lines.join("\n");
}

function formatInspectResult(o: {
  changed_files: string[];
  diff_stat: string;
  risk_points: string[];
  review_checklist: string[];
}): string {
  const lines: string[] = [];
  lines.push(`## 変更ファイル (${o.changed_files.length})`);
  for (const f of o.changed_files) lines.push(`- ${f}`);
  lines.push("");
  if (o.diff_stat) {
    lines.push("## diff_stat");
    lines.push("```");
    lines.push(o.diff_stat);
    lines.push("```");
    lines.push("");
  }
  if (o.risk_points.length > 0) {
    lines.push("## risk_points");
    for (const r of o.risk_points) lines.push(`- ${r}`);
    lines.push("");
  }
  lines.push("## review_checklist");
  for (const c of o.review_checklist) lines.push(`- [ ] ${c}`);
  return lines.join("\n");
}

function formatParallelResult(o: {
  status: string;
  results: Array<{
    task_title: string;
    branch_name: string;
    worktree_path: string;
    result: { status: string; changed_files: string[]; next_action: string };
  }>;
  reject_reason?: string;
  next_action: string;
}): string {
  const lines: string[] = [];
  lines.push(`status: ${o.status}`);
  if (o.reject_reason) {
    lines.push(`reject_reason: ${o.reject_reason}`);
  }
  lines.push("");
  for (const r of o.results) {
    lines.push(`### ${r.task_title}  [${r.result.status}]`);
    lines.push(`branch: ${r.branch_name}`);
    lines.push(`worktree: ${r.worktree_path}`);
    lines.push(`changed_files: ${r.result.changed_files.length}`);
    lines.push(`next_action: ${r.result.next_action}`);
    lines.push("");
  }
  lines.push(`next_action: ${o.next_action}`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[codex-gateway-mcp] connected via stdio");
}

main().catch((err) => {
  console.error("[codex-gateway-mcp] fatal:", err);
  process.exit(1);
});
