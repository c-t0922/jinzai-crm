/**
 * 架空データ生成スクリプト（本番データは一切使わない）
 *
 *   pnpm seed                    # 顧客 250,000 件
 *   pnpm seed --contacts=20000   # 件数指定
 *
 * 前提：`supabase start` 済みのローカル環境。接続先は .env.local の値を使う。
 * 生成する氏名・電話番号・メールはすべて架空。電話番号は 090-0xxx-xxxx 帯、メールは example.test ドメイン。
 */
import { Client } from "pg";
import { createClient } from "@supabase/supabase-js";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"];
  }),
);
const CONTACTS = Number(args.contacts ?? 250_000);
const DB_URL = process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
// ローカル開発専用のテスト用パスワード。.env.local の SEED_USER_PASSWORD で上書きできる
const PASSWORD = process.env.SEED_USER_PASSWORD ?? "LocalDev#2026";

if (!SERVICE_KEY) {
  console.error("SUPABASE_SERVICE_ROLE_KEY が未設定です（.env.local を確認）");
  process.exit(1);
}
if (!/127\.0\.0\.1|localhost/.test(DB_URL) || !/127\.0\.0\.1|localhost/.test(SUPABASE_URL)) {
  console.error("安全のため、seed はローカル環境以外では実行できません");
  process.exit(1);
}

type SeedUser = { key: string; name: string; email: string; roles: string[]; team?: string; leader?: boolean };

const USERS: SeedUser[] = [
  { key: "admin", name: "管理 太郎", email: "admin@example.test", roles: ["admin"] },
  { key: "pm", name: "事業 花子", email: "pm@example.test", roles: ["pm"] },
  { key: "exec", name: "経営 一郎", email: "exec@example.test", roles: ["executive"] },
  { key: "tl1", name: "主任 健太", email: "tl1@example.test", roles: ["team_leader", "caller"], team: "t1", leader: true },
  { key: "tl2", name: "主任 美咲", email: "tl2@example.test", roles: ["team_leader", "caller"], team: "t2", leader: true },
  ...Array.from({ length: 10 }, (_, i) => ({
    key: `caller${i + 1}`,
    name: ["佐藤 翔", "鈴木 優", "高橋 蓮", "田中 葵", "伊藤 陽菜", "渡辺 大和", "山本 結衣", "中村 湊", "小林 凛", "加藤 悠真"][i],
    email: `caller${String(i + 1).padStart(2, "0")}@example.test`,
    roles: ["caller"],
    team: i < 5 ? "t1" : "t2",
  })),
  { key: "ca1", name: "相談 由美", email: "ca1@example.test", roles: ["career_advisor"] },
  { key: "ca2", name: "相談 拓也", email: "ca2@example.test", roles: ["career_advisor"] },
  { key: "ca3", name: "相談 彩", email: "ca3@example.test", roles: ["career_advisor"] },
];

async function main() {
  const db = new Client({ connectionString: DB_URL });
  await db.connect();
  const admin = createClient(SUPABASE_URL, SERVICE_KEY!, { auth: { persistSession: false } });
  const t0 = Date.now();
  const log = (m: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);

  log("既存の架空データを削除");
  await db.query(`
    truncate call_results, call_recordings, call_logs, call_drafts, idempotency_keys, handoffs, appointments, tasks,
      notifications, assignments, contact_locks, call_list_members, call_lists, suppression_list, consents,
      contact_sources, contact_phones, duplicate_candidates, contacts, goals, scripts, team_members, user_roles,
      audit_logs, export_logs, login_history, saved_searches, notifications cascade`);
  // 設定テーブル（call_rules 等）を巻き込まないよう、ユーザー・チームは DELETE で消す
  await db.query(`update call_rules set updated_by = null; update integration_settings set updated_by = null`);
  await db.query(`delete from users; delete from teams`);
  const { data: existing } = await admin.auth.admin.listUsers({ perPage: 1000 });
  for (const u of existing?.users ?? []) {
    if (u.email?.endsWith("@example.test")) await admin.auth.admin.deleteUser(u.id);
  }

  // ローカル開発で MFA を省略する場合のみ（本番では常に true）
  await db.query(`update call_rules set value = $1 where key = 'mfa_required'`, [JSON.stringify(process.env.MFA_ENFORCE !== "false")]);
  log("チーム・ユーザー作成");
  const teams = await db.query<{ id: string; name: string }>(
    `insert into teams(name, base_location) values ('第1チーム','東京本社'),('第2チーム','東京本社') returning id, name`,
  );
  const teamId: Record<string, string> = { t1: teams.rows[0].id, t2: teams.rows[1].id };
  const userId: Record<string, string> = {};
  for (const u of USERS) {
    const { data, error } = await admin.auth.admin.createUser({ email: u.email, password: PASSWORD, email_confirm: true });
    if (error) throw error;
    const r = await db.query<{ id: string }>(
      `insert into users(auth_user_id, name, email) values ($1,$2,$3) returning id`,
      [data.user.id, u.name, u.email],
    );
    userId[u.key] = r.rows[0].id;
    for (const role of u.roles) await db.query(`insert into user_roles values ($1,$2)`, [userId[u.key], role]);
    if (u.team) await db.query(`insert into team_members values ($1,$2,$3)`, [teamId[u.team], userId[u.key], !!u.leader]);
  }

  log(`顧客 ${CONTACTS.toLocaleString()} 件を生成`);
  await db.query(`set session_replication_role = replica`); // 大量投入のためトリガーを止め、派生列は直接計算する
  await db.query(`
    with names as (
      select
        array['佐藤','鈴木','高橋','田中','伊藤','渡辺','山本','中村','小林','加藤','吉田','山田','佐々木','山口','松本','井上','木村','林','斎藤','清水','山崎','森','池田','橋本','阿部','石川','山下','中島','石井','小川'] ln,
        array['サトウ','スズキ','タカハシ','タナカ','イトウ','ワタナベ','ヤマモト','ナカムラ','コバヤシ','カトウ','ヨシダ','ヤマダ','ササキ','ヤマグチ','マツモト','イノウエ','キムラ','ハヤシ','サイトウ','シミズ','ヤマザキ','モリ','イケダ','ハシモト','アベ','イシカワ','ヤマシタ','ナカジマ','イシイ','オガワ'] lk,
        array['翔太','大輔','健一','直樹','拓也','美穂','恵','由美','陽子','彩','亮','誠','剛','愛','真由美','智子','和也','裕子','達也','優子'] fn,
        array['ショウタ','ダイスケ','ケンイチ','ナオキ','タクヤ','ミホ','メグミ','ユミ','ヨウコ','アヤ','リョウ','マコト','ツヨシ','アイ','マユミ','トモコ','カズヤ','ユウコ','タツヤ','ユウコ'] fk,
        array['東京都','神奈川県','埼玉県','千葉県','大阪府','愛知県','福岡県','兵庫県','北海道','静岡県'] pref,
        array['住宅LP-注文住宅','住宅LP-分譲','住宅LP-リフォーム','資料請求LP','見学会LP'] lp
    ), base as (
      select g, 1 + floor(random() * 30)::int li, 1 + floor(random() * 20)::int fi, random() r1, random() r2, random() r3
      from generate_series(1, ${CONTACTS}) g
    )
    insert into contacts(last_name, first_name, last_name_kana, first_name_kana, email, email_normalized,
      area_pref, area_city, first_inquiry_at, primary_source, source_detail, consent_status, is_suppressed,
      has_valid_phone, callable, job_change_intent, created_at)
    select n.ln[b.li], n.fn[b.fi], n.lk[b.li], n.fk[b.fi],
      'user' || b.g || '@example.test', 'user' || b.g || '@example.test',
      n.pref[(b.g % 10) + 1], '架空市' || (b.g % 50 + 1),
      now() - make_interval(days => (b.r1 * 1460)::int),
      case when b.r3 < 0.03 then 'lp' else 'kintone' end,
      case when b.r3 < 0.03 then '人材LP-転職相談' else n.lp[(b.g % 5) + 1] end,
      case when b.r2 < 0.60 then 'granted' when b.r2 < 0.95 then 'unknown' else 'denied' end::consent_status,
      false, true,
      b.r2 < 0.60,
      case when b.r1 < 0.02 then 'consult_wanted' end,
      now() - make_interval(days => (b.r1 * 1460)::int)
    from base b, names n`);
  await db.query(`
    insert into contact_phones(contact_id, phone_raw, phone_e164, phone_hash, type)
    select id, '090-0' || lpad((rn / 10000)::text, 3, '0') || '-' || lpad((rn % 10000)::text, 4, '0'),
           '+81900' || lpad((rn / 10000)::text, 3, '0') || lpad((rn % 10000)::text, 4, '0'),
           phone_hash('+81900' || lpad((rn / 10000)::text, 3, '0') || lpad((rn % 10000)::text, 4, '0')), 'mobile'
    from (select id, row_number() over (order by created_at, id) rn from contacts) s`);
  await db.query(`
    insert into contact_sources(contact_id, source_system, source_app_id, source_record_id, source_updated_at)
    select id, case when primary_source = 'lp' then 'lp' else 'kintone' end, case when primary_source = 'lp' then 'career-lp' else '101' end,
           'DEMO-' || row_number() over (order by created_at, id), created_at
    from contacts`);
  await db.query(`
    insert into consents(contact_id, status, basis, terms_version, obtained_at, note)
    select id, consent_status, case when consent_status = 'granted' then '住宅LP申込時の同意（架空）' else '取込時点で不明' end,
           case when consent_status = 'granted' then 'v2024-01' end, created_at, '架空データ'
    from contacts`);
  // 架電禁止 1%
  await db.query(`
    with s as (select c.id, p.phone_hash from contacts c join contact_phones p on p.contact_id = c.id where random() < 0.01)
    insert into suppression_list(phone_hash, contact_id, reason, note, registered_at)
    select phone_hash, id, 'refusal', '架空データ', now() - interval '60 days' from s`);
  await db.query(`update contacts c set is_suppressed = true, callable = false, queue_state = 'closed'
                  from suppression_list s where s.contact_id = c.id`);
  // 重複候補 約 2%（同じ電話番号・同姓同名の別レコード。自動統合はしない）
  await db.query(`
    with src as (select c.*, p.phone_raw, p.phone_e164, p.phone_hash, gen_random_uuid() new_id
                 from contacts c join contact_phones p on p.contact_id = c.id
                 where not c.is_suppressed order by random() limit ${Math.floor(CONTACTS * 0.02)}),
    dup as (
      insert into contacts(id, last_name, first_name, last_name_kana, first_name_kana, area_pref, area_city,
        first_inquiry_at, primary_source, source_detail, consent_status, has_valid_phone, callable, created_at)
      select new_id, last_name, first_name, last_name_kana, first_name_kana, area_pref, area_city,
        first_inquiry_at + (now() - first_inquiry_at) / 2, primary_source, source_detail, 'unknown', true, false,
        created_at + (now() - created_at) / 2
      from src returning id)
    insert into contact_phones(contact_id, phone_raw, phone_e164, phone_hash)
    select new_id, phone_raw, phone_e164, phone_hash from src`);
  await db.query(`
    insert into duplicate_candidates(contact_id_a, contact_id_b, match_keys, score)
    select least(a.contact_id, b.contact_id), greatest(a.contact_id, b.contact_id), array['phone','name'], 0.9
    from contact_phones a join contact_phones b on a.phone_hash = b.phone_hash and a.contact_id < b.contact_id
    on conflict do nothing`);
  await db.query(`insert into contact_sources(contact_id, source_system, source_app_id, source_record_id)
                  select id, 'kintone', '102', 'DEMO-DUP-' || row_number() over (order by id) from contacts c
                  where not exists(select 1 from contact_sources s where s.contact_id = c.id)`);
  await db.query(`insert into consents(contact_id, status, basis, note)
                  select id, 'unknown', '取込時点で不明', '架空データ' from contacts c
                  where not exists(select 1 from consents s where s.contact_id = c.id)`);
  await db.query(`set session_replication_role = origin`);

  log("トークスクリプト・目標");
  await db.query(`insert into scripts(title, body, created_by) values
    ('初回架電（住宅LP由来）', $1, $2),
    ('人材LP 新規反響', $3, $2)`, [
    "## 1. ご挨拶\nお世話になっております。〇〇株式会社の{担当者名}です。以前、住宅のお問い合わせをいただいた際にキャリアに関するご案内の同意をいただいておりまして、ご連絡いたしました。\n\n## 2. 目的の説明\n現在、転職やキャリアのご相談を無料で承っております。今お時間 1 分ほどよろしいでしょうか。\n\n## 3. ヒアリング\n- 現在のお仕事・職種\n- 転職のご意向（時期）\n- 希望の勤務地・年収\n\n## 4. クロージング\nキャリアアドバイザーとの 30 分の無料面談をご案内します。ご都合のよい日時はありますか。\n\n## 断られた場合\n今後のご連絡を控えることもできます。ご希望の場合は『架電拒否』で登録してください。",
    userId.pm,
    "## 1. ご挨拶\n先ほどは転職相談のお申込みありがとうございます。〇〇の{担当者名}です。\n\n## 2. 申込内容の確認\n- 希望職種・時期\n- 現在の状況\n\n## 3. 面談設定\nキャリアアドバイザーとの面談日時を決めましょう。",
  ]);
  const period = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }).slice(0, 7);
  await db.query(`insert into goals(scope, period, metric, target_value) values
    ('org',$1,'calls',36000),('org',$1,'connects',9000),('org',$1,'appointments',600),('org',$1,'revenue',30000000)`, [period]);
  for (const u of USERS.filter((x) => x.roles.includes("caller"))) {
    await db.query(`insert into goals(scope, user_id, period, metric, target_value) values
      ('user',$1,$2,'calls',2400),('user',$1,$2,'appointments',40)`, [userId[u.key], period]);
  }

  log("架電リスト作成・割当（過去実績用）");
  const callers = USERS.filter((x) => x.roles.includes("caller")).map((x) => userId[x.key]);
  const listRes = await db.query<{ id: string }>(
    `insert into call_lists(name, description, type, filter_definition, priority, created_by, team_id)
     values ('関東・許諾済み（2024年以降問い合わせ）', '架空データの初期リスト', 'static',
       '{"op":"and","rules":[{"field":"area_pref","operator":"in","value":["東京都","神奈川県","埼玉県","千葉県"]},{"field":"first_inquiry_at","operator":"between","value":["2024-01-01","2026-12-31"]}]}', 10, $1, null)
     returning id`, [userId.pm]);
  const listId = listRes.rows[0].id;
  await db.query(`
    insert into call_list_members(call_list_id, contact_id)
    select $1, id from contacts where callable and area_pref in ('東京都','神奈川県','埼玉県','千葉県')
      and first_inquiry_at >= '2024-01-01' limit 30000`, [listId]);
  await db.query(`update call_lists set member_count = (select count(*) from call_list_members where call_list_id = $1), refreshed_at = now() where id = $1`, [listId]);
  await db.query(`
    insert into assignments(contact_id, user_id, call_list_id, assigned_by, assigned_at)
    select m.contact_id, ($2::uuid[])[(row_number() over (order by m.contact_id) - 1) % array_length($2::uuid[],1) + 1],
           $1, $3, now() - interval '30 days'
    from call_list_members m where m.call_list_id = $1 limit ${Math.min(6000, CONTACTS)}`, [listId, callers, userId.pm]);

  log("過去30日の架電実績を生成");
  await db.query(`set session_replication_role = replica`);
  await db.query(`
    with picks as (
      select a.contact_id, a.user_id, a.call_list_id, row_number() over (order by random()) rn
      from assignments a where a.released_at is null
    ), days as (
      select p.*, (now() at time zone 'Asia/Tokyo')::date - (1 + (rn % 28))::int as d
      from picks p where rn <= 4800
    ), calls as (
      select d.*, (d.d + make_interval(hours => 10 + (random() * 9)::int, mins => (random() * 59)::int))::timestamp at time zone 'Asia/Tokyo' as started,
             random() as r
      from days d where extract(isodow from d.d) <> 7
    ), res as (
      select c.*, case
        when r < 0.38 then 'no_answer' when r < 0.55 then 'voicemail' when r < 0.60 then 'busy' when r < 0.64 then 'other_person'
        when r < 0.74 then 'connected' when r < 0.79 then 'intent_future' when r < 0.83 then 'intent_yes'
        when r < 0.86 then 'callback' when r < 0.905 then 'appointment' when r < 0.95 then 'intent_no'
        when r < 0.97 then 'invalid_number' when r < 0.985 then 'refused' else 'out_of_scope' end as code
      from calls c
    ), logs as (
      insert into call_logs(id, started_at, contact_id, user_id, call_list_id, provider, phone_e164, status, answered_at, ended_at, duration_sec, is_demo)
      select gen_random_uuid(), r.started, r.contact_id, r.user_id, r.call_list_id, 'mock',
        (select phone_e164 from contact_phones p where p.contact_id = r.contact_id limit 1),
        case when m.is_connected then 'completed' when r.code = 'busy' then 'busy' else 'no_answer' end::call_status,
        case when m.is_connected then r.started + interval '8 seconds' end,
        r.started + make_interval(secs => case when m.is_connected then 60 + (random() * 360)::int else 25 end),
        case when m.is_connected then 60 + (random() * 360)::int else 0 end, true
      from res r join call_result_masters m on m.code = r.code
      returning id, started_at, contact_id, user_id, call_list_id
    )
    insert into call_results(call_log_id, call_started_at, contact_id, user_id, call_list_id, result_code, is_connected, memo, saved_at)
    select l.id, l.started_at, l.contact_id, l.user_id, l.call_list_id, r.code, m.is_connected, '架空の通話メモ', l.started_at + interval '7 minutes'
    from logs l join res r on r.contact_id = l.contact_id and r.started = l.started_at
    join call_result_masters m on m.code = r.code`);
  // 顧客側の集計列を反映
  await db.query(`
    update contacts c set call_count = s.cnt, last_called_at = s.last_at, last_call_result = s.code,
      queue_state = case
        when s.code in ('appointment') then 'appointed'
        when s.code in ('intent_no','invalid_number','refused','out_of_scope') then 'closed'
        else 'recall' end::queue_state,
      next_call_at = case when s.code in ('no_answer','voicemail','busy','other_person','callback','intent_yes','intent_future','connected')
        then s.last_at + interval '3 days' end
    from (select distinct on (contact_id) contact_id, result_code code, call_started_at last_at,
            count(*) over (partition by contact_id) cnt
          from call_results order by contact_id, call_started_at desc) s
    where s.contact_id = c.id`);
  await db.query(`
    insert into suppression_list(phone_hash, contact_id, reason, note, registered_at)
    select p.phone_hash, c.id, 'refusal', '架空データ（架電拒否）', c.last_called_at
    from contacts c join contact_phones p on p.contact_id = c.id where c.last_call_result = 'refused'
    on conflict do nothing`);
  await db.query(`update contacts set is_suppressed = true, callable = false where last_call_result = 'refused'`);
  await db.query(`update contact_phones p set is_valid = false from contacts c where c.id = p.contact_id and c.last_call_result = 'invalid_number'`);
  await db.query(`update contacts set has_valid_phone = false, callable = false where last_call_result = 'invalid_number'`);
  await db.query(`update assignments a set released_at = c.last_called_at, reason = c.last_call_result
                  from contacts c where c.id = a.contact_id and c.queue_state in ('appointed','closed') and a.released_at is null`);

  log("アポイント・引き継ぎ");
  const cas = ["ca1", "ca2", "ca3"].map((k) => userId[k]);
  await db.query(`
    insert into appointments(contact_id, origin_call_log_id, booked_by, advisor_user_id, scheduled_at, method, status, done_at)
    select r.contact_id, r.call_log_id, r.user_id, ($1::uuid[])[(row_number() over (order by r.saved_at) - 1) % 3 + 1],
      r.saved_at + make_interval(days => 2 + (random() * 5)::int),
      (array['online','phone','visit'])[1 + (random() * 2)::int]::appointment_method,
      case when r.saved_at + interval '7 days' > now() then 'scheduled'
           when random() < 0.72 then 'done' when random() < 0.5 then 'no_show' else 'canceled' end::appointment_status,
      case when r.saved_at + interval '7 days' <= now() then r.saved_at + interval '3 days' end
    from call_results r where r.result_code = 'appointment'`, [cas]);
  await db.query(`update appointments set done_at = null where status <> 'done'`);
  await db.query(`
    insert into handoffs(appointment_id, snapshot, from_user_id, to_user_id)
    select a.id, jsonb_build_object('contact', jsonb_build_object('name', c.full_name, 'area', c.area_pref, 'source', c.primary_source),
           'hearing', jsonb_build_object('currentJob', '営業職（架空）', 'desiredTiming', '3ヶ月以内'), 'memo', '架空の引き継ぎメモ'),
           a.booked_by, a.advisor_user_id
    from appointments a join contacts c on c.id = a.contact_id`);
  await db.query(`set session_replication_role = origin`);
  await db.query(`analyze`);

  const counts = await db.query(`select
    (select count(*) from contacts) contacts, (select count(*) from contacts where callable) callable,
    (select count(*) from call_logs) call_logs, (select count(*) from appointments) appointments,
    (select count(*) from suppression_list) suppressed, (select count(*) from duplicate_candidates) duplicates`);
  log(`完了: ${JSON.stringify(counts.rows[0])}`);
  console.log(`\nログイン用テストユーザー: ${USERS.map((u) => u.email).join(", ")}`);
  console.log("パスワード: SEED_USER_PASSWORD（未設定時は seed スクリプト内の既定値）");
  await db.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
