# SP2: 堅牢性・エラー処理 (robustness) — 設計

- 日付: 2026-05-22
- 対象: codex-gateway-mcp-server
- 位置づけ: 品質向上 3 sub-project の第2弾 (SP1 基盤 ✅ / **SP2 堅牢性** / SP3 機能追加)。
- 実装方法: dogfooding。driver から `codex_implement` を呼び、feature ブランチ `feature/sp2-robustness` 上で実行。

## 目的

「環境前提が崩れたときに、原因が分からないまま失敗する」状況を無くす。今セッションで実際に踏んだ Codex CLI の非互換 (`--ask-for-approval` 廃止 → 謎の exit=2) のように、前提不成立を**早期に・明確なメッセージで**返す。

## スコープ (in)

1. **Codex CLI プリフライト検査** (`src/core/codexExec.ts`)
   - 新関数 `preflightCodex()`: `codex --version` を短いタイムアウト(15s)で実行。
   - 成功 → ok。失敗 (ENOENT / 実行不可) → 「Codex CLI が見つからない/実行できない。インストールと PATH を確認 (codex --version)。CODEX_BIN で明示指定も可」という actionable なメッセージを返す。
2. **git リポジトリ検査** (`src/core/git.ts`)
   - 新関数 `isGitRepo(cwd)`: `git rev-parse --is-inside-work-tree` で判定。
3. **ハンドラへの組み込み** (`src/tools/codexImplement.ts`, `src/tools/codexReviewFix.ts`)
   - 各ハンドラ冒頭付近で `isGitRepo(projectRoot)` を検査。git 管理外なら明確なメッセージで `rejected`。
   - `runCodexExec` 呼び出し前に `preflightCodex()` を実行。不成立なら Codex を起動せず、明確なメッセージで返す (Codex 起動失敗の謎メッセージを回避)。
4. **spawn エラーの識別** (`src/core/codexExec.ts`)
   - codex 起動失敗時、ENOENT 等を識別して「見つからない」旨に寄せる (現状は exit/stderr 末尾のみ)。

## スコープ (out / 後続)

- テストフレームワーク導入 → 別途。
- 新ツール・機能 → SP3。
- リトライ/バックオフ等の高度な耐障害性 → 過剰 (YAGNI)。今回は「前提検査と明確なエラー」に限定。

## 制約

- 既存の正常系の挙動を変えない (前提が成立していれば従来どおり動く)。
- 新たな runtime 依存は追加しない。
- 既存の `reject()` / `rejected()` ヘルパーと戻り値スキーマ (status/changed_files/.../next_action/log_id) を踏襲。
- `build` / `typecheck` / `lint` / `test`(smoke) が引き続き green。

## dogfood 実行単位 (codex_implement)

1タスク。`allowed_paths`:
- `src/core/codexExec.ts`
- `src/core/git.ts`
- `src/tools/codexImplement.ts`
- `src/tools/codexReviewFix.ts`

`commands_to_run`: `npm run lint`, `npm run build`, `npm run typecheck`, `npm test`。

## 検証 (完了条件)

- lint / build / typecheck / test 全 pass。
- **手動確認** (driver で実行):
  - `CODEX_BIN=__nonexistent__` で `codex_implement` → Codex を起動せず、「Codex CLI が見つからない」系の明確なメッセージで失敗する。
  - `PROJECT_ROOT` を git 管理外ディレクトリにして `codex_implement` → 「git リポジトリではない」と明確に rejected。
  - 正常な PROJECT_ROOT + codex 有り → 従来どおり成功する (回帰なし)。
- 私 (Claude Code) が `git diff` をレビューし、正常系の挙動が不変であることを確認。

## リスクと対処

- プリフライトの `codex --version` が毎回 ~数百ms 増える → 1タスクにつき1回で許容範囲。必要なら将来キャッシュ。
- preflight の位置が早すぎて既存の入力検証より先に出ると、エラーの優先順位が変わる → 入力検証 (allowed_paths 等) の後、Codex 起動の直前に置く。git 検査はハンドラ冒頭 (どの道 git 前提なので最初に弾く)。
