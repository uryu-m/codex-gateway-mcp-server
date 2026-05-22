import type { CodexImplementInput, CodexReviewFixInput } from "../types.js";

/**
 * Build the prompt sent to Codex. The shape is intentionally rigid so
 * that downstream agents can rely on the headings being present.
 *
 * Important: this prompt explicitly forbids design changes. Codex
 * MUST NOT decide on architecture — that's Claude Code's job.
 */
export function buildImplementPrompt(input: CodexImplementInput): string {
  const allowed = formatList(input.allowed_paths);
  const forbidden = formatList(input.forbidden_paths ?? []);
  const constraints = formatList(input.constraints ?? []);
  const commands = formatList(input.commands_to_run ?? []);

  return `あなたは実装担当です。設計判断はしないでください。

# 目的
${input.objective}

# 対象範囲 (allowed_paths)
${allowed || "(指定なし)"}

# 禁止範囲 (forbidden_paths)
${forbidden || "(なし)"}

# 制約 (constraints)
${constraints || "(なし)"}

# 絶対禁止
- 対象範囲外のファイルを変更しない
- DB構造を変更しない (migration/schema/prisma 等への変更は禁止)
- API仕様を変更しない (公開エンドポイント・型定義の破壊的変更は禁止)
- UI/UX方針を変更しない (既存のコンポーネント設計に沿う)
- .env / secrets / token / private_key を読まない
- main / master へ push しない
- 依存パッケージを追加しない (package.json / requirements 等への追加は禁止)
- 指示されていないリファクタをしない
- コミットしない (git diff のままで返す)

# 実行内容
1. 指定範囲のみ実装する
2. 完了後、以下のコマンドを実行して結果を確認する: ${commands || "(指定なし)"}
3. 変更したファイルを列挙する
4. 失敗したテスト・lint・typecheck を報告する
5. Claude Codeに判断を仰ぐべき設計上の点があれば「未解決事項」として報告する

# 出力フォーマット
最後に以下のセクションで報告してください:

## 変更概要
(何を実装したか、2〜4行で)

## 変更ファイル
- path/to/file1
- path/to/file2

## 実行コマンド結果
- npm run lint: passed / failed (要点)
- ...

## 未解決事項
(Claudeに判断を委ねる点があれば箇条書き。なければ「なし」と明記)
`;
}

/**
 * Prompt for codex_review_fix. Codex is told NOT to design anything new,
 * only to address the listed review comments inside the allowed paths.
 */
export function buildReviewFixPrompt(input: CodexReviewFixInput): string {
  const allowed = formatList(input.allowed_paths);
  const comments = formatList(input.review_comments);
  const commands = formatList(input.commands_to_run ?? []);

  return `あなたはレビュー修正担当です。新規設計は禁止です。

# レビュー指摘
${comments}

# 対象範囲 (allowed_paths)
${allowed}

# 絶対禁止
- レビュー指摘以外の修正をしない
- allowed_paths 外のファイルを変更しない
- リファクタリング・最適化を「ついでに」入れない
- 依存パッケージを追加しない
- コミットしない

# 実行内容
1. 上記のレビュー指摘のみ対応する
2. 完了後、以下のコマンドを実行する: ${commands || "(指定なし)"}
3. 修正したファイルと、各指摘に対する対応内容を報告する

# 出力フォーマット
## 修正サマリー
- 指摘1への対応: ...
- 指摘2への対応: ...

## 変更ファイル
- ...

## 実行コマンド結果
- ...
`;
}

function formatList(items: string[]): string {
  if (!items || items.length === 0) return "";
  return items.map((s) => `- ${s}`).join("\n");
}
