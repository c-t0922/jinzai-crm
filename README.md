# 人材事業専用CRM（仮称：IEGAO Talent CRM）

住宅事業の顧客のうち **人材事業への利用許諾が確認できた方だけ** を対象に、
架電 → アポイント → 面談の引き継ぎ → KPI 分析までを 1 つの画面群で行う営業基盤です。

- 開発ルール：[CLAUDE.md](CLAUDE.md)
- 設計書：[docs/](docs/README.md)（要件・構成・画面遷移・業務フロー・ER・権限・API・タスク・テスト計画・未確定事項）
- 現在のフェーズ：**Phase 1（CRM 基盤・架空データのみ）**。外部サービス（Twilio・kintone・LP）には接続しません。

## Phase 1 でできること

| 機能 | 画面 |
|---|---|
| ログイン・MFA（管理者/PM）・自動ログアウト・ログイン履歴 | `/login` `/mfa` |
| 架電センター（3 カラム・ショートカット・モック発信・結果登録・下書き自動保存・オフライン再送） | `/call-center` |
| 顧客一覧（25 万件をサーバー検索）・詳細タイムライン・一括担当変更・CSV 出力（権限者のみ） | `/contacts` |
| 架電リスト（AND/OR 条件ビルダー・除外内訳プレビュー・均等割当・一時停止） | `/call-lists` |
| アポイント・引き継ぎ・カレンダー・タスク／通知 | `/appointments` `/calendar` `/tasks` |
| ダッシュボード・営業分析（担当者別・リスト別・時間帯別・流入経路別） | `/dashboard` `/analytics/*` |
| 管理（ユーザー・チーム・KPI 目標・トークスクリプト・架電ルール・利用許諾／架電禁止・操作ログ） | `/admin/*` |

権限は「画面」「サーバー処理」「データベース（RLS）」の 3 層でチェックしています。

## ローカルでの起動

前提：Node.js 22、pnpm、Docker。

```bash
pnpm install
cp .env.example .env.local        # 値は `pnpm db:start` の出力（ローカル用の鍵）を記入
pnpm db:start                     # ローカル Supabase
pnpm db:reset                     # マイグレーション＋架空データ 25 万件（少量なら pnpm seed --contacts=20000）
MFA_ENFORCE=false pnpm dev -p 3000
```

http://127.0.0.1:3000 を開き、架空ユーザー（`admin@example.test` / `pm@example.test` / `tl1@example.test` / `caller01@example.test` / `ca1@example.test` / `exec@example.test` など）でログインします。
パスワードは `SEED_USER_PASSWORD`（未設定時は `supabase/seed/generate.ts` の既定値）です。

夜間・日曜は架電時間帯の制限で発信できません。ローカルで試すときは管理画面「架電ルール設定」で「時間外の発信をブロック」を外してください（本番では必ず有効）。

## テスト

```bash
pnpm test            # 単体（KPI 率・電話番号・権限・入力チェック・CSV など）
pnpm db:test         # RLS・権限（pgTAP）
pnpm test:e2e        # 業務シナリオ S1〜S10 と異常系（ブラウザを用意済みの環境では PW_CHROMIUM_PATH を指定）
pnpm lint && pnpm typecheck
```

業務シナリオと合格条件は [docs/12_test_plan.md](docs/12_test_plan.md) を参照してください。

## 個人情報の扱い

開発・テストは架空データのみです（電話番号は `+81900…` の架空帯、メールは `example.test`）。
本番の個人情報・API キーをリポジトリ・ログ・AI への入力に含めないでください。
