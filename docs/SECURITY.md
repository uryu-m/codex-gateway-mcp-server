# Security

このドキュメントは codex-gateway-mcp が **何を許可し、何を拒否するか** を明文化したものです。コードに直接書かれているルールは `src/core/policy.ts` にまとめてあります。

---

## 脅威モデル

本ゲートが守ろうとしているのは、次のような事故・攻撃です。

| 脅威 | 例 | 対策 |
|---|---|---|
| 範囲逸脱 | 「フォームを直して」と頼んだ Codex が、ついでに別ファイルを触る | `allowed_paths` 検証 |
| 秘密情報の漏洩 | Codex が `.env` を読んでログに含めてしまう | `ALWAYS_FORBIDDEN_PATHS` |
| 破壊的コマンド | プロンプトインジェクション経由で `rm -rf /` が走る | `FORBIDDEN_COMMAND_PATTERNS` |
| 本番への直接 push | Codex が `main` 上で commit/push する | 保護ブランチ拒否 + `git push` 禁止 |
| 暗黙の依存追加 | 「ライブラリを追加して」と言われずに npm install される | `package-lock.json` 単独変更を拒否 |
| 履歴改ざん | `git reset --hard` で意図せぬ巻き戻し | コマンド禁止パターン |

ゲートは**完全な防御ではありません**。Codex CLI 自体の sandbox を切ったり、`.env` を allowed_paths に含めてしまえば突破できます。ゲートは「事故防止」レベルのガードであり、悪意ある人間に対する境界ではないことに注意してください。

---

## 常時禁止 (絶対に許可されないもの)

### ファイルパス

`policy.ts` の `ALWAYS_FORBIDDEN_PATHS`:

- `.env`
- `.env.local`
- `.env.production`
- `.env.development`
- `.env.staging`
- `.env.test`

`allowed_paths` に何を指定しようと、これらに該当する変更は **すべて reject** されます。

### ファイル名パターン (basename)

`SECRET_FILENAME_SUBSTRINGS`:

- `secret` / `secrets` を含む
- `credential` / `credentials` を含む
- `private_key` を含む
- `id_rsa` / `id_ed25519`
- `.pem` / `.pfx` / `.p12` / `.keystore`

basename(パスの最後の要素)に対する **小文字での部分一致**で検査します。`SecretValue.tsx` も `client_secrets.json` も両方ヒットします。

### 保護ブランチ

`PROTECTED_BRANCHES`:

- `main`
- `master`
- `develop`
- `production`
- `release`

これらのブランチ上で `codex_implement` / `codex_review_fix` を実行しようとすると、即 reject されます。Codex 実行前のチェックです。

### コマンドパターン

`FORBIDDEN_COMMAND_PATTERNS` (正規表現):

| パターン | 理由 |
|---|---|
| `\brm\s+-rf\b` | 再帰削除 |
| `\bsudo\b` | 権限昇格 |
| `\bgit\s+push\b` | リモートへの反映を人間に残す |
| `\bgit\s+reset\s+--hard\b` | 履歴破壊 |
| `\bgit\s+clean\s+-fd\b` | 未追跡含む削除 |
| `\bcurl\b` / `\bwget\b` | 任意 URL からのダウンロード |
| `\bnc\b` / `\bnetcat\b` | 任意ホストへの接続 |
| `:(){:\|:&};:` | fork bomb |
| `\bdd\s+if=` | ディスクへの直接書き込み |
| `\bmkfs\b` | ファイルシステム作成 |
| `\b>\s*/dev/sd[a-z]` | ブロックデバイスへのリダイレクト |

`commands_to_run` にこれらが含まれていると Codex 実行前に reject されます。Codex 自身の実行内容(プロンプトでお願いした内容)は別話で、こちらは sandbox に委ねます。

---

## 警告のみ (許可されるが notify される)

`ASK_COMMAND_PATTERNS`:

- `npm install` / `pnpm add` / `yarn add`
- `pip install` / `poetry add`
- `composer require`
- `prisma migrate` / `alembic revision` / `rails generate migration`

これらは正当なケースもあるため、reject はしません。`warnings` 配列に乗せて Claude Code に提示し、人間が判断する想定です。

---

## 構造的ガード (個別ファイルではなく組み合わせで判定)

### lockfile pairing

`LOCKFILE_PAIRS` で定義したペアは、lockfile 単独の変更を拒否します。

| lockfile | 必須の manifest |
|---|---|
| `package-lock.json` | `package.json` |
| `pnpm-lock.yaml` | `package.json` |
| `yarn.lock` | `package.json` |
| `poetry.lock` | `pyproject.toml` |
| `Cargo.lock` | `Cargo.toml` |
| `Gemfile.lock` | `Gemfile` |
| `composer.lock` | `composer.json` |

これは「Codex が裏で勝手に依存を入れた結果 lockfile だけが変わる」状況を捕まえるためです。manifest 単独の変更は許可します(手動でのバージョン bump があるため)。

### `allowed_paths` の入力検証

ユーザー側が無効化しようとしてもブロックされる入力:

- `allowed_paths` が空配列
- `allowed_paths` に `.` / `/` / 空文字を含む(= プロジェクト全体への許可)
- `..` を含む(パストラバーサル)

### プレフィックス衝突

`src/feature` と `src/feature-extra` は**別ディレクトリ**として扱われます。`isUnder("src/feature-extra/x.ts", "src/feature")` は `false` を返します。これは「`src/feature` を allowed にしたら `src/feature-extra` も書ける」という誤解を防ぐためです。

---

## 並列実行時の追加ガード

`codex_parallel_tasks` では、上記に加えて:

- **タスク間で `allowed_paths` が重複していないこと** (同じファイル/ディレクトリを2つのタスクが触る → 拒否)
- **以下を含むタスクは並列禁止**:
  - `migrations/` / `prisma/`
  - `package.json` / `pyproject.toml`
  - `types/` (共通型定義)
  - `api/` (API仕様変更の可能性)

理由は単純で、これらは**他タスクが書いたものを暗黙に依存する可能性が高い**領域だからです。並列で走らせると、片方が書いた型を片方が知らない状態でテストが走り、後段で謎の壊れ方をします。

---

## sandbox / approval の既定

Codex CLI 自体にも sandbox があります。ゲートは以下を既定値として渡します:

| 設定 | 既定 | 意味 |
|---|---|---|
| `--sandbox` | `workspace-write` | プロジェクト外への書き込み禁止 |
| `approval_policy` (`-c` で渡す) | `on-request` | Codex が明示的に求めた時だけユーザーに確認。codex >= 0.130 で `--ask-for-approval` フラグが削除されたため config override 経由で指定 |

`danger-full-access` を使いたい場合は、明示的に `sandbox: "danger-full-access"` を引数で渡す必要があります。`.env` ファイル / `CODEX_SANDBOX` 環境変数からも上書きできますが、推奨しません。

---

## 監査ログの位置づけ

監査ログは「事故が起きた時に何が起きたかわかる」ためにあります。

- **Codex のプロンプト全文**(`prompt.txt`)が残る → "ゲートが指示を歪めた" 疑いを排除できる
- **生成された差分**(`diff.patch`)が残る → reject されても何が出てきたかを後で見れる
- **コマンド出力**(`commands.log`)が残る → flaky テストの調査に使える

これらは**機密を含む可能性**があります。`LOG_DIR` 自体を `.gitignore` し、外部に共有する前に内容を確認してください。

---

## ゲートをすり抜ける構成 (避けるべきパターン)

| やってはいけないこと | なぜダメか |
|---|---|
| `allowed_paths: ["."]` を強行 | プロジェクト全体への書き込みを許可することになる |
| `forbidden_paths` を空にしたまま機密領域に作業 | デフォルトで `.env` 等は守られるが、`secrets/` 等は明示が必要 |
| `CODEX_SANDBOX=danger-full-access` | ホームディレクトリへの書き込みすら許可される |
| `commands_to_run` で `bash my_script.sh` 等を実行 | スクリプト内容まではゲートが検査できない |
| ゲートのプロセスを root で起動 | sandbox を貫通してシステム改変が可能になる |

---

## 報告

セキュリティ上の問題を見つけたら、issue として公開する前に作者へ直接連絡してください。
