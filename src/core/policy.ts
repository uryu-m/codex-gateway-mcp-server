/**
 * Security policy constants.
 *
 * These rules are enforced by every tool in this gateway. They intentionally
 * lean conservative — when in doubt, fail closed. Loosening any rule should
 * require explicit code review.
 */

/**
 * Files that must NEVER appear in a diff produced by Codex, regardless of
 * the caller's allowed_paths. These hold credentials or fundamentally
 * change build/deploy behavior in ways that should be human-driven.
 */
export const ALWAYS_FORBIDDEN_PATHS: ReadonlyArray<string> = [
  ".env",
  ".env.local",
  ".env.production",
  ".env.development",
  ".env.staging",
  ".env.test",
];

/**
 * Filename substrings that imply a secret/credential. Any changed file
 * whose basename contains one of these is rejected.
 */
export const SECRET_FILENAME_SUBSTRINGS: ReadonlyArray<string> = [
  "secret",
  "secrets",
  "credentials",
  "credential",
  "private_key",
  "id_rsa",
  "id_ed25519",
  ".pem",
  ".pfx",
  ".p12",
  ".keystore",
];

/**
 * Lockfiles that should only change together with their manifest
 * (e.g., package-lock.json requires package.json in the same diff).
 */
export const LOCKFILE_PAIRS: ReadonlyArray<{ lockfile: string; manifest: string }> = [
  { lockfile: "package-lock.json", manifest: "package.json" },
  { lockfile: "pnpm-lock.yaml", manifest: "package.json" },
  { lockfile: "yarn.lock", manifest: "package.json" },
  { lockfile: "poetry.lock", manifest: "pyproject.toml" },
  { lockfile: "Cargo.lock", manifest: "Cargo.toml" },
  { lockfile: "Gemfile.lock", manifest: "Gemfile" },
  { lockfile: "composer.lock", manifest: "composer.json" },
];

/**
 * Branches that the gateway will refuse to operate on directly.
 * Codex must always work on a feature branch.
 */
export const PROTECTED_BRANCHES: ReadonlyArray<string> = [
  "main",
  "master",
  "develop",
  "production",
  "release",
];

/**
 * Substrings in `commands_to_run` that immediately reject the request.
 * These exist to stop Codex from being asked to push, delete data, or
 * exfiltrate secrets via the gateway.
 */
export const FORBIDDEN_COMMAND_PATTERNS: ReadonlyArray<RegExp> = [
  /\brm\s+-rf\b/,
  /\bsudo\b/,
  /\bgit\s+push\b/,
  /\bgit\s+reset\s+--hard\b/,
  /\bgit\s+clean\s+-fd\b/,
  /\bcurl\b/,
  /\bwget\b/,
  /\bnc\b/,
  /\bnetcat\b/,
  /:(){:\|:&};:/, // fork bomb
  /\bdd\s+if=/,
  /\bmkfs\b/,
  /\b>\s*\/dev\/sd[a-z]/,
];

/**
 * Commands that are allowed but require human acknowledgment.
 * The gateway will surface a warning when these are requested.
 */
export const ASK_COMMAND_PATTERNS: ReadonlyArray<RegExp> = [
  /\bnpm\s+install\b/,
  /\bpnpm\s+add\b/,
  /\byarn\s+add\b/,
  /\bpip\s+install\b/,
  /\bpoetry\s+add\b/,
  /\bcomposer\s+require\b/,
  /\bprisma\s+migrate\b/,
  /\balembic\s+revision\b/,
  /\brails\s+generate\s+migration\b/,
];

/**
 * Default review checklist surfaced by codex_inspect_diff.
 */
export const DEFAULT_REVIEW_CHECKLIST: ReadonlyArray<string> = [
  "仕様変更が混ざっていないか",
  "allowed_paths外の変更がないか",
  "テストが通っているか",
  "命名・コメントが既存スタイルに沿っているか",
  "新たな依存パッケージが追加されていないか",
  "ログ・デバッグ出力が残っていないか",
];

/**
 * File-path patterns that flag a diff as "high risk" in inspect_diff.
 * Hits here don't fail the diff — they raise it on the review checklist.
 */
export const HIGH_RISK_PATH_PATTERNS: ReadonlyArray<{ pattern: RegExp; reason: string }> = [
  { pattern: /(^|\/)migrations?\//, reason: "DBマイグレーションに変更あり" },
  { pattern: /(^|\/)prisma\//, reason: "Prismaスキーマに変更あり" },
  { pattern: /package\.json$/, reason: "package.jsonに変更あり (依存関係の可能性)" },
  { pattern: /pyproject\.toml$/, reason: "pyproject.tomlに変更あり (依存関係の可能性)" },
  { pattern: /requirements.*\.txt$/, reason: "requirementsファイルに変更あり" },
  { pattern: /(^|\/)Dockerfile$/, reason: "Dockerfileに変更あり" },
  { pattern: /docker-compose.*\.ya?ml$/, reason: "docker-compose設定に変更あり" },
  { pattern: /(^|\/)\.github\/workflows\//, reason: "GitHub Actionsワークフローに変更あり" },
  { pattern: /(^|\/)types?\/.*\.d\.ts$/, reason: "共通型定義(.d.ts)に変更あり" },
  { pattern: /(^|\/)schemas?\//, reason: "スキーマ定義に変更あり" },
  { pattern: /(^|\/)api\//, reason: "API層に変更あり" },
];
