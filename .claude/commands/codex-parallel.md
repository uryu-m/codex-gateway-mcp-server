---
description: 独立タスクを worktree で並列実行する (codex_parallel_tasks)
argument-hint: <並列で進めたい独立タスク群の説明>
allowed-tools: mcp__codex-gateway__codex_parallel_tasks, mcp__codex-gateway__codex_cleanup_worktrees, Bash(git worktree list:*), Bash(git branch:*), Read, Grep, Glob
---

互いに完全に独立した 2〜5 件のタスクを、git worktree ごとに分けて並列実行します。

## 依頼内容
$ARGUMENTS

## 進め方
1. 依頼を **互いに独立した** タスク（2〜5件）に分解する。1件で済むなら `/codex-implement` を使う。
2. 各タスクに以下を設定する:
   - `task_title`, `objective`
   - `branch_name`（使える文字は英数字 `.` `_` `-` `/` のみ）, `worktree_path`
   - `allowed_paths`（最小限）。必要なら `forbidden_paths`, `commands_to_run`, `constraints`。
3. **並列禁止条件を自己チェック**: 次のいずれかに該当するタスクが1つでもあれば並列にしない（ゲートもバッチ全体を拒否します）。
   - `migrations/` / `prisma/` / `package.json` / `pyproject.toml` / 共通 `types/` / `api/` 層を触る
   - `allowed_paths` が他タスクと重複する
   - 該当する場合は逐次実行（`/codex-implement`）に切り替える。
4. タスク一覧をユーザーに提示し、承認を得てから `codex_parallel_tasks` を呼ぶ。
5. 実行後、worktree は **自動削除されません**。各 worktree の差分をレビューし、不要になったら `/codex-cleanup` で削除する。
