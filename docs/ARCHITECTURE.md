# Architecture

このドキュメントは codex-gateway-mcp の **設計判断の根拠** をまとめたものです。「なぜそうなっているか」を後から見返すための文書なので、コード読解の補助として使ってください。

---

## 1. なぜ Codex 直結ではなくゲートを挟むのか

Codex CLI には公式の MCP サーバーモード (`codex mcp-server`) があり、Claude Code から直接接続することは可能です。それでも本ゲートを挟む理由:

| 課題 | Codex 直結 | ゲート経由 |
|---|---|---|
| 変更範囲を絞りたい | プロンプトで頼むだけ(守られない可能性) | `allowed_paths` で機械的に拒否 |
| 危険コマンドを止めたい | sandbox/approval 設定に頼る | `policy.ts` で正規表現マッチ拒否 |
| 全実行を記録したい | Codex CLI のログを掘る | 構造化された監査ログが自動で残る |
| 保護ブランチを守りたい | Codex 側で制御できない | git 状態を確認してから拒否 |
| Claude Code のレビューに合わせた応答が欲しい | 自由形式 | `status` / `violations` / `next_action` の固定スキーマ |

ゲートは **Codex を信用しないことを前提に作られています**。Codex は能力は高いが、指示の細部を読み落として対象外ファイルを触ることが現実に起きるため、出力を必ず検証する層が必要、という思想です。

---

## 2. 全体の流れ (`codex_implement` を例に)

```
Claude Code が codex_implement を呼ぶ
        │
        ▼
┌───────────────────────────────────────┐
│ Step 1: git status 確認                │
│  - 保護ブランチなら reject              │
│  - dirty tree なら warning              │
└───────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────┐
│ Step 2: allowed_paths 入力検証         │
│  - 空 / "." / ".." → reject             │
└───────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────┐
│ Step 3: commands_to_run 検査           │
│  - 禁止パターン一致 → reject            │
│  - ask パターン一致 → warning           │
└───────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────┐
│ Step 4: Codex 実行                     │
│  - prompt は stdin 経由 (argv肥大回避) │
│  - sandbox=workspace-write が既定       │
│  - approval=on-request が既定           │
└───────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────┐
│ Step 5: 変更ファイル収集               │
│  - git diff --name-only HEAD            │
│  - + git ls-files --others (未追跡)    │
└───────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────┐
│ Step 6: pathGuard 検証                 │
│  - allowed_paths 内か                   │
│  - forbidden_paths を踏んでないか       │
│  - .env / secret 系ファイルでないか    │
│  - lockfile が単独で変わってないか      │
└───────────────────────────────────────┘
        │
        ├─ violation あり → status=rejected, コマンド未実行
        │
        ▼
┌───────────────────────────────────────┐
│ Step 7: commands_to_run 実行           │
│  - lint / typecheck / test 等を順次実行 │
│  - 各結果を CommandResult として収集   │
└───────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────┐
│ Step 8: 監査ログ書き出し               │
│  - task.json / prompt.txt /             │
│    result.json / diff.patch /           │
│    commands.log                         │
└───────────────────────────────────────┘
        │
        ▼
構造化レスポンスを Claude Code に返却
```

---

## 3. レイヤー構成

```
┌─────────────────────────────────────────────┐
│ src/index.ts                                 │
│   MCP サーバー登録 + ツール定義表示用整形    │
└────────────┬────────────────────────────────┘
             │
┌────────────▼────────────────────────────────┐
│ src/tools/                                   │
│   各ツールの handle 関数 (ステップ実装)      │
│   - codexImplement.ts                        │
│   - codexReviewFix.ts                        │
│   - codexInspectDiff.ts                      │
│   - codexParallelTasks.ts                    │
└────────────┬────────────────────────────────┘
             │
┌────────────▼────────────────────────────────┐
│ src/core/                                    │
│   tools 層が共通利用する純粋ロジック         │
│   - codexExec   : Codex CLI 起動            │
│   - runCommand  : subprocess 全般            │
│   - pathGuard   : 変更ファイル検証          │
│   - git         : git 操作                  │
│   - promptBuilder: Codex 向けプロンプト     │
│   - policy      : セキュリティ定数          │
│   - logger      : 監査ログ書き出し          │
└─────────────────────────────────────────────┘
```

**重要な分離原則**:

- `core/` は MCP のことを知らない (純粋なロジック)
- `tools/` は MCP のことを知らない (handler 関数のみ)
- `index.ts` だけが MCP SDK と話す

これにより、テストは `core/` レベルで完結できる(MCP の mock 不要)し、別の入り口(HTTP API など)を後から足すのも簡単です。

---

## 4. なぜ stdio transport なのか

Claude Code が MCP サーバーを subprocess として起動する場合、stdio が最も安定です。HTTP transport は:

- ポート競合
- 認証 (Bearer Token 等) の管理
- 起動順序の制御

が必要になり、ローカル開発用途では過剰です。`PROJECT_ROOT` 環境変数で複数プロジェクトに使い回せる設計なので、stdio のままで十分回ります。

将来、リモートサーバー上で動かしたい場合(例: チーム全員で同じゲートを共有)は、`StreamableHTTPServerTransport` への切り替えは数行で済むようにツール層は MCP 非依存にしてあります。

---

## 5. プロンプトを stdin で渡す理由

Codex CLI には `codex exec "<prompt>"` のように引数で渡す方法と、`codex exec -` で stdin 経由で渡す方法があります。本ゲートは **常に stdin** を使います。

理由:

- **argv の長さ上限**: Linux では `getconf ARG_MAX` で約 128KB〜2MB。`objective` + `allowed_paths` 列挙 + `constraints` でこれを超えるケースは現実に発生する。
- **シェルクオートの破壊**: バッククォート、`$`、改行が argv 経由だと予期せぬ展開を受ける。
- **デバッグ容易性**: 監査ログの `prompt.txt` と Codex に渡るバイト列が完全一致する。

---

## 6. なぜ未追跡ファイル(`untracked`)も拾うのか

`git diff --name-only HEAD` は新規ファイル(未追跡)を返しません。Codex が新規ファイルを作って、それが `allowed_paths` の外だった場合、これを見逃すと path guard が機能しません。

そのため `git ls-files --others --exclude-standard` を併用して、未追跡ファイルも検証対象に含めます。`.gitignore` で無視されているファイルは含まれない(`--exclude-standard`)ので、`node_modules/` などはノイズになりません。

---

## 7. なぜ worktree は自動削除しないのか

`codex_parallel_tasks` は worktree を作りますが、成功時も**自動削除しません**。

理由:

- 削除してしまうと Claude Code が `git diff` をレビューできなくなる
- ユーザーがレビュー後に各 worktree を見て、cherry-pick / merge / discard を選ぶ運用が想定されている
- 失敗時に worktree が残っていた方が、何が起きたか追跡できる

クリーンアップは利用者が:

```bash
git worktree list
git worktree remove ../worktrees/store-form-ui
```

で行ってください。

---

## 8. エラー応答の方針

ツールは **MCP プロトコルレベルでは絶対に throw しません**。失敗は全て `status: "failed" | "rejected"` を載せた構造化レスポンスとして返します。

理由:

- MCP throw は Claude Code 側で "tool call failed" として丸められ、構造化情報が失われる
- `next_action` フィールドで「次に何をすればいいか」を必ず案内したい
- 監査ログに失敗理由も残したい

ただし `index.ts` の最上位の `main().catch()` だけは process exit します。これは初期化失敗(MCP transport が繋がらない等)で、tool レベルではないため。

---

## 9. 拡張ポイント

| やりたいこと | 触る場所 |
|---|---|
| 新しい禁止コマンドを追加 | `core/policy.ts` の `FORBIDDEN_COMMAND_PATTERNS` |
| 新しい高リスクパスを足す | `core/policy.ts` の `HIGH_RISK_PATH_PATTERNS` |
| Codex CLI のフラグを変える | `core/codexExec.ts` の `runCodexExec` |
| プロンプトの言い回しを変える | `core/promptBuilder.ts` |
| 新ツールを足す | `tools/*.ts` 作成 → `index.ts` で `registerTool` |
| ログのフォーマットを変える | `core/logger.ts` |
| HTTP transport に切り替え | `index.ts` の最後を `StreamableHTTPServerTransport` に |

---

## 10. 既知の制約

- **Codex CLI のバージョン依存**: `--cd`, `--sandbox`, `--ask-for-approval`, `--skip-git-repo-check` フラグの存在を前提にしている。Codex 側で破壊的変更があったら `codexExec.ts` を更新する必要がある。
- **Windows 未検証**: `sh -c` で `commands_to_run` を実行しているため、Windows ネイティブ環境では PowerShell 等への切替が必要(WSL 経由なら問題なし)。
- **同時実行**: 同じプロジェクトに対して複数の `codex_implement` を並行で呼ぶと git 状態の取り合いになります。並列実行は `codex_parallel_tasks` (worktree 分離)を使ってください。
- **ログのサイズ**: 1実行で diff.patch + commands.log が数十MB になることがあります。`LOG_DIR` の容量と定期削除に注意。
