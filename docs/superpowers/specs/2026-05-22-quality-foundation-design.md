# SP1: コード品質基盤 (quality foundation) — 設計

- 日付: 2026-05-22
- 対象: codex-gateway-mcp-server
- 位置づけ: 品質向上の3 sub-project (SP1 基盤 / SP2 堅牢性 / SP3 機能追加) のうち最初。
- 実装方法: **このゲートウェイ自身を使う (dogfooding)**。driver から `codex_implement` を呼び、`PROJECT_ROOT` = 本 repo、feature ブランチ `feature/quality-foundation` 上で実行。

## 目的

lint / format / CI の機械的な品質ゲートを整備し、以降の変更 (SP2/SP3) を自動で検証できる土台を作る。現状 lint/format 設定は皆無で、品質は手動レビュー頼み。

## スコープ (in)

1. **ESLint (flat config)** — `eslint` + `typescript-eslint`。型情報なしの基本ルール + 未使用変数検出。`dist/`・`logs/`・`node_modules/` は除外。
2. **Prettier** — `.prettierrc` + `.prettierignore`。既存コードのスタイル (2スペース, ダブルクォート, セミコロン) に合わせる。
3. **npm scripts** — `lint` / `lint:fix` / `format` / `format:check` を追加。
4. **CI 強化** — `.github/workflows/ci.yml` に `npm run lint` ステップ追加。`actions/checkout@v4`→`@v5`、`actions/setup-node@v4`→`@v5` に更新 (Node20 ランタイム非推奨の解消)。
5. **devDependencies のみ追加** — `eslint`, `typescript-eslint`, `prettier`。`package-lock.json` は `package.json` と同時更新。

## スコープ (out / 後続)

- テストフレームワーク (node --test) と網羅テスト → 別 sub-project (今回の優先軸に未選択のため)。
- ランタイムの堅牢性・エラー処理 → SP2。
- 新ツール・機能 → SP3。
- `tsconfig` の `noUnusedLocals/noUnusedParameters` 変更はしない (ESLint の no-unused-vars と重複し冗長なため、検出は ESLint に一本化)。

## 制約

- **ランタイム挙動を変えない** (src の振る舞いは不変、lint 起因の整形・未使用削除のみ許容)。
- 既存の `build` / `typecheck` / `test`(smoke) が引き続き green。
- 新たな **runtime** 依存は追加しない (devDeps のみ)。
- `.env*` / secret / 保護ブランチ等のゲートのポリシーに従う (dogfood 実行時に自動適用)。

## dogfood 実行単位 (codex_implement)

スコープが `package.json` を含むため `codex_parallel_tasks` ではなく `codex_implement` を使用 (並列は package.json を弾く設計)。1〜2タスクに分割:

- **タスク1**: ESLint + Prettier 設定 + npm scripts + devDeps 追加。
  - `allowed_paths`: `eslint.config.js`, `.prettierrc`, `.prettierignore`, `package.json`, `package-lock.json`
  - `commands_to_run`: `npm install`(devDeps), `npm run lint`, `npm run build`, `npm test`
- **タスク2 (CI)**: ワークフロー更新 (lint ステップ + actions @v5)。
  - `allowed_paths`: `.github/workflows/ci.yml`
  - `commands_to_run`: (なし。CI は push 後に self-hosted で検証)

## 検証 (完了条件)

- `npm run lint` が pass (違反0、または合意した範囲の warning のみ)。
- `npm run format:check` が pass。
- `npm run build` / `npm run typecheck` / `npm test` が引き続き pass。
- push 後、self-hosted CI が green (lint ステップ含む、Node20 警告が消える)。
- 私 (Claude Code) が `git diff` をレビューし、ランタイム挙動の変更が無いことを確認。

## リスクと対処

- ESLint がデフォルトで多数の既存違反を出す → ルールは現コードに概ね適合する保守的セットにし、必要なら一部を warning に。codex には「ルール緩和ではなくコード修正で対応、ただしランタイム挙動は変えない」と制約。
- `npm install` は要承認コマンド (ASK) → ゲートは warning を出すが実行可。devDeps 追加は意図どおり。
