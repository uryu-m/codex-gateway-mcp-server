---
description: codex の git worktree を一覧・安全削除する (codex_cleanup_worktrees)
argument-hint: [削除する worktree のパス... 省略時は一覧のみ]
allowed-tools: mcp__codex-gateway__codex_cleanup_worktrees, Bash(git worktree list:*)
---

codex_parallel_tasks が残した git worktree を一覧し、指定分だけ安全に削除します。

## 削除指定（任意）
$ARGUMENTS

## 進め方
1. まず `codex_cleanup_worktrees` を **引数なし** で呼び、worktree 一覧を取得してユーザーに提示する。
2. 削除対象が指定されている（または上で挙がった）場合は、それがメイン作業ツリーでないこと・`git worktree list` に登録済みであることを確認する。
3. 削除は破壊的操作です。対象パスをユーザーに提示し、承認を得てから `worktree_paths` を渡して `codex_cleanup_worktrees` を呼ぶ。
4. `removed` / `errors` を要約して報告する。
