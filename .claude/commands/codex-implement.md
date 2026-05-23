---
description: Codex に限定範囲の実装を依頼する (codex_implement)
argument-hint: <実装してほしいタスクの説明>
allowed-tools: mcp__codex-gateway__codex_implement, mcp__codex-gateway__codex_inspect_diff, Bash(git branch:*), Bash(git status:*), Bash(git diff:*), Read, Grep, Glob
---

あなたは Claude Code として「設計・レビュー」を担当し、実装は codex-gateway 経由で Codex に委譲します。

## 現在の状態
- ブランチ: !`git branch --show-current`
- 変更状況: !`git status --short`

## 依頼内容
$ARGUMENTS

## 進め方
1. **ブランチ確認**: 現在のブランチが `main` / `master` / `develop` / `production` の場合は実行を中止し、作業ブランチへ切り替えるようユーザーに促す（ゲートも拒否します）。
2. **タスク分解**: 依頼を Codex に渡せる単一の実装タスクへ落とし込む。大きすぎる場合は分割案を提示してユーザーに確認する。依頼が空なら、何を実装したいかを質問する。
3. **範囲の決定**:
   - `allowed_paths`: 変更を許す最小限のパスだけに絞る（`.` や `/` は禁止）。
   - `forbidden_paths`: 必要に応じて `prisma/`, `migrations/`, `package.json`, `.env` 等を明示する。
   - `commands_to_run`: 既定で `npm run lint`, `npm run typecheck`, `npm test` などプロジェクトの検証コマンドを含める。
   - 設計上の制約があれば `constraints` に書く。
4. **確認**: codex_implement は破壊的操作です。`task_title` / `objective` / `allowed_paths` / `forbidden_paths` / `commands_to_run` をユーザーに提示し、承認を得てから呼ぶ。
5. **実行**: `codex_implement` を呼ぶ。
6. **レビュー**:
   - status が `success` なら `codex_inspect_diff` を呼び、`git diff` を実際に読んで risk_points と合わせてレビューする。
   - status が `rejected` / `failed` の場合は violations / commands_result を要約し、原因と次アクションを示す。
7. **コミット**: レビュー後、コミットしてよいかを必ずユーザーに確認する。Claude 自身は5行を超えるコードを直接編集せず、修正が必要なら再度 Codex に委譲する。
