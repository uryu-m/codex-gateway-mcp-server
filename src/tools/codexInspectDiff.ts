import { z } from "zod";
import { getChangedFiles, getDiffStat, refExists } from "../core/git.js";
import { DEFAULT_REVIEW_CHECKLIST, HIGH_RISK_PATH_PATTERNS } from "../core/policy.js";
import { normalizePath } from "../core/pathGuard.js";
import type { CodexInspectDiffOutput } from "../types.js";

/**
 * codex_inspect_diff inspects a diff between two refs (default
 * main..HEAD) and produces a structured review packet for Claude Code.
 *
 * This tool does NOT call Codex — it's a pure git read. It exists so
 * that "let me look at what Codex did" is a structured tool call
 * rather than free-form bash inside Claude Code.
 */

export const CodexInspectDiffInputSchema = z
  .object({
    base_ref: z
      .string()
      .min(1)
      .optional()
      .describe("比較元 (既定: 'main')。"),
    target_ref: z
      .string()
      .min(1)
      .optional()
      .describe("比較先 (既定: 'HEAD')。"),
  })
  .strict();

export interface CodexInspectDiffContext {
  projectRoot: string;
}

export async function handleCodexInspectDiff(
  input: { base_ref?: string; target_ref?: string },
  ctx: CodexInspectDiffContext,
): Promise<CodexInspectDiffOutput> {
  const base = input.base_ref ?? "main";
  const target = input.target_ref ?? "HEAD";

  // Verify both refs exist; if not, return an empty result with a clear
  // risk_point so the caller knows what went wrong without throwing.
  const [baseOk, targetOk] = await Promise.all([
    refExists(ctx.projectRoot, base),
    refExists(ctx.projectRoot, target),
  ]);
  if (!baseOk || !targetOk) {
    const missing = [!baseOk && base, !targetOk && target].filter(Boolean).join(", ");
    return {
      changed_files: [],
      diff_stat: "",
      risk_points: [`参照できない ref があります: ${missing}`],
      review_checklist: [...DEFAULT_REVIEW_CHECKLIST],
    };
  }

  const [changedFiles, diffStat] = await Promise.all([
    getChangedFiles(ctx.projectRoot, base, target),
    getDiffStat(ctx.projectRoot, base, target),
  ]);

  const riskPoints = detectRiskPoints(changedFiles);

  return {
    changed_files: changedFiles,
    diff_stat: diffStat,
    risk_points: riskPoints,
    review_checklist: [...DEFAULT_REVIEW_CHECKLIST],
  };
}

/**
 * Match every changed file against HIGH_RISK_PATH_PATTERNS and emit a
 * deduplicated list of reasons. Order matches policy.ts so the most
 * important reasons appear first.
 */
function detectRiskPoints(changedFiles: string[]): string[] {
  const hits = new Set<string>();
  for (const file of changedFiles.map(normalizePath)) {
    for (const { pattern, reason } of HIGH_RISK_PATH_PATTERNS) {
      if (pattern.test(file)) hits.add(reason);
    }
  }
  // Also flag bulk changes — if Codex touched a lot of files at once,
  // that's a review signal even when no individual file is risky.
  if (changedFiles.length >= 20) {
    hits.add(`変更ファイル数が多い (${changedFiles.length}ファイル)`);
  }
  return [...hits];
}
