---
description: codex-gateway ワークフローのコマンド一覧と原則を表示する
---

codex-gateway を使った **Claude Code（設計・レビュー）+ Codex（実装）** 分業ワークフローのコマンド一覧です。ユーザーの状況に応じて適切なコマンドを案内してください。

| コマンド | 役割 | 対応ツール |
|---|---|---|
| `/codex-implement <タスク>` | 限定範囲の実装 | codex_implement |
| `/codex-review-fix [指摘]` | レビュー指摘の修正のみ | codex_review_fix |
| `/codex-inspect [base] [target]` | 差分のレビュー整形 | codex_inspect_diff |
| `/codex-parallel <タスク群>` | worktree で並列実装 | codex_parallel_tasks |
| `/codex-cleanup [path...]` | worktree の一覧・安全削除 | codex_cleanup_worktrees |

## 原則
- Claude Code は設計・レビューに専念し、5行を超える実装は Codex に委譲する。
- `allowed_paths` は常に最小限。`.` や `/` は禁止。
- 破壊的ツールの実行前に、変更範囲をユーザーへ提示して承認を得る。
- diff を読まずにコミットしない。最終 merge 判断は人間が行う。

## 前提
これらのコマンドは `codex-gateway` という名前で MCP サーバー（本リポジトリの `dist/index.js`）が接続されていることを前提とします。`/mcp` で `codex-gateway` の5ツールが見えることを確認してください。
