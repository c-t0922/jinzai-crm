-- =====================================================================
-- 架電センター RPC（docs/04 §2〜3, docs/07 架電センター）
-- すべて security definer。関数内で必ず app_user_id() と権限を確認する。
-- =====================================================================

create or replace function require_user() returns uuid
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := app_user_id();
begin
  if uid is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  return uid;
end $$;

create or replace function can_call_role() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from user_roles where user_id = app_user_id() and role in ('admin','pm','team_leader','caller'))
$$;

-- 優先順位の順位値（小さいほど優先）。call_rules.assignment_priority の順序で決まる
create or replace function queue_rank(c contacts) returns int
language plpgsql stable security definer set search_path = public as $$
declare
  ord jsonb := coalesce(rule('assignment_priority'), '["recall_today","lp_new","consult_wanted","untouched","recall_absent"]');
  k text;
begin
  k := case
    when c.queue_state = 'recall' and c.next_call_at is not null
         and (c.next_call_at at time zone 'Asia/Tokyo')::date = (now() at time zone 'Asia/Tokyo')::date
         and c.last_call_result not in ('no_answer','voicemail','busy','other_person') then 'recall_today'
    when c.primary_source = 'lp' and c.call_count = 0 then 'lp_new'
    when c.job_change_intent = 'consult_wanted' then 'consult_wanted'
    when c.call_count = 0 then 'untouched'
    when c.queue_state = 'recall' then 'recall_absent'
    else null end;
  if k is null then return 99; end if;
  return coalesce((select ordinality from jsonb_array_elements_text(ord) with ordinality e(v, ordinality) where v = k), 50)::int;
end $$;

-- 発信可否（理由コード。null=発信可）
create or replace function call_block_reason(p_contact uuid, p_user uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare c contacts; l contact_locks;
begin
  select * into c from contacts where id = p_contact;
  if not found or c.deleted_at is not null then return 'not_found'; end if;
  if c.consent_status <> 'granted' then return 'consent_unknown'; end if;
  if c.is_suppressed or exists(
      select 1 from contact_phones p join suppression_list s on s.phone_hash = p.phone_hash and s.released_at is null
      where p.contact_id = p_contact) then return 'suppressed'; end if;
  if not c.has_valid_phone then return 'invalid_phone'; end if;
  if c.queue_state in ('closed','appointed') then return 'closed'; end if;
  if not within_calling_hours() then return 'outside_hours'; end if;
  select * into l from contact_locks where contact_id = p_contact and expires_at > now();
  if found and l.user_id <> p_user then return 'locked_by_other'; end if;
  return null;
end $$;

-- ロック取得（他人が有効なロックを保持していれば null）
create or replace function try_lock(p_contact uuid, p_user uuid) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare ttl int := coalesce((rule('lock_ttl_minutes'))::text::int, 10); exp timestamptz;
begin
  insert into contact_locks(contact_id, user_id, acquired_at, expires_at)
  values (p_contact, p_user, now(), now() + make_interval(mins => ttl))
  on conflict (contact_id) do update
    set user_id = excluded.user_id, acquired_at = now(), expires_at = excluded.expires_at
    where contact_locks.expires_at <= now() or contact_locks.user_id = p_user
  returning expires_at into exp;
  return exp;
end $$;

-- 顧客カード（架電センター中央カラム用）
create or replace function cc_contact_card(p_contact uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare res jsonb;
begin
  select jsonb_build_object(
    'id', c.id, 'name', c.full_name, 'kana', concat_ws(' ', c.last_name_kana, c.first_name_kana),
    'email', c.email, 'area', concat_ws(' ', c.area_pref, c.area_city),
    'firstInquiryAt', c.first_inquiry_at, 'source', c.primary_source, 'sourceDetail', c.source_detail,
    'consentStatus', c.consent_status, 'isSuppressed', c.is_suppressed, 'callable', c.callable,
    'jobChangeIntent', c.job_change_intent, 'tags', c.tags, 'queueState', c.queue_state,
    'callCount', c.call_count, 'lastCalledAt', c.last_called_at, 'lastCallResult', c.last_call_result,
    'nextCallAt', c.next_call_at,
    'phones', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'e164', p.phone_e164, 'isValid', p.is_valid, 'isPrimary', p.is_primary) order by p.is_primary desc)
               from contact_phones p where p.contact_id = c.id), '[]'),
    'history', coalesce((select jsonb_agg(h order by h->>'at' desc) from (
        select jsonb_build_object('at', r.saved_at, 'result', r.result_code, 'label', m.label, 'category', m.category,
               'memo', r.memo, 'user', u.name, 'durationSec', cl.duration_sec) h
        from call_results r join call_result_masters m on m.code = r.result_code
        join users u on u.id = r.user_id
        left join call_logs cl on cl.id = r.call_log_id and cl.started_at = r.call_started_at
        where r.contact_id = c.id order by r.saved_at desc limit 20) x), '[]'),
    'draft', (select payload from call_drafts d where d.contact_id = c.id and d.user_id = app_user_id())
  ) into res
  from contacts c where c.id = p_contact;
  return res;
end $$;

-- 架電キュー（左カラム）
create or replace function cc_queue(p_tab text default 'today', p_limit int default 100) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := require_user(); res jsonb; counts jsonb;
begin
  with mine as (
    select c.*, queue_rank(c) as rnk, a.call_list_id,
      (select l.user_id from contact_locks l where l.contact_id = c.id and l.expires_at > now()) as locked_by
    from assignments a join contacts c on c.id = a.contact_id
    where a.user_id = uid and a.released_at is null
      and c.callable and c.queue_state in ('new','recall')
      and (c.recall_block_until is null or c.recall_block_until <= now())
      and (a.call_list_id is null or exists(select 1 from call_lists cl2 where cl2.id = a.call_list_id and cl2.status = 'active'))
  ), tabbed as (
    select * from mine m where case p_tab
      when 'today' then (m.next_call_at is null or m.next_call_at <= now() + interval '12 hours')
      when 'recall' then m.queue_state = 'recall'
      when 'new' then m.primary_source = 'lp' and m.call_count = 0
      when 'untouched' then m.call_count = 0
      else true end
  )
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'id', t.id, 'name', t.full_name, 'area', t.area_pref, 'queueState', t.queue_state,
        'nextCallAt', t.next_call_at, 'callCount', t.call_count, 'lastCallResult', t.last_call_result,
        'rank', t.rnk, 'source', t.primary_source, 'lockedByOther', t.locked_by is not null and t.locked_by <> uid)
        order by (t.next_call_at is not null and t.next_call_at > now()), t.rnk, t.next_call_at nulls last, t.first_inquiry_at desc nulls last)
      from (select * from tabbed order by (next_call_at is not null and next_call_at > now()), rnk, next_call_at nulls last, first_inquiry_at desc nulls last limit p_limit) t), '[]'),
    'counts', jsonb_build_object(
      'today', (select count(*) from mine where next_call_at is null or next_call_at <= now() + interval '12 hours'),
      'recall', (select count(*) from mine where queue_state = 'recall'),
      'new', (select count(*) from mine where primary_source = 'lp' and call_count = 0),
      'untouched', (select count(*) from mine where call_count = 0),
      'total', (select count(*) from mine))
  ) into res;
  return res;
end $$;

-- 次の顧客を取得してロック（自動発信はしない）
create or replace function cc_next(p_skip uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); cid uuid; exp timestamptz;
begin
  if not can_call_role() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  -- 自分が保持している他のロックは解放
  delete from contact_locks where user_id = uid;

  for cid in
    select c.id
    from assignments a join contacts c on c.id = a.contact_id
    where a.user_id = uid and a.released_at is null
      and c.callable and c.queue_state in ('new','recall')
      and (c.next_call_at is null or c.next_call_at <= now())
      and (c.recall_block_until is null or c.recall_block_until <= now())
      and (p_skip is null or c.id <> p_skip)
      and (a.call_list_id is null or exists(select 1 from call_lists cl2 where cl2.id = a.call_list_id and cl2.status = 'active'))
      and not exists(select 1 from contact_locks l where l.contact_id = c.id and l.expires_at > now() and l.user_id <> uid)
    order by queue_rank(c), c.next_call_at nulls last, c.first_inquiry_at desc nulls last
    limit 20
  loop
    exp := try_lock(cid, uid);
    if exp is not null then
      return jsonb_build_object('contact', cc_contact_card(cid), 'lockExpiresAt', exp);
    end if;
  end loop;
  return jsonb_build_object('contact', null);
end $$;

-- 指定顧客を開く（キューからクリック／顧客詳細から）
create or replace function cc_open(p_contact uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); exp timestamptz;
begin
  if not can_call_role() or not can_view_contact(p_contact) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  delete from contact_locks where user_id = uid and contact_id <> p_contact;
  exp := try_lock(p_contact, uid);
  if exp is null then
    return jsonb_build_object('error', 'locked_by_other', 'contact', null);
  end if;
  return jsonb_build_object('contact', cc_contact_card(p_contact), 'lockExpiresAt', exp,
    'blockReason', call_block_reason(p_contact, uid));
end $$;

create or replace function cc_heartbeat(p_contact uuid) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user();
begin
  return try_lock(p_contact, uid);
end $$;

create or replace function cc_release(p_contact uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from contact_locks where contact_id = p_contact and user_id = require_user();
end $$;

-- 発信開始：サーバー側で直前チェック → call_logs 作成。電話番号はサーバーにのみ返す
create or replace function cc_start_call(p_contact uuid, p_idempotency_key text, p_phone_id uuid default null,
                                         p_script uuid default null, p_provider text default 'mock', p_is_demo boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := require_user(); reason text; prev jsonb; ph contact_phones; log_id uuid; started timestamptz; list_id uuid;
begin
  if not can_call_role() or not can_view_contact(p_contact) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select response into prev from idempotency_keys where key = p_idempotency_key and user_id = uid;
  if found then return prev; end if;

  -- 同一担当者の通話中の発信を禁止（二重発信防止）
  if exists(select 1 from call_logs where user_id = uid and status in ('initiating','ringing','in_progress')
            and started_at > now() - interval '2 hours') then
    return jsonb_build_object('error', 'DUPLICATE_DIAL');
  end if;

  reason := call_block_reason(p_contact, uid);
  if reason is not null then return jsonb_build_object('error', 'NOT_CALLABLE', 'reason', reason); end if;
  if try_lock(p_contact, uid) is null then return jsonb_build_object('error', 'NOT_CALLABLE', 'reason', 'locked_by_other'); end if;

  select * into ph from contact_phones where contact_id = p_contact and is_valid
    and (p_phone_id is null or id = p_phone_id) order by is_primary desc limit 1;
  if not found then return jsonb_build_object('error', 'NOT_CALLABLE', 'reason', 'invalid_phone'); end if;

  select call_list_id into list_id from assignments where contact_id = p_contact and released_at is null;

  insert into call_logs(contact_id, user_id, call_list_id, script_id, provider, phone_e164, status, is_demo)
  values (p_contact, uid, list_id, p_script, p_provider, ph.phone_e164, 'initiating', p_is_demo)
  returning id, started_at into log_id, started;

  prev := jsonb_build_object('callLogId', log_id, 'startedAt', started, 'toE164', ph.phone_e164);
  insert into idempotency_keys(key, user_id, scope, response) values (p_idempotency_key, uid, 'start_call', prev);
  return prev;
end $$;

-- 通話ステータス更新（CTIイベント／モック）
create or replace function cc_update_call(p_call uuid, p_status call_status, p_provider_call_id text default null,
                                          p_error text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); cl call_logs;
begin
  select * into cl from call_logs where id = p_call and user_id = uid for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if cl.ended_at is not null then return jsonb_build_object('status', cl.status, 'durationSec', cl.duration_sec); end if;

  update call_logs set
    status = p_status,
    provider_call_id = coalesce(p_provider_call_id, provider_call_id),
    answered_at = case when p_status = 'in_progress' and answered_at is null then now() else answered_at end,
    ended_at = case when p_status in ('completed','failed','no_answer','busy','canceled') then now() else ended_at end,
    duration_sec = case when p_status in ('completed','failed','no_answer','busy','canceled')
      then case when answered_at is null and p_status <> 'in_progress' then 0
                else greatest(0, extract(epoch from now() - coalesce(answered_at, now()))::int) end
      else duration_sec end,
    error_message = coalesce(p_error, error_message)
  where id = cl.id and started_at = cl.started_at
  returning * into cl;
  return jsonb_build_object('status', cl.status, 'durationSec', cl.duration_sec, 'answeredAt', cl.answered_at, 'endedAt', cl.ended_at);
end $$;

-- 架電結果の保存＋自動アクション（同一トランザクション）
-- p_appointment: {scheduledAt, method, meetingUrl, advisorUserId, note}
create or replace function cc_save_result(
  p_contact uuid, p_call uuid, p_result text, p_idempotency_key text,
  p_hearing jsonb default '{}', p_memo text default null, p_next_call_at timestamptz default null,
  p_appointment jsonb default null, p_handoff_to uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := require_user();
  m call_result_masters; c contacts; cl call_logs; prev jsonb;
  act jsonb; actions jsonb := '[]'; f text;
  next_at timestamptz; appt_id uuid; max_attempts int := coalesce((rule('max_no_answer_attempts'))::text::int, 6);
  block_days int; advisor uuid; res_id uuid;
begin
  if not can_call_role() or not can_view_contact(p_contact) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select response into prev from idempotency_keys where key = p_idempotency_key and user_id = uid;
  if found then return prev; end if;

  select * into m from call_result_masters where code = p_result and active;
  if not found then return jsonb_build_object('error', 'VALIDATION_ERROR', 'field', 'result'); end if;

  -- 必須項目チェック
  foreach f in array m.required_fields loop
    if f = 'next_call_at' and p_next_call_at is null then
      return jsonb_build_object('error', 'VALIDATION_ERROR', 'field', f);
    elsif f = 'appointment' and (p_appointment is null or p_appointment->>'scheduledAt' is null) then
      return jsonb_build_object('error', 'VALIDATION_ERROR', 'field', f);
    elsif f = 'memo' and coalesce(trim(p_memo), '') = '' then
      return jsonb_build_object('error', 'VALIDATION_ERROR', 'field', f);
    end if;
  end loop;

  select * into c from contacts where id = p_contact for update;

  if p_call is null then
    -- 発信せずに結果登録（対象外・許諾未確認など）。架電数には数えない
    insert into call_logs(contact_id, user_id, status, ended_at, duration_sec, is_demo)
    values (p_contact, uid, 'canceled', now(), 0, true) returning * into cl;
  else
    select * into cl from call_logs where id = p_call and user_id = uid and contact_id = p_contact;
    if not found then return jsonb_build_object('error', 'NOT_FOUND'); end if;
    if exists(select 1 from call_results where call_log_id = p_call) then
      return jsonb_build_object('error', 'ALREADY_RECORDED');
    end if;
    if cl.ended_at is null then
      perform cc_update_call(p_call, case when cl.answered_at is null then 'canceled'::call_status else 'completed'::call_status end);
      select * into cl from call_logs where id = p_call and started_at = cl.started_at;
    end if;
  end if;

  insert into call_results(call_log_id, call_started_at, contact_id, user_id, call_list_id, result_code, is_connected,
                           hearing, memo, next_action_at)
  values (cl.id, cl.started_at, p_contact, uid, cl.call_list_id, p_result, m.is_connected,
          coalesce(p_hearing, '{}'), p_memo, p_next_call_at)
  returning id into res_id;

  update contacts set
    call_count = call_count + case when cl.status <> 'canceled' then 1 else 0 end,
    no_answer_count = case when m.category = 'unreachable' then no_answer_count + 1 else 0 end,
    last_called_at = case when cl.status <> 'canceled' then now() else last_called_at end,
    last_call_result = p_result,
    job_change_intent = coalesce(p_hearing->>'jobChangeIntent', case p_result
        when 'intent_yes' then 'yes' when 'intent_future' then 'future' when 'intent_no' then 'no' else job_change_intent end)
  where id = p_contact;

  act := m.auto_action;
  case act->>'type'
    when 'recall' then
      next_at := coalesce(p_next_call_at, case act->>'delay'
          when 'next_business_day' then next_business_slot(now(), case when c.no_answer_count + 1 >= 3 then 2 else 1 end)
          else now() + coalesce((act->>'delay')::interval, interval '1 day') end);
      if m.category = 'unreachable' and c.no_answer_count + 1 >= max_attempts then
        update contacts set queue_state = 'closed', next_call_at = null where id = p_contact;
        update assignments set released_at = now(), reason = 'max_attempts' where contact_id = p_contact and released_at is null;
        actions := actions || jsonb_build_object('type', 'closed', 'reason', 'max_attempts');
      else
        update contacts set queue_state = 'recall', next_call_at = next_at where id = p_contact;
        actions := actions || jsonb_build_object('type', 'recall', 'at', next_at);
      end if;

    when 'appointment' then
      advisor := coalesce(nullif(p_appointment->>'advisorUserId','')::uuid, p_handoff_to);
      insert into appointments(contact_id, origin_call_log_id, booked_by, advisor_user_id, scheduled_at, method, meeting_url, note)
      values (p_contact, cl.id, uid, advisor, (p_appointment->>'scheduledAt')::timestamptz,
              coalesce(nullif(p_appointment->>'method',''), 'phone')::appointment_method,
              nullif(p_appointment->>'meetingUrl',''), p_appointment->>'note')
      returning id into appt_id;
      insert into handoffs(appointment_id, snapshot, from_user_id, to_user_id)
      values (appt_id, jsonb_build_object(
        'contact', jsonb_build_object('name', c.full_name, 'area', concat_ws(' ', c.area_pref, c.area_city),
                                      'source', c.primary_source, 'firstInquiryAt', c.first_inquiry_at),
        'hearing', coalesce(p_hearing, '{}'), 'memo', p_memo,
        'recentCalls', (select coalesce(jsonb_agg(jsonb_build_object('at', r.saved_at, 'result', r.result_code, 'memo', r.memo)), '[]')
                        from (select * from call_results where contact_id = p_contact order by saved_at desc limit 5) r)),
        uid, advisor);
      if advisor is not null then
        insert into tasks(contact_id, assignee_id, type, title, due_at, related_type, related_id, created_by)
        values (p_contact, advisor, 'appointment_prep', '面談前確認：' || c.full_name,
                (p_appointment->>'scheduledAt')::timestamptz - interval '1 hour', 'appointment', appt_id, uid);
        insert into notifications(user_id, kind, title, body, link)
        values (advisor, 'handoff', '新しいアポイントが引き継がれました', c.full_name || ' / ' ||
                to_char((p_appointment->>'scheduledAt')::timestamptz at time zone 'Asia/Tokyo', 'MM/DD HH24:MI'),
                '/appointments/' || appt_id);
      else
        insert into notifications(user_id, kind, title, body, link)
        select ur.user_id, 'handoff_unassigned', '面談担当者が未設定のアポイントがあります', c.full_name, '/appointments/' || appt_id
        from user_roles ur where ur.role = 'pm';
      end if;
      update contacts set queue_state = 'appointed', next_call_at = null where id = p_contact;
      update assignments set released_at = now(), reason = 'appointed' where contact_id = p_contact and released_at is null;
      actions := actions || jsonb_build_object('type', 'appointment', 'appointmentId', appt_id);

    when 'suppress' then
      insert into suppression_list(phone_hash, contact_id, reason, note, registered_by)
      select p.phone_hash, p_contact, coalesce(act->>'reason', 'refusal'), p_memo, uid
      from contact_phones p where p.contact_id = p_contact
      on conflict do nothing;
      if not exists(select 1 from suppression_list where contact_id = p_contact and released_at is null) then
        insert into suppression_list(contact_id, reason, note, registered_by)
        values (p_contact, coalesce(act->>'reason', 'refusal'), p_memo, uid);
      end if;
      update contacts set is_suppressed = true, queue_state = 'closed', next_call_at = null where id = p_contact;
      if act->>'notify' = 'leaders' then
        insert into notifications(user_id, kind, title, body, link)
        select distinct ur.user_id, 'complaint', 'クレームが登録されました', c.full_name || '：' || coalesce(p_memo, ''), '/contacts/' || p_contact
        from user_roles ur where ur.role in ('admin','team_leader');
      end if;
      actions := actions || jsonb_build_object('type', 'suppressed');

    when 'close' then
      block_days := coalesce((act->>'block_days')::int, 0);
      update contacts set queue_state = 'closed', next_call_at = null,
        recall_block_until = case when block_days > 0 then now() + make_interval(days => block_days) else recall_block_until end
      where id = p_contact;
      update assignments set released_at = now(), reason = p_result where contact_id = p_contact and released_at is null;
      actions := actions || jsonb_build_object('type', 'closed');

    when 'invalid_phone' then
      update contact_phones set is_valid = false where contact_id = p_contact;
      update contacts set queue_state = 'closed', next_call_at = null where id = p_contact;
      update assignments set released_at = now(), reason = 'invalid_phone' where contact_id = p_contact and released_at is null;
      actions := actions || jsonb_build_object('type', 'invalid_phone');

    when 'consent_review' then
      insert into consents(contact_id, status, basis, recorded_by, note)
      values (p_contact, 'unknown', 'call_center', uid, coalesce(p_memo, '架電時に利用許諾未確認と判明'));
      insert into tasks(contact_id, assignee_id, type, title, created_by)
      select p_contact, ur.user_id, 'consent_review', '利用許諾の確認：' || c.full_name, uid
      from user_roles ur where ur.role = 'admin' limit 1;
      actions := actions || jsonb_build_object('type', 'consent_review');

    else
      if p_next_call_at is not null then
        update contacts set queue_state = 'recall', next_call_at = p_next_call_at where id = p_contact;
        actions := actions || jsonb_build_object('type', 'recall', 'at', p_next_call_at);
      else
        update contacts set queue_state = 'recall', next_call_at = next_business_slot(now(), 7) where id = p_contact;
        actions := actions || jsonb_build_object('type', 'recall', 'at', next_business_slot(now(), 7));
      end if;
  end case;

  delete from call_drafts where user_id = uid and contact_id = p_contact;
  delete from contact_locks where contact_id = p_contact and user_id = uid;

  prev := jsonb_build_object('resultId', res_id, 'actions', actions);
  insert into idempotency_keys(key, user_id, scope, response) values (p_idempotency_key, uid, 'save_result', prev);
  return prev;
end $$;

create or replace function cc_save_draft(p_contact uuid, p_payload jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user();
begin
  if not can_view_contact(p_contact) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  insert into call_drafts(user_id, contact_id, payload, updated_at) values (uid, p_contact, p_payload, now())
  on conflict (user_id, contact_id) do update set payload = excluded.payload, updated_at = now();
end $$;

-- 本日の自分の実績（ヘッダー表示用）
create or replace function cc_today_stats() returns jsonb
language sql stable security definer set search_path = public as $$
  with b as (select date_trunc('day', now() at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo' as d)
  select jsonb_build_object(
    'calls', (select count(*) from call_logs, b where user_id = app_user_id() and started_at >= b.d and status <> 'canceled'),
    'connects', (select count(*) from call_results r, b where r.user_id = app_user_id() and r.call_started_at >= b.d and r.is_connected),
    'appointments', (select count(*) from call_results r, b where r.user_id = app_user_id() and r.call_started_at >= b.d and r.result_code = 'appointment'),
    'goalAppointments', (select target_value from goals where scope = 'user' and user_id = app_user_id()
                         and period = to_char(now() at time zone 'Asia/Tokyo', 'YYYY-MM') and metric = 'appointments'),
    'monthAppointments', (select count(*) from call_results r where r.user_id = app_user_id() and r.result_code = 'appointment'
                         and r.call_started_at >= date_trunc('month', now() at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo')
  )
$$;
