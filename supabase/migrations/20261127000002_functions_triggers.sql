-- =====================================================================
-- 権限ヘルパー・トリガー・共通関数
-- =====================================================================

-- ---------- 権限ヘルパー（RLSから (select fn()) 形式で呼ぶ） ----------
create or replace function app_user_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from users where auth_user_id = auth.uid() and status = 'active'
$$;

create or replace function has_role(r app_role) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from user_roles where user_id = app_user_id() and role = r)
$$;

create or replace function is_manager() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from user_roles where user_id = app_user_id() and role in ('admin','pm'))
$$;

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select has_role('admin')
$$;

-- 自分がリーダーのチームに所属するユーザーID（自分を含む）
create or replace function led_member_ids() returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct tm2.user_id), '{}')
  from team_members tm
  join team_members tm2 on tm2.team_id = tm.team_id
  where tm.user_id = app_user_id() and tm.is_leader
$$;

create or replace function led_team_ids() returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(team_id), '{}') from team_members where user_id = app_user_id() and is_leader
$$;

-- 顧客の閲覧可否（RLS外のチェック用）
create or replace function can_view_contact(p_contact uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_manager()
      or exists(select 1 from assignments a where a.contact_id = p_contact and a.released_at is null
                and (a.user_id = app_user_id() or a.user_id = any(led_member_ids())))
      or exists(select 1 from appointments ap where ap.contact_id = p_contact
                and (ap.advisor_user_id = app_user_id() or ap.booked_by = app_user_id()))
$$;

-- ---------- 監査ログ ----------
create or replace function write_audit(p_action text, p_target_type text, p_target_id text, p_diff jsonb default null)
returns void language sql security definer set search_path = public as $$
  insert into audit_logs(actor_id, action, target_type, target_id, diff)
  values (app_user_id(), p_action, p_target_type, p_target_id, p_diff)
$$;

-- ---------- 正規化 ----------
create or replace function phone_hash(p_e164 text) returns text
language sql immutable as $$
  select encode(extensions.digest(coalesce(p_e164,''), 'sha256'), 'hex')
$$;

-- ---------- 架電可能フラグ（contacts） ----------
create or replace function contacts_compute_callable() returns trigger language plpgsql as $$
begin
  new.callable := new.consent_status = 'granted'
              and not new.is_suppressed
              and new.has_valid_phone
              and new.deleted_at is null;
  if new.email is not null then
    new.email_normalized := lower(trim(new.email));
  end if;
  return new;
end $$;
create trigger contacts_callable before insert or update on contacts
  for each row execute function contacts_compute_callable();

-- 電話番号の変更 → has_valid_phone / is_suppressed を更新
create or replace function contact_phones_sync() returns trigger
language plpgsql security definer set search_path = public as $$
declare cid uuid := coalesce(new.contact_id, old.contact_id);
begin
  if tg_op in ('INSERT','UPDATE') then
    new.phone_hash := phone_hash(new.phone_e164);
  end if;
  return coalesce(new, old);
end $$;
create trigger contact_phones_hash before insert or update on contact_phones
  for each row execute function contact_phones_sync();

create or replace function contact_phones_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare cid uuid := coalesce(new.contact_id, old.contact_id);
begin
  update contacts c set
    has_valid_phone = exists(select 1 from contact_phones p where p.contact_id = cid and p.is_valid),
    is_suppressed = c.is_suppressed or exists(
      select 1 from contact_phones p join suppression_list s on s.phone_hash = p.phone_hash and s.released_at is null
      where p.contact_id = cid)
  where c.id = cid;
  return null;
end $$;
create trigger contact_phones_after after insert or update or delete on contact_phones
  for each row execute function contact_phones_after();

-- 架電禁止登録 → 同じ電話番号を持つ全顧客を架電不可にし、キュー・割当から外す
create or replace function suppression_apply() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  with targets as (
    select distinct c.id from contacts c
    left join contact_phones p on p.contact_id = c.id
    where c.id = new.contact_id or (new.phone_hash is not null and p.phone_hash = new.phone_hash)
  )
  update contacts c set is_suppressed = true, queue_state = 'closed', next_call_at = null
  from targets t where c.id = t.id;

  update assignments a set released_at = now(), reason = 'suppressed'
  where a.released_at is null and a.contact_id in (
    select c.id from contacts c left join contact_phones p on p.contact_id = c.id
    where c.id = new.contact_id or (new.phone_hash is not null and p.phone_hash = new.phone_hash));
  return null;
end $$;
create trigger suppression_after_insert after insert on suppression_list
  for each row execute function suppression_apply();

-- 架電禁止解除 → 他に有効な禁止がなければフラグを戻す（queue_state は closed のまま。再開は手動）
create or replace function suppression_release_apply() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.released_at is null and new.released_at is not null then
    update contacts c set is_suppressed = exists(
        select 1 from contact_phones p join suppression_list s on s.phone_hash = p.phone_hash
        where p.contact_id = c.id and s.released_at is null)
      or exists(select 1 from suppression_list s where s.contact_id = c.id and s.released_at is null)
    where c.id = new.contact_id
       or c.id in (select contact_id from contact_phones where phone_hash = new.phone_hash);
  end if;
  return null;
end $$;
create trigger suppression_after_update after update on suppression_list
  for each row execute function suppression_release_apply();

-- 利用許諾履歴の追加 → 最新状態を contacts に反映
create or replace function consents_apply() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.purpose = 'jinzai_sales' then
    update contacts set consent_status = new.status where id = new.contact_id;
    if new.status <> 'granted' then
      update assignments set released_at = now(), reason = 'consent_' || new.status
      where contact_id = new.contact_id and released_at is null;
    end if;
  end if;
  return null;
end $$;
create trigger consents_after_insert after insert on consents
  for each row execute function consents_apply();

-- 選考ステータス履歴
create or replace function applications_history() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or old.status is distinct from new.status then
    insert into application_status_history(application_id, from_status, to_status, changed_by)
    values (new.id, case when tg_op = 'UPDATE' then old.status end, new.status, app_user_id());
    new.status_changed_at := now();
  end if;
  return new;
end $$;
create trigger applications_status_history before insert or update on applications
  for each row execute function applications_history();

-- ---------- 設定値の取得 ----------
create or replace function rule(p_key text) returns jsonb
language sql stable security definer set search_path = public as $$
  select value from call_rules where key = p_key
$$;

-- JSTの架電可能時間帯か
create or replace function within_calling_hours(p_at timestamptz default now()) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  r jsonb := rule('calling_hours');
  local_ts timestamp := p_at at time zone 'Asia/Tokyo';
  dow int := extract(isodow from local_ts);   -- 1=月 … 7=日
  t time := local_ts::time;
begin
  if r is null or coalesce((r->>'enforce')::boolean, true) = false then return true; end if;
  if not (r->'days') @> to_jsonb(dow) then return false; end if;
  return t >= (r->>'start')::time and t < (r->>'end')::time;
end $$;

-- 次の営業日の同時刻（架電可能曜日ベース）
create or replace function next_business_slot(p_from timestamptz, p_days int default 1) returns timestamptz
language plpgsql stable security definer set search_path = public as $$
declare
  r jsonb := rule('calling_hours');
  ts timestamptz := p_from + make_interval(days => p_days);
  i int := 0;
begin
  while i < 14 and r is not null and not (r->'days') @> to_jsonb(extract(isodow from ts at time zone 'Asia/Tokyo')::int) loop
    ts := ts + interval '1 day'; i := i + 1;
  end loop;
  return ts;
end $$;
