---
description: レビュー指摘だけを Codex に修正させる (codex_review_fix)
argument-hint: [修正させたい指摘。省略時は直近のレビュー結果を使う]
allowed-tools: mcp__codex-gateway__codex_review_fix, mcp__codex-gateway__codex_inspect_diff, Bash(git branch:*), Bash(git diff:*), Read, Grep, Glob
---

直前の codex_implement やレビューで挙がった指摘を Codex に修正させます。新規設計・追加機能・"ついで"のリファクタは禁止です。

## 修正対象の指摘
$ARGUMENTS

## 進め方
1. 上の指摘（空なら直近の会話で挙がったレビュー指摘）を `review_comments` の配列に整理する。1件も無ければユーザーに確認する。
2. `allowed_paths` を **指摘に関係するファイルだけ** に絞る。
3. `commands_to_run` に `npm run lint` / `npm run typecheck` / `npm test` などの検証コマンドを入れる。
4. 内容をユーザーに提示し、承認を得てから `codex_review_fix` を呼ぶ。
5. 完了後 `codex_inspect_diff` と `git diff` で、修正が指摘の範囲に収まっているか確認する。
6. 新たな設計判断が必要になった場合は codex_review_fix では扱わず、`/codex-implement` で改めて起票する。
