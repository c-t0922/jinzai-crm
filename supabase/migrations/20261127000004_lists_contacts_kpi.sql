-- =====================================================================
-- 条件ビルダー・顧客検索・架電リスト・利用許諾/架電禁止・アポ・KPI
-- =====================================================================

-- ---------- 条件（AND/OR 木）→ SQL 句 ----------
-- 形式: {"op":"and"|"or","rules":[{"field":"area_pref","operator":"in","value":["東京都"]}, {"op":"or","rules":[...]}]}
-- フィールドはホワイトリストのみ。金融系項目は存在しない（取り込まない）。
create or replace function compile_filter(f jsonb) returns text
language plpgsql immutable as $$
declare
  parts text[] := '{}'; r jsonb; fld text; opr text; v jsonb; col text; sql text; joiner text;
begin
  if f is null or f = '{}'::jsonb or f = 'null'::jsonb then return 'true'; end if;
  if f ? 'rules' then
    joiner := case lower(coalesce(f->>'op','and')) when 'or' then ' or ' else ' and ' end;
    for r in select * from jsonb_array_elements(f->'rules') loop
      parts := parts || compile_filter(r);
    end loop;
    if array_length(parts, 1) is null then return 'true'; end if;
    return '(' || array_to_string(parts, joiner) || ')';
  end if;

  fld := f->>'field'; opr := f->>'operator'; v := f->'value';
  col := case fld
    when 'first_inquiry_at' then 'c.first_inquiry_at'
    when 'area_pref' then 'c.area_pref'
    when 'primary_source' then 'c.primary_source'
    when 'call_count' then 'c.call_count'
    when 'last_called_at' then 'c.last_called_at'
    when 'last_call_result' then 'c.last_call_result'
    when 'job_change_intent' then 'c.job_change_intent'
    when 'queue_state' then 'c.queue_state::text'
    when 'consent_status' then 'c.consent_status::text'
    when 'is_suppressed' then 'c.is_suppressed'
    when 'callable' then 'c.callable'
    when 'owner_user_id' then 'c.owner_user_id::text'
    when 'tags' then 'c.tags'
    when 'assigned_user' then '(select a.user_id::text from assignments a where a.contact_id = c.id and a.released_at is null)'
    when 'handled' then '(c.call_count > 0)'
    else null end;
  if col is null then raise exception 'INVALID_FILTER_FIELD: %', fld using errcode = '22023'; end if;

  sql := case opr
    when 'in' then format('%s = any(%L::text[])', col, (select coalesce(array_agg(x), '{}') from jsonb_array_elements_text(v) x))
    when 'not_in' then format('(%s is null or not (%s = any(%L::text[])))', col, col, (select coalesce(array_agg(x), '{}') from jsonb_array_elements_text(v) x))
    when 'eq' then format('%s = %L', col, v #>> '{}')
    when 'gte' then format('%s >= %L', col, v #>> '{}')
    when 'lte' then format('%s <= %L', col, v #>> '{}')
    when 'between' then format('(%s >= %L and %s < (%L::date + 1))', col, v->>0, col, v->>1)
    when 'older_than_days' then format('(%s is null or %s < now() - make_interval(days => %s))', col, col, (v #>> '{}')::int)
    when 'within_days' then format('%s >= now() - make_interval(days => %s)', col, (v #>> '{}')::int)
    when 'is_null' then format('%s is null', col)
    when 'not_null' then format('%s is not null', col)
    when 'contains_any' then format('%s && %L::text[]', col, (select coalesce(array_agg(x), '{}') from jsonb_array_elements_text(v) x))
    else null end;
  if sql is null then raise exception 'INVALID_FILTER_OPERATOR: %', opr using errcode = '22023'; end if;
  return sql;
end $$;

-- ---------- 顧客検索（RLS適用：security invoker） ----------
-- p: {q, phone, email, filter, sort: created_desc|inquiry_desc|last_called_desc|name_asc, cursor, limit}
create or replace function contacts_search(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path = public, extensions as $$
declare
  lim int := least(coalesce((p->>'limit')::int, 50), 200);
  q text := nullif(trim(p->>'q'), '');
  ph text := nullif(regexp_replace(coalesce(p->>'phone',''), '\D', '', 'g'), '');
  em text := nullif(lower(trim(p->>'email')), '');
  where_sql text := 'c.deleted_at is null and ' || compile_filter(p->'filter');
  order_sql text; cursor_sql text := 'true'; cur jsonb := case when p->>'cursor' is not null
     then convert_from(decode(p->>'cursor', 'base64'), 'utf8')::jsonb end;
  rows jsonb; est bigint;
begin
  if q is not null then
    where_sql := where_sql || format(' and (c.full_name ilike %L or (coalesce(c.last_name_kana,'''') || coalesce(c.first_name_kana,'''')) ilike %L)',
                                     '%' || q || '%', '%' || replace(q, ' ', '') || '%');
  end if;
  if ph is not null then
    -- 末尾一致を避け、正規化番号の部分一致（国内表記→E.164）
    where_sql := where_sql || format(' and exists(select 1 from contact_phones p where p.contact_id = c.id and p.phone_e164 like %L)',
                                     '%' || case when left(ph,1) = '0' then substr(ph, 2) else ph end || '%');
  end if;
  if em is not null then
    where_sql := where_sql || format(' and c.email_normalized like %L', em || '%');
  end if;

  case coalesce(p->>'sort','created_desc')
    when 'inquiry_desc' then
      order_sql := 'c.first_inquiry_at desc nulls last, c.id desc';
      if cur is not null then cursor_sql := format('(coalesce(c.first_inquiry_at, ''-infinity''), c.id) < (coalesce(%L::timestamptz, ''-infinity''), %L::uuid)', cur->>'k', cur->>'id'); end if;
    when 'last_called_desc' then
      order_sql := 'c.last_called_at desc nulls last, c.id desc';
      if cur is not null then cursor_sql := format('(coalesce(c.last_called_at, ''-infinity''), c.id) < (coalesce(%L::timestamptz, ''-infinity''), %L::uuid)', cur->>'k', cur->>'id'); end if;
    when 'name_asc' then
      order_sql := 'c.full_name asc, c.id asc';
      if cur is not null then cursor_sql := format('(c.full_name, c.id) > (%L, %L::uuid)', cur->>'k', cur->>'id'); end if;
    else
      order_sql := 'c.created_at desc, c.id desc';
      if cur is not null then cursor_sql := format('(c.created_at, c.id) < (%L::timestamptz, %L::uuid)', cur->>'k', cur->>'id'); end if;
  end case;

  execute format($q$
    select coalesce(jsonb_agg(row_to_json(t)), '[]') from (
      select c.id, c.full_name as name, c.area_pref, c.primary_source, c.consent_status, c.is_suppressed, c.callable,
             c.queue_state, c.call_count, c.last_called_at, c.last_call_result, c.next_call_at, c.first_inquiry_at,
             c.tags, c.created_at, c.job_change_intent,
             (select p.phone_e164 from contact_phones p where p.contact_id = c.id order by p.is_primary desc limit 1) as phone,
             (select u.name from assignments a join users u on u.id = a.user_id where a.contact_id = c.id and a.released_at is null) as assignee
      from contacts c where %s and %s order by %s limit %s) t $q$, where_sql, cursor_sql, order_sql, lim + 1)
  into rows;

  return jsonb_build_object(
    'rows', (select coalesce(jsonb_agg(e), '[]') from (select e from jsonb_array_elements(rows) with ordinality x(e, n) where n <= lim) s),
    'hasMore', jsonb_array_length(rows) > lim,
    'sort', coalesce(p->>'sort','created_desc'));
end $$;

-- 件数（概算可。正確件数は 200,000 件まで数える）
create or replace function contacts_count(p jsonb) returns bigint
language plpgsql stable security invoker set search_path = public, extensions as $$
declare n bigint;
begin
  execute 'select count(*) from (select 1 from contacts c where c.deleted_at is null and ' || compile_filter(p->'filter') || ' limit 1000000) s' into n;
  return n;
end $$;

-- ---------- 架電リスト ----------
create or replace function require_list_manager() returns uuid
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := require_user();
begin
  if not (is_manager() or has_role('team_leader')) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  return uid;
end $$;

-- 件数プレビュー（除外内訳つき）
create or replace function cl_preview(p_filter jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare res jsonb;
begin
  perform require_list_manager();
  execute format($q$
    select jsonb_build_object(
      'matched', count(*),
      'callable', count(*) filter (where c.callable and c.queue_state in ('new','recall')
                    and not exists(select 1 from assignments a where a.contact_id = c.id and a.released_at is null)
                    and not exists(select 1 from contact_locks l where l.contact_id = c.id and l.expires_at > now())),
      'excludedSuppressed', count(*) filter (where c.is_suppressed),
      'excludedConsent', count(*) filter (where not c.is_suppressed and c.consent_status <> 'granted'),
      'excludedInvalidPhone', count(*) filter (where not c.is_suppressed and c.consent_status = 'granted' and not c.has_valid_phone),
      'excludedClosed', count(*) filter (where c.callable and c.queue_state in ('closed','appointed')),
      'excludedAssigned', count(*) filter (where c.callable and c.queue_state in ('new','recall') and exists(select 1 from assignments a where a.contact_id = c.id and a.released_at is null)))
    from contacts c where c.deleted_at is null and %s $q$, compile_filter(p_filter)) into res;
  return res;
end $$;

-- リスト作成：条件に合致し「架電可能・未割当」の顧客のみメンバーにする
create or replace function cl_create(p_name text, p_filter jsonb, p_type text default 'static', p_team uuid default null,
                                     p_priority int default 100, p_description text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_list_manager(); lid uuid; n int;
begin
  if coalesce(trim(p_name),'') = '' then raise exception 'VALIDATION_ERROR: name' using errcode = '22023'; end if;
  if not is_manager() and (p_team is null or not (p_team = any(led_team_ids()))) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  insert into call_lists(name, description, type, filter_definition, team_id, priority, created_by)
  values (p_name, p_description, p_type, coalesce(p_filter, '{}'), p_team, p_priority, uid) returning id into lid;
  perform cl_refresh(lid);
  select member_count into n from call_lists where id = lid;
  perform write_audit('call_list.create', 'call_list', lid::text, jsonb_build_object('name', p_name, 'members', n, 'filter', p_filter));
  return lid;
end $$;

-- 動的リストの再評価（新規該当者を追加。既存メンバー・割当は維持）
create or replace function cl_refresh(p_list uuid) returns int
language plpgsql security definer set search_path = public as $$
declare l call_lists; added int;
begin
  perform require_list_manager();
  select * into l from call_lists where id = p_list;
  execute format($q$
    insert into call_list_members(call_list_id, contact_id)
    select %L, c.id from contacts c
    where c.deleted_at is null and c.callable and c.queue_state in ('new','recall') and %s
      and not exists(select 1 from assignments a where a.contact_id = c.id and a.released_at is null)
    on conflict do nothing $q$, p_list, compile_filter(l.filter_definition));
  get diagnostics added = row_count;
  update call_lists set member_count = (select count(*) from call_list_members where call_list_id = p_list and removed_at is null),
                        refreshed_at = now() where id = p_list;
  return added;
end $$;

create or replace function cl_set_status(p_list uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_list_manager();
  update call_lists set status = p_status where id = p_list;
  perform write_audit('call_list.status', 'call_list', p_list::text, jsonb_build_object('status', p_status));
end $$;

-- 担当者へ均等割当（未割当・架電可能・他者ロックなしのメンバーのみ）
create or replace function cl_assign_even(p_list uuid, p_users uuid[], p_max_per_user int default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_list_manager(); n int := coalesce(array_length(p_users,1),0); assigned int; res jsonb;
begin
  if n = 0 then raise exception 'VALIDATION_ERROR: users' using errcode = '22023'; end if;
  if not is_manager() and exists(select 1 from unnest(p_users) u where not (u = any(led_member_ids()))) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  with pool as (
    select m.contact_id, row_number() over (order by queue_rank(c), c.first_inquiry_at desc nulls last, c.id) - 1 as rn
    from call_list_members m join contacts c on c.id = m.contact_id
    where m.call_list_id = p_list and m.removed_at is null
      and c.callable and c.queue_state in ('new','recall')
      and not exists(select 1 from assignments a where a.contact_id = c.id and a.released_at is null)
      and not exists(select 1 from contact_locks l where l.contact_id = c.id and l.expires_at > now())
  ), picked as (
    select contact_id, p_users[(rn % n) + 1] as user_id from pool
    where p_max_per_user is null or rn < p_max_per_user * n
  ), ins as (
    insert into assignments(contact_id, user_id, call_list_id, assigned_by)
    select contact_id, user_id, p_list, uid from picked
    on conflict do nothing returning user_id
  )
  select jsonb_object_agg(user_id, cnt) into res from (select user_id, count(*) cnt from ins group by user_id) s;
  update contacts c set owner_user_id = a.user_id from assignments a
  where a.call_list_id = p_list and a.released_at is null and a.contact_id = c.id and c.owner_user_id is distinct from a.user_id;
  perform write_audit('call_list.assign', 'call_list', p_list::text, coalesce(res, '{}'));
  return coalesce(res, '{}');
end $$;

-- 担当者変更（個別・一括）
create or replace function contacts_reassign(p_contacts uuid[], p_user uuid) returns int
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_list_manager(); n int;
begin
  if not is_manager() and not (p_user = any(led_member_ids())) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  update assignments set released_at = now(), reason = 'reassigned' where contact_id = any(p_contacts) and released_at is null;
  insert into assignments(contact_id, user_id, assigned_by, reason)
  select id, p_user, uid, 'manual' from contacts where id = any(p_contacts) and callable;
  get diagnostics n = row_count;
  update contacts set owner_user_id = p_user where id = any(p_contacts) and callable;
  perform write_audit('contacts.reassign', 'contact', array_to_string(p_contacts, ','), jsonb_build_object('to', p_user, 'count', n));
  return n;
end $$;

create or replace function contacts_add_tag(p_contacts uuid[], p_tag text) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform require_list_manager();
  update contacts set tags = array(select distinct unnest(tags || array[p_tag])) where id = any(p_contacts);
  get diagnostics n = row_count;
  perform write_audit('contacts.tag', 'contact', null, jsonb_build_object('tag', p_tag, 'count', n));
  return n;
end $$;

-- ---------- 利用許諾・架電禁止 ----------
create or replace function consent_record(p_contact uuid, p_status consent_status, p_basis text, p_terms text default null, p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); cid uuid;
begin
  if not is_manager() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_status = 'granted' and coalesce(trim(p_basis),'') = '' then raise exception 'VALIDATION_ERROR: basis' using errcode = '22023'; end if;
  insert into consents(contact_id, status, basis, terms_version, recorded_by, note)
  values (p_contact, p_status, p_basis, p_terms, uid, p_note) returning id into cid;
  perform write_audit('consent.record', 'contact', p_contact::text, jsonb_build_object('status', p_status, 'basis', p_basis));
  return cid;
end $$;

-- 一括付与は管理者のみ
create or replace function consent_bulk_grant(p_filter jsonb, p_basis text, p_terms text, p_note text default null) returns int
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); n int;
begin
  if not is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if coalesce(trim(p_basis),'') = '' then raise exception 'VALIDATION_ERROR: basis' using errcode = '22023'; end if;
  execute format($q$
    insert into consents(contact_id, status, basis, terms_version, recorded_by, note)
    select c.id, 'granted', %L, %L, %L, %L from contacts c
    where c.deleted_at is null and c.consent_status = 'unknown' and not c.is_suppressed and %s $q$,
    p_basis, p_terms, uid, p_note, compile_filter(p_filter));
  get diagnostics n = row_count;
  perform write_audit('consent.bulk_grant', 'contact', null, jsonb_build_object('count', n, 'basis', p_basis, 'filter', p_filter));
  return n;
end $$;

create or replace function suppression_add(p_contact uuid, p_reason text, p_note text default null) returns int
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); n int;
begin
  if not can_view_contact(p_contact) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  insert into suppression_list(phone_hash, contact_id, reason, note, registered_by)
  select p.phone_hash, p_contact, p_reason, p_note, uid from contact_phones p where p.contact_id = p_contact
  on conflict do nothing;
  get diagnostics n = row_count;
  if n = 0 then
    insert into suppression_list(contact_id, reason, note, registered_by) values (p_contact, p_reason, p_note, uid);
  end if;
  perform write_audit('suppression.add', 'contact', p_contact::text, jsonb_build_object('reason', p_reason));
  return n;
end $$;

create or replace function suppression_release(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user();
begin
  if not is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if coalesce(trim(p_reason),'') = '' then raise exception 'VALIDATION_ERROR: reason' using errcode = '22023'; end if;
  update suppression_list set released_at = now(), released_by = uid, release_reason = p_reason where id = p_id and released_at is null;
  perform write_audit('suppression.release', 'suppression', p_id::text, jsonb_build_object('reason', p_reason));
end $$;

-- ---------- CSV出力（権限・件数上限・出力ログ） ----------
create or replace function contacts_export(p jsonb, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare uid uuid := require_user(); lim int := coalesce((rule('export_max_rows'))::text::int, 5000); rows jsonb; n int;
begin
  if not is_manager() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if coalesce(trim(p_reason),'') = '' then raise exception 'VALIDATION_ERROR: reason' using errcode = '22023'; end if;
  execute format($q$
    select coalesce(jsonb_agg(row_to_json(t)), '[]') from (
      select c.id, c.full_name as name, c.area_pref, c.primary_source, c.consent_status, c.queue_state, c.call_count,
             c.last_called_at, c.last_call_result, c.first_inquiry_at,
             (select p.phone_e164 from contact_phones p where p.contact_id = c.id order by p.is_primary desc limit 1) as phone
      from contacts c where c.deleted_at is null and %s order by c.created_at desc limit %s) t $q$,
      compile_filter(p->'filter'), lim + 1) into rows;
  n := jsonb_array_length(rows);
  if n > lim then return jsonb_build_object('error', 'TOO_MANY_ROWS', 'limit', lim); end if;
  insert into export_logs(actor_id, resource, filter, row_count, reason) values (uid, 'contacts', p, n, p_reason);
  perform write_audit('contacts.export', 'contact', null, jsonb_build_object('rows', n));
  return jsonb_build_object('rows', rows, 'count', n);
end $$;

-- ---------- アポイント ----------
create or replace function appt_update(p_id uuid, p_status appointment_status, p_scheduled_at timestamptz default null,
                                       p_note text default null, p_advisor uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); a appointments;
begin
  select * into a from appointments where id = p_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if not (is_manager() or a.advisor_user_id = uid or a.booked_by = uid or a.booked_by = any(led_member_ids())) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  update appointments set
    status = p_status,
    scheduled_at = coalesce(p_scheduled_at, scheduled_at),
    advisor_user_id = coalesce(p_advisor, advisor_user_id),
    done_at = case when p_status = 'done' then now() else done_at end,
    cancel_reason = case when p_status = 'canceled' then p_note else cancel_reason end,
    note = case when p_status <> 'canceled' and p_note is not null then p_note else note end
  where id = p_id;
  if p_advisor is not null and p_advisor is distinct from a.advisor_user_id then
    update handoffs set to_user_id = p_advisor where appointment_id = p_id;
    insert into notifications(user_id, kind, title, link) values (p_advisor, 'handoff', 'アポイントが引き継がれました', '/appointments/' || p_id);
  end if;
  if p_status = 'no_show' then
    insert into tasks(contact_id, assignee_id, type, title, due_at, related_type, related_id, created_by)
    values (a.contact_id, a.booked_by, 'reschedule', '面談未実施の再調整', now() + interval '1 day', 'appointment', p_id, uid);
  end if;
  perform write_audit('appointment.update', 'appointment', p_id::text, jsonb_build_object('status', p_status));
end $$;

-- ---------- KPI（docs/12 付録の定義。ロールで範囲を強制） ----------
-- p: {from:'YYYY-MM-DD', to:'YYYY-MM-DD', userId, teamId, listId, source}
create or replace function kpi_scope_users(p jsonb) returns uuid[]
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := require_user(); req uuid := nullif(p->>'userId','')::uuid; team uuid := nullif(p->>'teamId','')::uuid; ids uuid[];
begin
  if is_manager() or has_role('executive') then
    if req is not null then return array[req]; end if;
    if team is not null then return (select array_agg(user_id) from team_members where team_id = team); end if;
    return null;  -- 全体
  elsif has_role('team_leader') then
    ids := led_member_ids();
    if req is not null and req = any(ids) then return array[req]; end if;
    if team is not null and team = any(led_team_ids()) then return (select array_agg(user_id) from team_members where team_id = team); end if;
    return ids;
  else
    return array[uid];
  end if;
end $$;

create or replace function kpi_dashboard(p jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  users_scope uuid[] := kpi_scope_users(p);
  d_from timestamptz := ((coalesce(p->>'from', to_char(now() at time zone 'Asia/Tokyo','YYYY-MM-DD')))::date)::timestamp at time zone 'Asia/Tokyo';
  d_to timestamptz := ((coalesce(p->>'to', to_char(now() at time zone 'Asia/Tokyo','YYYY-MM-DD')))::date + 1)::timestamp at time zone 'Asia/Tokyo';
  span interval := d_to - d_from;
  list_id uuid := nullif(p->>'listId','')::uuid;
  src text := nullif(p->>'source','');
  gran text := coalesce(p->>'granularity', case when span > interval '62 days' then 'month' when span > interval '14 days' then 'week' else 'day' end);
  res jsonb;
  is_full boolean := is_manager() or has_role('executive');
begin
  with
  calls as (
    select cl.id, cl.started_at, cl.user_id, cl.contact_id, cl.call_list_id, cl.duration_sec, cl.answered_at
    from call_logs cl join contacts c on c.id = cl.contact_id
    where cl.started_at >= d_from - span and cl.started_at < d_to and cl.status <> 'canceled'
      and (users_scope is null or cl.user_id = any(users_scope))
      and (list_id is null or cl.call_list_id = list_id)
      and (src is null or c.primary_source = src)
  ),
  results as (
    select r.*, m.category from call_results r join call_result_masters m on m.code = r.result_code
    join contacts c on c.id = r.contact_id
    where r.call_started_at >= d_from - span and r.call_started_at < d_to
      and (users_scope is null or r.user_id = any(users_scope))
      and (list_id is null or r.call_list_id = list_id)
      and (src is null or c.primary_source = src)
  ),
  appts as (
    select a.* from appointments a join contacts c on c.id = a.contact_id
    where (users_scope is null or a.booked_by = any(users_scope) or a.advisor_user_id = any(users_scope))
      and (src is null or c.primary_source = src)
  ),
  cur as (
    select
      (select count(*) from calls where started_at >= d_from) as calls,
      (select count(distinct contact_id) from calls where started_at >= d_from) as unique_contacts,
      (select count(*) from results where call_started_at >= d_from and is_connected) as connects,
      (select count(*) from results where call_started_at >= d_from and result_code = 'appointment') as appointments,
      (select coalesce(sum(duration_sec),0) from calls where started_at >= d_from and answered_at is not null) as talk_sec,
      (select count(*) from calls where started_at >= d_from and answered_at is not null) as answered,
      (select count(*) from appts where scheduled_at >= d_from and scheduled_at < d_to and status <> 'canceled') as appt_target,
      (select count(*) from appts where scheduled_at >= d_from and scheduled_at < d_to and status = 'done') as appt_done,
      (select extract(epoch from sum(last - first)) / 3600.0 from (
         select user_id, (started_at at time zone 'Asia/Tokyo')::date d, min(started_at) first, max(started_at) last
         from calls where started_at >= d_from group by 1, 2) w) as work_hours
  ),
  prev as (
    select
      (select count(*) from calls where started_at < d_from) as calls,
      (select count(*) from results where call_started_at < d_from and is_connected) as connects,
      (select count(*) from results where call_started_at < d_from and result_code = 'appointment') as appointments
  )
  select jsonb_build_object(
    'range', jsonb_build_object('from', d_from, 'to', d_to, 'granularity', gran),
    'scope', case when users_scope is null then 'all' when array_length(users_scope,1) = 1 then 'user' else 'team' end,
    'totals', case when is_full then jsonb_build_object(
        'contacts', (select count(*) from contacts where deleted_at is null),
        'callable', (select count(*) from contacts where callable and deleted_at is null),
        'untouchedCallable', (select count(*) from contacts where callable and call_count = 0 and queue_state = 'new' and deleted_at is null))
      else jsonb_build_object(
        'contacts', null,
        'callable', (select count(*) from assignments a join contacts c on c.id = a.contact_id where a.released_at is null and a.user_id = any(users_scope) and c.callable),
        'untouchedCallable', (select count(*) from assignments a join contacts c on c.id = a.contact_id where a.released_at is null and a.user_id = any(users_scope) and c.callable and c.call_count = 0)) end,
    'current', (select to_jsonb(cur) from cur),
    'previous', (select to_jsonb(prev) from prev),
    'series', (select coalesce(jsonb_agg(jsonb_build_object('bucket', to_char(b, 'YYYY-MM-DD'), 'calls', coalesce(c.calls, 0),
                 'connects', coalesce(r.connects, 0), 'appointments', coalesce(r.appts, 0)) order by b), '[]')
        from (select date_trunc(gran, started_at at time zone 'Asia/Tokyo') b, count(*) calls from calls where started_at >= d_from group by 1) c
        full join (select date_trunc(gran, call_started_at at time zone 'Asia/Tokyo') b, count(*) filter (where is_connected) connects,
                          count(*) filter (where result_code = 'appointment') appts
                   from results where call_started_at >= d_from group by 1) r using (b)),
    'resultBreakdown', (select coalesce(jsonb_agg(jsonb_build_object('code', m.code, 'label', m.label, 'category', m.category, 'count', coalesce(n, 0)) order by m.sort_order), '[]')
        from call_result_masters m left join (select result_code, count(*) n from results where call_started_at >= d_from group by 1) r on r.result_code = m.code
        where m.code <> 'not_called'),
    'byHour', (select coalesce(jsonb_agg(jsonb_build_object('hour', h, 'calls', calls, 'connects', connects) order by h), '[]') from (
        select extract(hour from r.call_started_at at time zone 'Asia/Tokyo')::int h, count(*) calls, count(*) filter (where r.is_connected) connects
        from results r where r.call_started_at >= d_from and r.result_code <> 'not_called'
        group by 1) z),
    'byUser', (select coalesce(jsonb_agg(jsonb_build_object('userId', u.id, 'name', u.name, 'calls', calls, 'connects', connects, 'appointments', appts) order by appts desc, calls desc), '[]') from (
        select r.user_id, count(*) calls, count(*) filter (where r.is_connected) connects, count(*) filter (where r.result_code = 'appointment') appts
        from results r where r.call_started_at >= d_from group by 1) z join users u on u.id = z.user_id),
    'byTeam', (select coalesce(jsonb_agg(jsonb_build_object('teamId', t.id, 'name', t.name, 'calls', calls, 'connects', connects, 'appointments', appts) order by appts desc), '[]') from (
        select tm.team_id, count(*) calls, count(*) filter (where r.is_connected) connects, count(*) filter (where r.result_code = 'appointment') appts
        from results r join team_members tm on tm.user_id = r.user_id where r.call_started_at >= d_from group by 1) z join teams t on t.id = z.team_id),
    'byList', (select coalesce(jsonb_agg(jsonb_build_object('listId', l.id, 'name', l.name, 'calls', calls, 'connects', connects, 'appointments', appts) order by appts desc), '[]') from (
        select r.call_list_id, count(*) calls, count(*) filter (where r.is_connected) connects, count(*) filter (where r.result_code = 'appointment') appts
        from results r where r.call_started_at >= d_from and r.call_list_id is not null group by 1) z join call_lists l on l.id = z.call_list_id),
    'bySource', (select coalesce(jsonb_agg(jsonb_build_object('source', src2, 'calls', calls, 'connects', connects, 'appointments', appts) order by appts desc), '[]') from (
        select c.primary_source src2, count(*) calls, count(*) filter (where r.is_connected) connects, count(*) filter (where r.result_code = 'appointment') appts
        from results r join contacts c on c.id = r.contact_id where r.call_started_at >= d_from group by 1) z),
    'goals', (select coalesce(jsonb_object_agg(metric, total), '{}') from (
        select metric, sum(target_value) total from goals
        where period = to_char(d_from at time zone 'Asia/Tokyo', 'YYYY-MM')
          and ((users_scope is null and scope = 'org') or (users_scope is not null and scope = 'user' and user_id = any(users_scope)))
        group by metric) g)
  ) into res;
  return res;
end $$;

-- 引き継ぎの確認（面談担当者）
create or replace function handoff_ack(p_appointment uuid) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user();
begin
  update handoffs set acknowledged_at = now()
  where appointment_id = p_appointment and acknowledged_at is null
    and (to_user_id = uid or is_manager());
end $$;
