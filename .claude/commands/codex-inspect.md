---
description: 2つの ref 間の差分をレビュー用に整理する (codex_inspect_diff)
argument-hint: [base_ref] [target_ref]  (既定: main HEAD)
allowed-tools: mcp__codex-gateway__codex_inspect_diff, Bash(git diff:*), Bash(git log:*), Read
---

指定 ref 間の差分を構造化し、Claude Code がレビューします。Codex は呼びません（純粋な git read）。

- base_ref（引数1。未指定なら `main`）: $1
- target_ref（引数2。未指定なら `HEAD`）: $2

## 進め方
1. `codex_inspect_diff` を base_ref / target_ref で呼ぶ（引数が空なら `main` / `HEAD` を既定とする）。
2. 返ってきた `risk_points` と `review_checklist` を踏まえ、`git diff <base>..<target>` を実際に読む。
3. ファイルごとに、バグ・設計上の懸念・テスト不足・risk_points への該当を指摘としてまとめる。
4. 重大な指摘があれば、`/codex-review-fix` で Codex に修正させられることを案内する。
