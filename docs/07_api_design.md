# 07. API設計書

## 1. 共通仕様
- ベースパス：`/api/v1`（画面からの操作は Server Actions も併用。ロジックは `server/domain` を共通利用）
- 認証：Supabase セッション Cookie（ユーザーJWT）。外部向け（LP・CTI Webhook）は署名またはAPIキー。
- 形式：JSON、日時は ISO8601（`+09:00` で返却）、金額は整数円。
- 冪等性：作成系 POST は `Idempotency-Key` ヘッダ必須（架電・結果登録・アポ登録・Webhook）。同一キーは同じ結果を返す。
- ページネーション：キーセット方式 `?limit=50&cursor=<opaque>`。レスポンス `{ data, nextCursor, totalEstimate }`（件数は概算、正確件数は別APIで非同期取得可）。
- エラー：`{ error: { code, message, details } }`

| HTTP | code 例 | 意味 |
|---|---|---|
| 400 | `VALIDATION_ERROR` | 入力不正 |
| 401 | `UNAUTHENTICATED` | 未ログイン・期限切れ |
| 403 | `FORBIDDEN` | 権限なし |
| 404 | `NOT_FOUND` | 存在しない／権限範囲外 |
| 409 | `LOCKED_BY_OTHER` / `ALREADY_RECORDED` / `DUPLICATE_DIAL` | 競合・二重登録 |
| 422 | `NOT_CALLABLE` (`reason`: consent_unknown / suppressed / outside_hours / invalid_phone) | 業務ルール違反 |
| 429 | `RATE_LIMITED` | レート制限 |

## 2. エンドポイント一覧

### 認証・ユーザー
| Method | Path | 説明 | 権限 |
|---|---|---|---|
| GET | `/me` | ログインユーザー・ロール・メニュー権限 | 全員 |
| GET/POST/PATCH | `/admin/users` `/admin/users/{id}` | ユーザー管理・ロール付与・停止 | ADM |
| GET/POST/PATCH | `/teams` `/teams/{id}/members` | チーム管理 | ADM, PM |

### ダッシュボード・KPI
| Method | Path | 説明 |
|---|---|---|
| GET | `/kpi/summary?from&to&userId&teamId&listId&source&compare=prev_day\|prev_week\|prev_month` | KPIカード一式（未計測は `null`） |
| GET | `/kpi/timeseries?metric&granularity=day\|week\|month&...` | 推移グラフ |
| GET | `/kpi/breakdown?metric&dimension=user\|team\|list\|source\|hour\|weekday\|script` | 内訳・ランキング |
| GET | `/kpi/funnel?cohortFrom&cohortTo` | 営業ファネル（コホート方式） |

### 架電センター
| Method | Path | 説明 |
|---|---|---|
| GET | `/call-center/queue?tab=today\|recall\|new\|untouched` | キュー一覧（左カラム）・残件数 |
| POST | `/call-center/next` | 優先順位で次の顧客を取得しロック取得 → `{ contact, lockId, expiresAt }` |
| POST | `/call-center/locks/{lockId}/heartbeat` | ロック延長 |
| DELETE | `/call-center/locks/{lockId}` | ロック解放（スキップ） |
| POST | `/calls` | 発信開始。body `{ contactId, lockId, phoneId, scriptId }`。サーバーで `can_call` 再確認 → CtiProvider.dial |
| POST | `/calls/{id}/hangup` | 終話 |
| POST | `/calls/{id}/mute` | ミュート切替 |
| PUT | `/calls/{id}/result` | 架電結果登録（UNIQUE で二重登録防止）。body `{ resultCode, hearing, memo, nextCallAt, appointment?, handoffTo? }`。自動アクションを同一トランザクションで実行し、`{ actions:[...], next?: contact }` を返却 |
| PUT | `/call-drafts/{contactId}` | 入力途中の自動保存 |
| GET | `/cti/token` | ブラウザ用 CTI アクセストークン発行（mock 時はダミー） |

### 顧客
| Method | Path | 説明 |
|---|---|---|
| GET | `/contacts?q&phone&email&filter=<base64 json>&sort&cols&cursor` | 一覧検索（サーバーサイド） |
| GET | `/contacts/count?filter` | 正確な件数（非同期・キャッシュ） |
| GET | `/contacts/{id}` | 詳細（ロール別マスキング） |
| GET | `/contacts/{id}/timeline?types=call,appointment,consent,...&cursor` | 時系列履歴 |
| PATCH | `/contacts/{id}` | 基本情報更新（監査ログ） |
| POST | `/contacts/bulk` | 一括操作 `{ action: assign\|tag\|addToList, ids \| filter }`（ジョブ化） |
| POST | `/contacts/export` | CSV出力要求 `{ filter, columns, reason }` → ジョブID。完了後に署名付きURL（有効 10 分） |
| GET/POST | `/saved-searches` | 保存済み検索条件 |
| GET/PATCH | `/duplicates` `/duplicates/{id}` | 重複候補の確認・判定（統合は手動） |

### 利用許諾・架電禁止
| Method | Path | 説明 |
|---|---|---|
| GET/POST | `/contacts/{id}/consents` | 許諾履歴の参照・追加（追記のみ） |
| GET/POST | `/suppressions` | 架電禁止の一覧・登録 |
| DELETE | `/suppressions/{id}` | 解除（ADM、理由必須） |

### 架電リスト
| Method | Path | 説明 |
|---|---|---|
| POST | `/call-lists/preview` | 条件の件数プレビュー＋除外内訳 |
| GET/POST/PATCH | `/call-lists` `/call-lists/{id}` | 作成・更新・一時停止・アーカイブ |
| POST | `/call-lists/{id}/assign` | `{ mode: even\|manual, teamId, userIds, weights? }` |
| POST | `/call-lists/{id}/refresh` | 動的リスト再評価 |
| GET | `/call-lists/{id}/stats` | リスト別分析 |
| GET/PUT | `/settings/assignment-priority` | 自動割当の優先順位 |

### アポイント・タスク
| Method | Path | 説明 |
|---|---|---|
| GET/POST/PATCH | `/appointments` `/appointments/{id}` | 登録・日程変更・キャンセル・実施記録 |
| GET | `/appointments/{id}/handoff` | 引き継ぎ情報 |
| GET/POST/PATCH | `/tasks` | タスク |
| GET | `/calendar?from&to&userId` | カレンダー表示用 |

### 人材事業（Phase 3）
`/candidates`, `/interviews`, `/companies`, `/jobs`, `/applications`（`PATCH /applications/{id}/status` で履歴自動記録）, `/placements`, `/revenues`

### 管理者設定
| Method | Path | 説明 |
|---|---|---|
| GET/PUT | `/admin/call-rules` | 架電時間帯・再架電間隔・最大回数・ロックTTL |
| GET/POST/PATCH | `/admin/call-result-masters` | 架電結果マスタ（入力欄・自動アクション） |
| GET/POST/PATCH | `/admin/scripts` | トークスクリプト（版管理） |
| GET/PUT | `/admin/goals` | KPI目標 |
| GET/PUT | `/admin/integrations/{service}` | kintone/CTI/LP 設定（秘密情報は書込のみ・読出は末尾4桁） |
| GET/PUT | `/admin/kintone/mappings` | フィールドマッピング |
| POST | `/admin/kintone/sync` | 手動同期 `{ type: full\|delta, dryRun }` |
| GET | `/admin/kintone/sync-jobs` `/admin/kintone/sync-jobs/{id}/errors` | 同期履歴・エラー・進捗 |
| POST | `/admin/kintone/sync-jobs/{id}/retry` | リトライ |
| GET | `/admin/audit-logs` `/admin/export-logs` `/admin/login-history` | 各種ログ |

### Webhook（外部→CRM）
| Method | Path | 認証 | 説明 |
|---|---|---|---|
| POST | `/api/webhooks/cti/{provider}` | Twilio署名検証 等 | 通話ステータス・録音完了。`webhook_events` で重複排除 |
| POST | `/api/webhooks/lp` | HMAC-SHA256 署名 + タイムスタンプ（5分以内） | LP反響登録（Phase 4）。body は §3 |

## 3. LP反響 受信スキーマ（Phase 4・案）
```json
{
  "eventId": "uuid",
  "submittedAt": "2027-04-01T10:15:00+09:00",
  "lp": { "id": "lp-career-01", "url": "https://..." },
  "person": { "name": "山田 太郎", "phone": "09012345678", "email": "a@example.com", "area": "東京都" },
  "career": { "desiredTiming": "3ヶ月以内", "desiredJob": "営業" },
  "tracking": { "adMedia": "google", "utm": { "source": "", "medium": "", "campaign": "", "term": "", "content": "" } },
  "consent": { "termsVersion": "2027-03", "privacyAgreed": true, "agreedAt": "..." }
}
```
処理：署名検証 → 重複排除 → 正規化・重複候補判定 → contacts/contact_sources/consents 作成 → 優先順位②でキュー投入 → 担当者通知 → `first_response_at` 計測開始。

## 4. CtiProvider インターフェース（内部）
```ts
interface CtiProvider {
  readonly name: 'mock' | 'twilio' | string;
  readonly isDemo: boolean;
  issueClientToken(userId: string): Promise<{ token: string; expiresAt: Date }>;
  dial(input: { callLogId: string; toE164: string; fromNumberId: string }): Promise<{ providerCallId: string }>;
  hangup(providerCallId: string): Promise<void>;
  verifyWebhook(req: Request): Promise<boolean>;
  parseStatusEvent(req: Request): Promise<CallStatusEvent>;
  fetchRecording?(providerCallId: string): Promise<RecordingRef>;
}
```
モックは発信後 1〜4 秒でランダムに ringing → in_progress / no_answer / busy を返し、`is_demo=true` で記録する。
