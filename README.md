# codex-gateway-mcp

`codex-gateway-mcp-server` is an MCP gateway for running Codex CLI safely inside development and open-source maintenance workflows.

Instead of letting Codex modify a repository freely, this project defines a controlled execution boundary around Codex. It is designed to help teams and OSS maintainers delegate implementation tasks to Codex while keeping planning, review, permissions, command policies, and auditability under control.

## Why this exists

AI coding agents are powerful, but using them directly in real repositories introduces risks:

- unintended file changes
- dangerous shell commands
- accidental execution on protected branches
- unclear responsibility between planning, implementation, and review
- lack of audit logs for AI-driven changes

This project provides a gateway layer between MCP clients and Codex CLI so that Codex can be used as an implementation agent within a safer, reviewable workflow.

## Key features

- Allow/deny path controls (`allowed_paths` / `forbidden_paths`)
- Dangerous command blocking (`rm -rf`, `sudo`, `git push`, `curl`, …)
- Protected branch checks (`main` / `master` / `develop` / `production`)
- Lint, typecheck, and test execution
- Git diff inspection for review
- Audit logging of every invocation (inputs, prompt, diff, command output)
- Designed for a split-agent workflow:
  - Claude Code or a human handles planning and review
  - Codex handles scoped implementation tasks

## Intended use case

This project is especially useful for OSS maintainers who want to use Codex to reduce implementation and maintenance workload while preserving control over repository safety, reviewability, and traceability.

## Documentation

- [Architecture](./docs/ARCHITECTURE.md) · [Security model](./docs/SECURITY.md) · [Usage & tool schemas](./docs/USAGE.md)
- [Roadmap](./docs/ROADMAP.md) · [Maintaining (recommended topics, releases)](./docs/MAINTAINING.md) · [Contributing](./CONTRIBUTING.md)
- [OSS maintenance workflow example](./examples/oss-maintenance-workflow.md)

> 🇯🇵 **日本語ドキュメントは以下に続きます。** / _Japanese documentation continues below._

---

> **Claude Code が「設計・レビュー」、Codex が「実装」** を担当する分業ワークフローのための、Codex CLI 向け MCP ゲートウェイ。

Claude Code から Codex CLI を直接呼ぶのではなく、本ゲートウェイを間に挟むことで、

- 変更範囲の強制 (`allowed_paths` / `forbidden_paths`)
- 危険コマンドの遮断 (`rm -rf`, `git push`, `curl` など)
- 保護ブランチ (`main` / `master` 等) での実行禁止
- lint / typecheck / test の自動実行と結果回収
- 全実行の監査ログ保存

を担保します。Codex 直結だと「賢いけど雑」になりがちな部分をゲートが受け持ち、Claude Code を本来の頭脳労働(設計・レビュー)に専念させるのが目的です。

---

## アーキテクチャ

```
Claude Code (計画・レビュー)
  │
  │  MCP (stdio)
  ▼
codex-gateway-mcp ← path guard / command policy / audit log
  │
  │  subprocess
  ▼
Codex CLI (実装のみ)
  │
  ▼
Git worktree / feature branch
```

詳細は [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) を参照。

---

## 提供ツール

| ツール名 | 役割 | 主な用途 |
|---|---|---|
| `codex_implement` | 限定範囲の実装 | 機能追加・バグ修正・テスト生成など、Claude Code が分解した1タスクを Codex に投げる |
| `codex_review_fix` | レビュー指摘の修正 | Claude Code が `git diff` を読んで挙げた指摘だけを Codex に直させる |
| `codex_inspect_diff` | 差分のレビュー整形 | `main..HEAD` 等の差分を `changed_files` / `risk_points` / `review_checklist` で返す |
| `codex_parallel_tasks` | worktree 並列実行 | 互いに独立した複数タスクを並列で走らせる(共通領域は事前検査で拒否) |
| `codex_cleanup_worktrees` | worktree の一覧/削除 | `codex_parallel_tasks` が残した worktree を一覧し、安全に削除する(メイン作業ツリーは保護、登録済み worktree のみ削除) |

各ツールの入出力スキーマは [`docs/USAGE.md`](./docs/USAGE.md) を参照。

---

## インストール

### 前提

- **Node.js 18 以上**
- **OpenAI Codex CLI** がインストール済み・ログイン済みであること
  ```bash
  codex --version
  ```
- 操作対象のリポジトリが **Git 管理下** であること

### セットアップ

```bash
# 1. クローン
git clone <this-repo-url> codex-gateway-mcp
cd codex-gateway-mcp

# 2. ビルド
npm install
npm run build

# 3. (任意) 環境変数
cp .env.example .env
# .env を編集
```

ビルドが成功すると `dist/index.js` が生成されます。

---

## Claude Code への接続

プロジェクトルートの `.mcp.json` または `~/.claude.json` に以下を追加します。

```json
{
  "mcpServers": {
    "codex-gateway": {
      "command": "node",
      "args": ["/absolute/path/to/codex-gateway-mcp/dist/index.js"],
      "env": {
        "PROJECT_ROOT": "/absolute/path/to/your/target-repo",
        "CODEX_SANDBOX": "workspace-write",
        "CODEX_APPROVAL": "on-request",
        "LOG_DIR": "/absolute/path/to/your/target-repo/logs/codex"
      }
    }
  }
}
```

または CLI で:

```bash
claude mcp add codex-gateway -- node /absolute/path/to/codex-gateway-mcp/dist/index.js
```

接続を確認:

```bash
# Claude Code 内で
/mcp
```

`codex-gateway` の下に5つのツールが出れば成功です。

---

## カスタムスラッシュコマンド

本リポジトリには、5つのツールを定型ワークフローで呼ぶための Claude Code スラッシュコマンドを `.claude/commands/` に同梱しています。`codex-gateway` MCP サーバーが接続済みであれば、Claude Code 上でそのまま使えます。

| コマンド | 役割 | 対応ツール |
|---|---|---|
| `/codex` | コマンド一覧と原則を表示 | (なし) |
| `/codex-implement <タスク>` | 限定範囲の実装 | `codex_implement` |
| `/codex-review-fix [指摘]` | レビュー指摘の修正のみ | `codex_review_fix` |
| `/codex-inspect [base] [target]` | 差分のレビュー整形 | `codex_inspect_diff` |
| `/codex-parallel <タスク群>` | worktree で並列実装 | `codex_parallel_tasks` |
| `/codex-cleanup [path...]` | worktree の一覧・安全削除 | `codex_cleanup_worktrees` |

各コマンドは「設計・レビューは Claude Code、実装は Codex」という分業ルール(`allowed_paths` を最小限に絞る、破壊的実行前に確認する、diff を読んでからコミットする等)を内蔵しています。

> **前提**: 本リポジトリ自身を Claude Code で開く場合は、同梱の `.mcp.json` が `codex-gateway` を `dist/index.js` として登録します。利用前に `npm run build` を済ませ、`/mcp` で5ツールが見えることを確認してください。別リポジトリで使う場合は、そのリポジトリ側の `.mcp.json` でサーバー名を `codex-gateway` として登録し、`.claude/commands/` をコピーしてください。

---

## 最小の使い方

Claude Code のチャットで:

```
このIssueを実装計画に分解してください。
設計判断はあなた(Claude Code)が行い、実装のみ codex_implement に渡してください。

Codexに許可する変更範囲:
- src/features/store/
- src/components/forms/

禁止:
- prisma/
- migrations/
- package.json
- .env

実装後:
- npm run lint
- npm run typecheck
- npm test

Codex実行後、git diff を読んでレビューしてください。
```

これで Claude Code が:

1. 計画を立てる
2. `codex_implement` を呼ぶ
3. ゲートが path guard / コマンド検査を通す
4. Codex が実装する
5. 変更ファイルが `allowed_paths` 内に収まるか自動検証
6. `npm run lint` などを実行
7. 結果を構造化レスポンスで Claude Code に返す
8. Claude Code が `git diff` をレビュー

という流れになります。

---

## 重要なポリシー

ゲートが**常に**拒否するもの:

- `.env*` への変更
- ファイル名に `secret` / `private_key` / `.pem` 等を含むファイルへの変更
- `main` / `master` / `develop` / `production` ブランチ上での実行
- `rm -rf`, `sudo`, `git push`, `git reset --hard`, `curl`, `wget` を含むコマンド
- `package-lock.json` のみの変更 (manifestを伴わない依存変更)
- `allowed_paths` を `.` や `/` にする(プロジェクト全体への許可)

警告(警告は出すが実行は許可):

- `npm install`, `pnpm add`, `pip install`, `composer require`, `prisma migrate` などの依存・マイグレーション系コマンド

詳細は [`docs/SECURITY.md`](./docs/SECURITY.md) を参照。

---

## 監査ログ

すべての呼び出しは `${LOG_DIR}` 配下に保存されます:

```
logs/
├─ 20260521T120000Z-a1b2c3d4-task.json     # 入力パラメータ
├─ 20260521T120000Z-a1b2c3d4-prompt.txt    # Codex に送ったプロンプト全文
├─ 20260521T120000Z-a1b2c3d4-result.json   # 最終結果
├─ 20260521T120000Z-a1b2c3d4-diff.patch    # 生成された差分
└─ 20260521T120000Z-a1b2c3d4-commands.log  # lint/test 等の出力
```

ローテーションはユーザー側で(`find logs/ -mtime +30 -delete` などで)行ってください。

---

## ディレクトリ構成

```
codex-gateway-mcp/
├─ .claude/
│  └─ commands/                 # カスタムスラッシュコマンド (/codex-implement 等)
├─ .mcp.json                    # 本リポジトリ用の codex-gateway 登録 (ドッグフード)
├─ src/
│  ├─ index.ts                  # MCP サーバーエントリ
│  ├─ types.ts                  # 共有型
│  ├─ tools/
│  │  ├─ codexImplement.ts
│  │  ├─ codexReviewFix.ts
│  │  ├─ codexInspectDiff.ts
│  │  ├─ codexParallelTasks.ts
│  │  └─ codexCleanupWorktrees.ts
│  └─ core/
│     ├─ codexExec.ts           # Codex CLI 呼び出し
│     ├─ runCommand.ts          # 汎用 subprocess
│     ├─ pathGuard.ts           # allowed/forbidden 検証
│     ├─ git.ts                 # git status / diff / worktree
│     ├─ promptBuilder.ts       # Codex 向けプロンプト生成
│     ├─ policy.ts              # ハードコードされたセキュリティ定数
│     └─ logger.ts              # 監査ログ
├─ tests/
│  └─ smoke-pathGuard.mjs       # path guard のスモークテスト
├─ examples/
│  └─ mcp.json.example          # Claude Code 接続用設定例
├─ docs/
│  ├─ ARCHITECTURE.md
│  ├─ SECURITY.md
│  └─ USAGE.md
├─ logs/                        # 実行時に生成 (.gitkeep のみ)
├─ package.json
├─ tsconfig.json
└─ README.md
```

---

## 開発

```bash
npm run build       # tsc でコンパイル
npm run typecheck   # 型チェックのみ (出力なし)
npm run dev         # tsc --watch
npm start           # dist/index.js を実行 (stdio で待機)
node tests/smoke-pathGuard.mjs   # ガードのスモークテスト
```

MCP プロトコルの疎通確認:

```bash
{
  echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'
  sleep 0.3
  echo '{"jsonrpc":"2.0","method":"notifications/initialized"}'
  sleep 0.1
  echo '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
  sleep 0.3
} | node dist/index.js
```

5つのツール (`codex_implement`, `codex_review_fix`, `codex_inspect_diff`, `codex_parallel_tasks`, `codex_cleanup_worktrees`) が返ってくれば疎通OKです。

---

## ライセンス

MIT
