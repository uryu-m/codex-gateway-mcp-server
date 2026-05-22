# SP3: 機能追加 — `codex_cleanup_worktrees` 設計

- 日付: 2026-05-22
- 対象: codex-gateway-mcp-server
- 位置づけ: 品質向上 3 sub-project の第3弾 (SP1 基盤 ✅ / SP2 堅牢性 ✅ / **SP3 機能追加**)。
- 実装方法: dogfooding。driver から `codex_implement` を呼び、feature ブランチ `feature/sp3-cleanup-worktrees` 上で実行。

## 目的

`codex_parallel_tasks` はレビューのため worktree を**意図的に残す**。現状その削除は手動 (`git worktree remove`) のみで、ゲートの管理外。新ツール `codex_cleanup_worktrees` で「一覧 → 安全に削除」を MCP 経由の構造化操作にする。`removeWorktree()` は将来のこのツールのため既に export 済。

## 設計方針

`codex_inspect_diff` と同型の **純 git 操作ツール (Codex を呼ばない)**。雛形として codexInspectDiff の構成 (InputSchema / handler / index.ts への register / formatter) を踏襲する。

## スコープ (in)

1. **`listWorktrees(cwd)`** を `src/core/git.ts` に追加
   - `git worktree list --porcelain` をパースし `Array<{ path: string; branch: string | null; isMain: boolean }>` を返す。最初のエントリ (メイン作業ツリー) を `isMain: true`。
2. **新ツール `src/tools/codexCleanupWorktrees.ts`**
   - 入力 (zod strict): `worktree_paths?: string[]` (削除対象。相対は PROJECT_ROOT 基準で解決)。
   - 挙動:
     - 常に現在の worktree 一覧を取得。
     - `worktree_paths` 未指定/空 → 一覧のみ返す (削除しない)。
     - 指定あり → 各パスについて: (a) 登録済み worktree か、(b) メイン作業ツリーでないか を検証。満たさなければ `errors` に理由を積む (削除しない)。満たせば `removeWorktree(projectRoot, absPath, true)` で削除。
   - 出力: `{ worktrees: WorktreeInfo[], removed: string[], errors: Array<{path:string; reason:string}>, next_action: string }`。
3. **`src/index.ts` に register** (`codex_cleanup_worktrees`)。annotations は readOnlyHint=false, destructiveHint=true (削除あり)。人間向け formatter も追加。
4. 必要なら出力型を `src/types.ts` に追加 (inspect の `CodexInspectDiffOutput` と同様の置き場)。

## 安全制約 (重要)

- **メイン作業ツリー (PROJECT_ROOT 自身) は絶対に削除しない**。
- `git worktree list` に登録されていないパスは削除しない (任意ディレクトリ削除を防ぐ)。
- 削除は `removeWorktree` (内部で `git worktree remove --force`) に限定。ファイルシステムの生 `rm` はしない。
- 既存ツールの挙動・戻り値スキーマは変えない。

## スコープ (out)

- worktree の自動削除 (parallel 完了時の auto-remove) はしない (設計上わざと残す方針を維持)。
- `git worktree prune` 等の追加機能は今回入れない (YAGNI)。

## dogfood 実行単位 (codex_implement)

1タスク。`allowed_paths`:
- `src/tools/codexCleanupWorktrees.ts`
- `src/core/git.ts`
- `src/index.ts`
- `src/types.ts`

`commands_to_run`: `npm run lint`, `npm run build`, `npm run typecheck`, `npm test`。

## 検証 (完了条件)

- lint / build / typecheck / test 全 pass。
- MCP プロトコルの `tools/list` に **5ツール** (既存4 + `codex_cleanup_worktrees`) が出る。
- **手動確認** (driver, 一時 repo + worktree を作って):
  - `worktree_paths` 未指定 → worktree 一覧が返る (削除なし)。
  - 実在の非メイン worktree を指定 → 削除され `removed` に入る。`git worktree list` から消える。
  - メイン作業ツリーのパスを指定 → 削除されず `errors` に「メインは削除不可」。
  - 未登録パスを指定 → 削除されず `errors` に「登録されていない」。
- 私 (Claude Code) が `git diff` をレビューし、既存ツールに影響が無いことを確認。

## リスクと対処

- 削除系ツールなので誤削除が最大リスク → 「登録済み worktree のみ」「メイン除外」の二重ガードで限定。`destructiveHint: true` を付け、未指定時はデフォルトで一覧のみ (削除は明示指定が必要)。
- `git worktree list --porcelain` のパース → 空行区切り・`worktree`/`branch`/`detached`/`bare` 行を堅牢に処理。
