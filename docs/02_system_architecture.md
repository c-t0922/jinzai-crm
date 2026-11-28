# 02. システム全体構成図

## 1. 全体構成

```mermaid
flowchart LR
  subgraph Users[利用者]
    PC[PCブラウザ<br/>架電担当・PM・管理者]
    SP[スマートフォン<br/>閲覧中心]
  end

  subgraph Vercel[Vercel（Next.js App Router）]
    UI[画面<br/>React Server Components<br/>+ Client Components]
    API[Route Handlers / Server Actions<br/>認可・バリデーション（Zod）]
    WH[Webhook受信<br/>/api/webhooks/*<br/>署名検証・冪等化]
    CRON[Vercel Cron<br/>同期起動・集計更新・リマインダー]
  end

  subgraph Supabase[Supabase]
    AUTH[Supabase Auth<br/>MFA]
    DB[（PostgreSQL<br/>RLS / パーティション<br/>マテリアライズドビュー）]
    RT[Realtime<br/>通話ステータス・ロック]
    STG[Storage<br/>録音ファイル（非公開バケット）]
    Q[ジョブキュー<br/>pgmq or jobsテーブル]
  end

  subgraph Worker[バックグラウンドワーカー]
    SYNC[kintone同期ワーカー<br/>Supabase Edge Functions<br/>or 外部ワーカー【要確認】]
  end

  subgraph External[外部サービス]
    KT[kintone REST API<br/>読み取り専用]
    CTI[クラウドCTI<br/>Twilio等]
    LP[人材LP<br/>Phase 4]
    NTF[通知<br/>メール/LINE/Slack]
    AI[AI 文字起こし・要約<br/>Phase 4]
  end

  PC --> UI
  SP --> UI
  UI --> API
  API --> AUTH
  API --> DB
  UI <-. 購読 .-> RT
  RT --- DB
  API --> STG
  CRON --> Q
  Q --> SYNC
  SYNC --> KT
  SYNC --> DB
  PC <-. WebRTC音声 .-> CTI
  API -- 発信要求/トークン発行 --> CTI
  CTI -- ステータスWebhook --> WH
  LP -- 反響Webhook --> WH
  WH --> DB
  API --> NTF
  API -.-> AI
```

## 2. 主要な設計判断

| テーマ | 方針 | 理由 |
|---|---|---|
| レンダリング | 一覧・ダッシュボードは Server Components でサーバー取得。架電センターは Client Component 中心 | 大量データをクライアントに持たない／架電はリアルタイム操作 |
| 認可 | ①ミドルウェアでセッション確認 ②API でロール/スコープ判定 ③RLS | 指示書14「API・DB側でもチェック」 |
| DB アクセス | ユーザー操作はユーザーJWTで（RLS適用）。同期・集計ジョブのみ service_role | RLS を迂回しない |
| CTI 抽象化 | `CtiProvider` インターフェース（`initDevice / dial / hangup / mute / onStatus / fetchRecording`）。`MockCtiProvider` と `TwilioCtiProvider` | 特定サービスに依存しない（指示書03,07） |
| リアルタイム | Supabase Realtime で「顧客ロック」「通話ステータス」「新規反響通知」を配信 | 同時架電防止・即時反映 |
| 集計 | 日次×担当者×リストの集計テーブル（`kpi_daily_*`）を 5分毎に増分更新＋当日分はライブ集計 | ダッシュボード 2 秒以内 |
| 大量データ | `call_logs`・`audit_logs` は月次レンジパーティション。一覧はキーセットページネーション | 数百万件以上を想定 |
| 検索 | 電話番号は正規化列＋B-tree、氏名は `pg_trgm` GIN、メールは正規化列＋B-tree | 25万〜100万件で部分一致検索 |
| ジョブ | `jobs` テーブル（または pgmq）＋ワーカー。リトライ・指数バックオフ・デッドレター | 同期失敗・API制限への対応 |
| 秘密情報 | Vercel 環境変数（暗号化）。管理画面で入力するトークンは Supabase Vault に保存し、画面には末尾4桁のみ表示 | 指示書08,15 |

## 3. 架電の処理シーケンス

```mermaid
sequenceDiagram
  autonumber
  actor U as 架電担当者
  participant UI as 架電センター
  participant API as API
  participant DB as DB
  participant CTI as CtiProvider(mock/twilio)

  UI->>API: GET /call-center/next （次の顧客）
  API->>DB: 優先順位でキュー取得＋ロック取得(SKIP LOCKED)
  DB-->>API: 顧客 + lock_id
  API-->>UI: 顧客情報（マスキング済）
  U->>UI: 発信ボタン / Space
  UI->>API: POST /calls （idempotency_key, contact_id, lock_id）
  API->>DB: 許諾・架電禁止・ロック・時間帯を再確認
  alt NG
    API-->>UI: 409/422 理由表示（発信しない）
  else OK
    API->>DB: call_logs 作成(status=initiating)
    API->>CTI: dial(電話番号はサーバー側で解決)
    CTI-->>API: 通話ステータス(ringing/in-progress/completed) Webhook
    API->>DB: call_logs 更新 → Realtime配信
  end
  U->>UI: 結果をワンクリック登録・メモ
  UI->>API: POST /calls/{id}/result （下書きはlocalStorage＋/drafts）
  API->>DB: 結果保存＋自動アクション(再架電/アポ/架電禁止) をトランザクションで
  API-->>UI: 次の顧客（自動表示・自動発信はしない）
```

## 4. 環境

| 環境 | 用途 | データ | CTI | kintone |
|---|---|---|---|---|
| local | 開発 | 架空データ（seed 25万件生成スクリプト） | mock | mock（サンプルJSON） |
| preview（Vercel Preview） | PR 確認 | 架空データ（小） | mock | mock |
| staging | 受入・負荷試験 | 架空データ 25万〜100万件 | Twilio テスト用認証情報【Phase 2】 | 検証用 kintone アプリ【要確認】 |
| production | 本番 | 許諾済み実データ | 本番 | 本番（読み取り専用） |

## 5. セキュリティ構成（指示書15対応）

| 要件 | 実現方法 |
|---|---|
| ログイン認証 / MFA | Supabase Auth。管理者・PM は TOTP 必須（未設定時は設定画面へ強制遷移） |
| RLS | 全テーブル有効。ロール・チーム・担当割当に基づくポリシー |
| 通信暗号化 | HTTPS（Vercel）、DB接続 TLS |
| マスキング | 表示用ビュー／API レスポンスでロール別にマスク。電話番号は発信時にサーバー側で解決し、クライアントに全桁を渡さない設定を可能に【仮】 |
| CSV出力制限 | `export` 権限保持者のみ。件数上限・承認フロー【仮】、`export_logs` に記録 |
| 操作ログ | 重要操作は `audit_logs` にトリガーとアプリ層の両方で記録 |
| 自動ログアウト | 無操作 30 分【仮】 |
| バックアップ・復元 | Supabase PITR、月1回の復元リハーサル |
| 保管期限・削除・訂正 | `retention_policies` 設定＋削除ジョブ。削除時は架電禁止情報（ハッシュ）のみ残す |
| Webhook | 署名検証（Twilio署名 / LP用 HMAC）、`webhook_events` で重複排除 |
