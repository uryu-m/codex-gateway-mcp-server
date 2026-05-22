/**
 * Shared type definitions for codex-gateway-mcp.
 *
 * Type names follow the spec document. Keep these in sync with the
 * Zod schemas in each tool module — Zod is the source of truth for
 * runtime validation, these types mirror it for internal use.
 */

// ---------------------------------------------------------------------------
// Codex execution settings
// ---------------------------------------------------------------------------

export type CodexSandbox = "read-only" | "workspace-write" | "danger-full-access";

export type CodexApprovalPolicy = "never" | "on-request" | "on-failure" | "untrusted";

export interface CodexExecOptions {
  prompt: string;
  cwd: string;
  sandbox: CodexSandbox;
  approval: CodexApprovalPolicy;
  model?: string;
  timeoutSeconds: number;
}

// ---------------------------------------------------------------------------
// Command execution
// ---------------------------------------------------------------------------

export interface CommandResult {
  command: string;
  status: "passed" | "failed" | "skipped";
  exitCode: number | null;
  durationMs: number;
  stdout: string;
  stderr: string;
  output_summary: string;
}

// ---------------------------------------------------------------------------
// Path guard
// ---------------------------------------------------------------------------

export interface PathGuardResult {
  ok: boolean;
  violations: PathViolation[];
}

export interface PathViolation {
  path: string;
  reason:
    | "outside_allowed_paths"
    | "matches_forbidden_path"
    | "always_forbidden_secret"
    | "lockfile_without_package_json"
    | "branch_protected";
  detail: string;
}

// ---------------------------------------------------------------------------
// Tool input/output - codex_implement
// ---------------------------------------------------------------------------

export interface CodexImplementInput {
  task_title: string;
  objective: string;
  allowed_paths: string[];
  forbidden_paths?: string[];
  commands_to_run?: string[];
  constraints?: string[];
  model?: string;
  sandbox?: CodexSandbox;
  approval?: CodexApprovalPolicy;
}

export interface CodexImplementOutput {
  status: "success" | "failed" | "rejected";
  changed_files: string[];
  diff_stat: string;
  summary: string;
  commands_result: CommandResult[];
  warnings: string[];
  violations: PathViolation[];
  next_action: string;
  log_id: string;
}

// ---------------------------------------------------------------------------
// Tool input/output - codex_review_fix
// ---------------------------------------------------------------------------

export interface CodexReviewFixInput {
  review_comments: string[];
  allowed_paths: string[];
  commands_to_run?: string[];
  model?: string;
  sandbox?: CodexSandbox;
  approval?: CodexApprovalPolicy;
}

// ---------------------------------------------------------------------------
// Tool input/output - codex_inspect_diff
// ---------------------------------------------------------------------------

export interface CodexInspectDiffInput {
  base_ref?: string;
  target_ref?: string;
}

export interface CodexInspectDiffOutput {
  changed_files: string[];
  diff_stat: string;
  risk_points: string[];
  review_checklist: string[];
}

// ---------------------------------------------------------------------------
// Tool input/output - codex_cleanup_worktrees
// ---------------------------------------------------------------------------

export interface CodexCleanupWorktreesOutput {
  worktrees: Array<{ path: string; branch: string | null; isMain: boolean }>;
  removed: string[];
  errors: Array<{ path: string; reason: string }>;
  next_action: string;
}

// ---------------------------------------------------------------------------
// Tool input/output - codex_parallel_tasks
// ---------------------------------------------------------------------------

export interface ParallelTask {
  task_title: string;
  branch_name: string;
  worktree_path: string;
  objective: string;
  allowed_paths: string[];
  forbidden_paths?: string[];
  commands_to_run?: string[];
  constraints?: string[];
}

export interface CodexParallelTasksInput {
  tasks: ParallelTask[];
}

export interface ParallelTaskResult {
  task_title: string;
  branch_name: string;
  worktree_path: string;
  result: CodexImplementOutput;
}

// ---------------------------------------------------------------------------
// Audit log entry
// ---------------------------------------------------------------------------

export interface AuditLogEntry {
  log_id: string;
  tool: string;
  task_title: string;
  objective: string;
  allowed_paths: string[];
  forbidden_paths: string[];
  changed_files: string[];
  commands_result: CommandResult[];
  status: string;
  created_at: string;
  duration_ms: number;
}
