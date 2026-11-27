# 08. ディレクトリ構成

```text
jinzai-crm/
├── CLAUDE.md                     # 開発ルール・禁止事項
├── README.md                     # セットアップ手順
├── .env.example                  # 環境変数のキー名のみ（値は入れない）
├── docs/                         # 設計書（本ディレクトリ）
├── supabase/
│   ├── config.toml
│   ├── migrations/               # スキーマ・RLS・インデックス（連番SQL）
│   ├── seed/                     # 架空データ生成スクリプト（faker, 件数指定可）
│   │   ├── generate.ts           # 例: pnpm seed --contacts=250000
│   │   └── masters.sql           # 架電結果・ステータス等のマスタ初期値
│   └── tests/                    # pgTAP（RLS・制約テスト）
├── src/
│   ├── app/                      # Next.js App Router
│   │   ├── (auth)/login/
│   │   ├── (app)/                # ログイン後レイアウト（サイドバー）
│   │   │   ├── dashboard/
│   │   │   ├── call-center/
│   │   │   ├── contacts/         # 一覧 / [id] 詳細
│   │   │   ├── call-lists/       # 一覧 / new / [id]
│   │   │   ├── appointments/
│   │   │   ├── calendar/
│   │   │   ├── tasks/
│   │   │   ├── candidates/       # Phase 3
│   │   │   ├── interviews/       # キャリア面談 Phase 3
│   │   │   ├── jobs/             # Phase 3
│   │   │   ├── companies/        # Phase 3
│   │   │   ├── applications/     # 選考進捗 Phase 3
│   │   │   ├── placements/       # 成約・売上 Phase 3
│   │   │   ├── analytics/        # sales / members / lists / hours / sources
│   │   │   └── admin/            # users / teams / goals / kintone / lp / cti /
│   │   │                         # scripts / call-rules / consents / audit-logs
│   │   └── api/
│   │       ├── v1/               # 内部API（Route Handlers）
│   │       └── webhooks/         # cti / lp （署名検証）
│   ├── components/
│   │   ├── ui/                   # shadcn/ui
│   │   ├── layout/               # Sidebar, Header, PageShell
│   │   ├── data-table/           # サーバーページネーション対応テーブル
│   │   ├── charts/               # Recharts ラッパー（統一カラー）
│   │   ├── status/               # ステータスバッジ（色定義を一元化）
│   │   └── states/               # Loading / Empty / Error
│   ├── features/                 # 画面単位のクライアントロジック
│   │   ├── call-center/          # 3カラム、ショートカット、下書き自動保存
│   │   ├── call-lists/           # 条件ビルダー
│   │   └── dashboard/
│   ├── server/
│   │   ├── auth/                 # セッション・ロール取得・権限判定 (can())
│   │   ├── db/                   # Supabaseクライアント（user/service）
│   │   ├── domain/               # ビジネスロジック（UI非依存・テスト対象）
│   │   │   ├── calls/            # 発信前チェック、結果→自動アクション
│   │   │   ├── assignment/       # 優先順位・均等割当・ロック
│   │   │   ├── consent/          # 利用許諾・架電禁止判定
│   │   │   ├── kpi/              # KPI計算式（単一の定義元）
│   │   │   └── dedupe/           # 正規化・重複候補判定
│   │   ├── integrations/
│   │   │   ├── cti/              # CtiProvider / mock / twilio
│   │   │   ├── kintone/          # KintoneClient / mock / mapper
│   │   │   ├── lp/
│   │   │   └── notify/
│   │   ├── jobs/                 # 同期・集計・リマインダーのジョブ定義
│   │   └── audit/                # 操作ログ記録
│   ├── lib/                      # 汎用（日付JST, 電話番号正規化, zod schemas）
│   ├── styles/tokens.css         # カラー・余白トークン
│   └── middleware.ts             # 認証・自動ログアウト
├── tests/
│   ├── unit/                     # Vitest（domain中心）
│   ├── e2e/                      # Playwright（業務シナリオ10本）
│   └── load/                     # k6 負荷試験スクリプト
└── .github/workflows/ci.yml      # lint / typecheck / test / pgTAP / secret scan
```

**ルール**
- `server/` 以下はクライアントから import 禁止（`server-only` パッケージで強制）。
- KPI の計算式は `server/domain/kpi/` にのみ書く（ダッシュボード・分析・CSVで同じ定義を使う）。
- 外部サービスは `integrations/<service>/index.ts` でインターフェースを公開し、環境変数 `*_MODE=mock|live` で切替。
