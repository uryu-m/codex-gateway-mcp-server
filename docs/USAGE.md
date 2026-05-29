# Usage

各ツールの入出力スキーマと、Claude Code 側からの典型的な呼び出し方をまとめます。

---

## 共通の戻り値

すべての実装系ツール (`codex_implement` / `codex_review_fix`) は同じ形のレスポンスを返します。

```typescript
{
  status: "success" | "failed" | "rejected";
  changed_files: string[];      // git が認識した変更ファイル(未追跡含む)
  diff_stat: string;            // git diff --stat の出力
  summary: string;              // Codex の "## 変更概要" セクション or stdout末尾
  commands_result: Array<{
    command: string;
    status: "passed" | "failed" | "skipped";
    exitCode: number | null;
    durationMs: number;
    stdout: string;
    stderr: string;
    output_summary: string;
  }>;
  warnings: string[];           // dirty tree / ask コマンド等
  violations: Array<{           // path guard 違反の詳細
    path: string;
    reason: "outside_allowed_paths" | "matches_forbidden_path"
          | "always_forbidden_secret" | "lockfile_without_package_json"
          | "branch_protected";
    detail: string;
  }>;
  next_action: string;          // Claude Code が次に何をすべきか
  log_id: string;               // 監査ログ突合用
}
```

`status` の意味:

- **`success`**: path guard OK + 全コマンド成功
- **`failed`**: path guard OK だが lint/typecheck/test のいずれかが失敗 → 修正検討
- **`rejected`**: path guard 違反 or 入力不正 → Codex の出力は信用すべきでない

---

## `codex_implement`

メインツール。Claude Code が分解した1タスクを Codex に投げる。

### 入力

| フィールド | 型 | 必須 | 説明 |
|---|---|---|---|
| `task_title` | string (3-200) | ✅ | ログ用のタスク名 |
| `objective` | string (10-4000) | ✅ | Codex に何を実装してほしいかの具体的説明 |
| `allowed_paths` | string[] (≥1) | ✅ | 変更を許可するパス。ディレクトリには末尾 `/` 推奨 |
| `forbidden_paths` | string[] | | allowed 配下でも禁止するパス |
| `commands_to_run` | string[] | | Codex 後に実行するコマンド (lint/test 等) |
| `constraints` | string[] | | 自由形式の追加制約 (Codex のプロンプトに転記される) |
| `model` | string | | Codex モデル (例: `gpt-5.5`)。未指定時は `CODEX_MODEL`、さらに未設定なら Codex CLI の既定 |
| `sandbox` | enum | | `read-only` / `workspace-write` / `danger-full-access` |
| `approval` | enum | | `never` / `on-request` / `on-failure` / `untrusted` |

### Claude Code からの呼び出し例

```
codex_implement で以下を実装してください:

task_title: "店舗編集フォームに必須バリデーションを追加"
objective: |
  Owner SPA の店舗編集フォーム (EditStoreForm.tsx) に、店舗名・住所・電話番号の必須チェックを追加する。
  未入力時は入力欄の下に赤字でエラーメッセージを表示する。
  既存の useStoreForm フックの返り値に errors: Record<string, string> を追加して
  コンポーネント側で表示する。
allowed_paths:
  - src/features/store/EditStoreForm.tsx
  - src/features/store/useStoreForm.ts
forbidden_paths:
  - prisma/
  - migrations/
  - .env
commands_to_run:
  - npm run lint
  - npm run typecheck
  - npm test -- src/features/store
constraints:
  - API仕様は変更しない
  - 新しい依存パッケージを追加しない
  - エラーメッセージのトーンは既存の他フォームに合わせる
```

### 想定レスポンス (成功時)

```json
{
  "status": "success",
  "changed_files": [
    "src/features/store/EditStoreForm.tsx",
    "src/features/store/useStoreForm.ts"
  ],
  "diff_stat": " 2 files changed, 42 insertions(+), 8 deletions(-)",
  "summary": "店舗編集フォームに必須項目チェックとエラー表示を追加しました。useStoreForm の戻り値に errors を追加し、コンポーネント側で表示しています。",
  "commands_result": [
    { "command": "npm run lint", "status": "passed", "output_summary": "OK", ... },
    { "command": "npm run typecheck", "status": "passed", ... },
    { "command": "npm test -- src/features/store", "status": "passed", ... }
  ],
  "warnings": [],
  "violations": [],
  "next_action": "Claude Code で git diff を読み、問題なければ commit してください。",
  "log_id": "a1b2c3d4"
}
```

### 想定レスポンス (拒否時)

```json
{
  "status": "rejected",
  "changed_files": [
    "src/features/store/EditStoreForm.tsx",
    "prisma/schema.prisma"
  ],
  "violations": [
    {
      "path": "prisma/schema.prisma",
      "reason": "matches_forbidden_path",
      "detail": "forbidden_paths に該当: prisma"
    }
  ],
  "next_action": "path guard 違反です。Codexが対象外を変更しています。git checkout で破棄するか、allowed_paths を見直してください。",
  ...
}
```

---

## `codex_review_fix`

Claude Code のレビュー指摘だけを Codex に直させる。新規設計禁止。

### 入力

| フィールド | 型 | 必須 | 説明 |
|---|---|---|---|
| `review_comments` | string[] (≥1) | ✅ | レビュー指摘の箇条書き |
| `allowed_paths` | string[] (≥1) | ✅ | 変更を許可するパス(レビュー対象ファイルだけに絞る推奨) |
| `commands_to_run` | string[] | | |
| `model` / `sandbox` / `approval` | | | `codex_implement` と同じ |

### 呼び出し例

```
codex_review_fix を呼んでください:

review_comments:
  - "エラーメッセージ「店舗名を入力しろ」は強いので「店舗名を入力してください」に変更"
  - "未入力判定は trim() 込みで判定 (全角スペースのみのケースも未入力扱い)"
  - "useStoreForm の errors 型を Record<string, string> から Partial<Record<keyof StoreInput, string>> に厳密化"

allowed_paths:
  - src/features/store/EditStoreForm.tsx
  - src/features/store/useStoreForm.ts

commands_to_run:
  - npm run lint
  - npm run typecheck
```

戻り値は `codex_implement` と同形式。

---

## `codex_inspect_diff`

差分のレビュー材料を構造化して返す。Codex は呼ばない。

### 入力

| フィールド | 型 | 既定 | 説明 |
|---|---|---|---|
| `base_ref` | string | `"main"` | 比較元 |
| `target_ref` | string | `"HEAD"` | 比較先 |

### 出力

```typescript
{
  changed_files: string[];
  diff_stat: string;
  risk_points: string[];      // 高リスクパス検出結果
  review_checklist: string[]; // 既定のレビュー観点
}
```

### 使いどころ

- `codex_implement` 直後、Claude Code が `git diff` を読む前に「概況」を掴むため
- 別ブランチからマージ前に「何が変わるか」を見るため
- レビュー前に高リスク領域(migration, API層, package.json等)が触られていないか確認

### 呼び出し例

```
codex_inspect_diff を呼んでください。base_ref は main, target_ref は HEAD で。
```

---

## `codex_parallel_tasks`

独立したタスクを worktree で並列実行。互いに干渉しないタスク向け。

### 入力

```typescript
{
  tasks: Array<{
    task_title: string;
    branch_name: string;     // 英数 . _ - / のみ
    worktree_path: string;   // 相対なら PROJECT_ROOT 基準
    objective: string;
    allowed_paths: string[];
    forbidden_paths?: string[];
    commands_to_run?: string[];
    constraints?: string[];
  }>;
}
```

`tasks` は **2-5件**。1件なら `codex_implement` を使ってください。6件以上は1バッチに収めず分割を推奨します。

### 事前検査

以下に該当するとバッチ全体が `rejected`:

- いずれかのタスクの `allowed_paths` に `migrations/` / `prisma/` / `package.json` / `pyproject.toml` / `types/` / `api/` が含まれる
- タスク間で `allowed_paths` が重複している(同じパスを2件以上が触る)

### 呼び出し例

```
codex_parallel_tasks で以下を並列実行してください:

tasks:
  - task_title: "店舗一覧のページネーション実装"
    branch_name: feature/store-pagination
    worktree_path: ../worktrees/store-pagination
    objective: 店舗一覧 (src/features/store/StoreList.tsx) に 20件単位のページネーションを追加
    allowed_paths:
      - src/features/store/StoreList.tsx
      - src/features/store/useStoreList.ts
    commands_to_run:
      - npm run lint
      - npm run typecheck

  - task_title: "ユーザー設定画面のテスト追加"
    branch_name: feature/user-settings-test
    worktree_path: ../worktrees/user-settings-test
    objective: src/features/user/UserSettings.tsx の単体テストを追加
    allowed_paths:
      - src/features/user/__tests__/
    commands_to_run:
      - npm test -- src/features/user
```

### 出力

```typescript
{
  status: "success" | "partial" | "failed" | "rejected";
  results: Array<{
    task_title: string;
    branch_name: string;
    worktree_path: string;     // 絶対パスで返る
    result: /* codex_implement と同形式 */;
  }>;
  reject_reason?: string;
  next_action: string;
}
```

実行後、各 worktree は **残ったまま** になります。レビュー後に削除してください。手動なら:

```bash
git worktree list
git worktree remove ../worktrees/store-pagination
```

ゲート経由で削除するなら `codex_cleanup_worktrees` を使います(下記)。

---

## `codex_cleanup_worktrees`

`codex_parallel_tasks` が残した worktree を一覧・削除する。Codex は呼ばない純粋な git 操作。

### 入力

| フィールド | 型 | 必須 | 説明 |
|---|---|---|---|
| `worktree_paths` | string[] | | 削除する worktree のパス。相対なら `PROJECT_ROOT` 基準。**省略/空なら一覧のみ返し、削除はしない**。 |

### 安全制約

- **メイン作業ツリー (`PROJECT_ROOT` 自身) は削除しない**。
- `git worktree list` に登録された worktree のみ削除可能(任意ディレクトリの削除は不可)。
- 削除は `git worktree remove --force` 相当のみ。生の `rm` はしない。
- パスは正規化して比較する(例: macOS の `/tmp` → `/private/tmp` でも一致)。

### 出力

```typescript
{
  worktrees: Array<{ path: string; branch: string | null; isMain: boolean }>; // 現在の一覧
  removed: string[];                              // 削除できた worktree
  errors: Array<{ path: string; reason: string }>; // 削除できなかったものと理由
  next_action: string;
}
```

### 呼び出し例

```
# まず一覧を確認
codex_cleanup_worktrees を呼んでください (worktree_paths は指定しない)。

# レビュー後、不要な worktree を削除
codex_cleanup_worktrees を呼んでください:
worktree_paths:
  - ../worktrees/store-pagination
  - ../worktrees/user-settings-test
```

---

## CLAUDE.md / .cursorrules への記載例

このゲートを使い続けるなら、リポジトリのルール文書にも以下を入れておくと、Claude Code が自動的に分業を守ります。

```markdown
## Workflow Rules (codex-gateway 利用時)

- 要件整理・設計・DB設計・UX判断は Claude Code が直接行う
- コード実装(新規追加・修正)は必ず codex_implement 経由で Codex に委譲する
  - 例外: 5行未満の typo 修正・コメント追加程度は Claude Code が直接編集してよい
- レビューで挙がった修正は codex_review_fix を使う(codex_implement は使わない)
- Codex 完了後は必ず Claude Code が以下を行う:
  1. codex_inspect_diff で risk_points を確認
  2. git diff を直接読んでレビュー
  3. 必要なら codex_review_fix で再修正を依頼
  4. 問題なければ commit
- 並列タスクは codex_parallel_tasks。共通領域を触るタスクは並列禁止
- 最終 merge 判断は人間
```

---

## トラブルシューティング

### Codex が「prompt が空」と言って失敗する

stdin 経由でプロンプトを渡しています。`codex --version` が古いと stdin モードに対応していない可能性があります。最新版にアップデートしてください。

### `path guard violation` ばかり出る

Codex に「`src/features/store/Form.tsx` だけ修正して」と頼んでも、import 整理で隣のファイルを触ることがあります。対策:

- `allowed_paths` に隣接ファイルも含める
- `constraints` に「import の自動整理は実施しない」と明記
- それでも触られるなら、Codex のモデルを変える (`model` 引数または `CODEX_MODEL` で `gpt-5.5` などを明示)

### Codex がタイムアウトする

既定は10分。大きな実装は分解するか、`CODEX_TIMEOUT_SECONDS` で延長:

```bash
CODEX_TIMEOUT_SECONDS=1800  # 30分
```

ただし、10分を超える単一タスクは「分解が足りていない」サインなので、まずは objective を見直してください。

### 監査ログが大きくなりすぎる

```bash
find logs/ -mtime +14 -type f -delete   # 14日以上前のログを削除
```

を launchd / cron で回すのが楽です。
