# 10. 外部サービス連携に必要な情報一覧

> 実際の値（トークン・パスワード等）はこのファイル・チャット・GitHub に書かないこと。
> 本番値は社長または管理者が Vercel 環境変数／管理画面へ直接入力する。

## 1. 一覧

| サービス | 必要な情報・作業 | 用意する人 | 必要時期 |
|---|---|---|---|
| **GitHub** | private リポジトリ（作成可否・名前・Organization） | 社長 | Phase 0 |
| **Vercel** | チーム/アカウント、プラン（Pro推奨）、本番ドメイン（例 `crm.xxxx.co.jp`）、DNS 設定権限 | 社長・管理者 | Phase 1 後半 |
| **Supabase** | Organization、プロジェクト（dev/staging/prod の3つ推奨）、リージョン（東京 `ap-northeast-1`）、プラン（Pro 以上：PITR・日次バックアップ） | 社長・管理者 | Phase 1 開始時（dev）|
| **kintone** | サブドメイン、対象アプリID、**閲覧のみ権限の APIトークン**（レコード閲覧のみ付与）、フィールド一覧（フィールドコード・型）、利用許諾を示すフィールドの有無と値の意味、同時接続/日次APIリクエスト上限の確認、検証用アプリ（コピー）を用意できるか | kintone 管理者 | Phase 2 開始前 |
| **CTI（Twilio 等）** | サービス選定、アカウントSID、API Key/Secret、TwiML App SID、発信用電話番号（050/03等）の取得と本人確認書類、録音告知文言、通話料の予算 | 社長・管理者 | Phase 2 開始前 |
| **メール送信** | 送信サービス（Resend / SendGrid / Amazon SES 等）、送信元ドメイン、SPF/DKIM 設定 | 管理者 | Phase 2（通知） |
| **人材LP** | LP の制作体制、送信方式（Webhook）、署名用共有シークレット、送信項目、利用規約・プライバシーポリシーの版 | LP 担当 | Phase 4 |
| **LINE** | LINE公式アカウント、Messaging API チャネル | 管理者 | Phase 4 |
| **Google カレンダー** | Google Workspace 利用有無、OAuth クライアント | 管理者 | 将来 |
| **GA4 / 広告** | GA4 プロパティ、広告アカウント（Google/Meta等）の費用データ取得方法 | マーケ担当 | Phase 4 |
| **AI（文字起こし・要約）** | 利用サービス、データ保存しない契約条件（ゼロリテンション）、社内規程の確認 | 社長・法務 | Phase 4 |
| **エラー監視** | Sentry 等（個人情報送信オフ設定） | 管理者 | Phase 1 後半 |

## 2. 環境変数（キー名のみ・`.env.example` に記載）

```dotenv
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=          # サーバー/ジョブのみ
APP_TIMEZONE=Asia/Tokyo

CTI_MODE=mock                       # mock | twilio
TWILIO_ACCOUNT_SID=
TWILIO_API_KEY_SID=
TWILIO_API_KEY_SECRET=
TWILIO_TWIML_APP_SID=
TWILIO_CALLER_ID=

KINTONE_MODE=mock                   # mock | live
KINTONE_BASE_URL=
KINTONE_APP_ID=
KINTONE_API_TOKEN=                  # 閲覧権限のみのトークン

LP_WEBHOOK_SECRET=
MAIL_PROVIDER_API_KEY=
SENTRY_DSN=
```

## 3. kintone 連携で事前に確認したいこと
1. 25万件は 1 アプリか複数アプリか。
2. 「人材事業への利用可否」を判定できる情報（同意フィールド・取得時の規約版・取得経路）があるか。
3. 住宅ローン・借入・資産など **取り込まない項目** のフィールドコード一覧。
4. 業務時間外（例 22:00〜6:00）に同期してよいか。API 上限（1日あたりのリクエスト数）の現状使用量。
