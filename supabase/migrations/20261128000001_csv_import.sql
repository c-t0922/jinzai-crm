-- =====================================================================
-- 顧客 CSV 取り込み（kintone から出力した CSV を管理画面から投入する）
--  * 管理者のみ。ブラウザで正規化した行を 1,000 件前後ずつ送る。
--  * kintone のレコード番号で冪等（同じ CSV を再投入しても二重登録しない）。
--  * 利用許諾は初期値「未確認」＝架電不可。許諾列を対応付け、根拠を記録した場合のみ反映する。
--  * 電話・メール一致は重複候補として登録するだけで統合しない。
--  * 元データ（raw_snapshot）は保存しない。エラーにはレコード番号とコードのみ残す。
-- =====================================================================

alter table sync_jobs add column if not exists source text not null default 'kintone_api';
alter table sync_jobs add column if not exists source_app_id text;
alter table sync_jobs add column if not exists consent_basis text;
alter table sync_jobs add column if not exists consent_granted integer not null default 0;
alter table sync_jobs add column if not exists consent_denied integer not null default 0;
alter table sync_jobs add column if not exists duplicate_candidates integer not null default 0;

create or replace function import_start(p_app text, p_total int, p_consent_basis text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not is_admin() then raise exception 'FORBIDDEN'; end if;
  if coalesce(trim(p_app), '') = '' or p_total is null or p_total < 0 then raise exception 'VALIDATION'; end if;
  insert into sync_jobs(type, status, source, source_app_id, total, consent_basis, started_at, created_by)
  values ('manual', 'running', 'csv', trim(p_app), p_total, nullif(trim(coalesce(p_consent_basis, '')), ''), now(), app_user_id())
  returning id into v_id;
  perform write_audit('import:start', 'sync_jobs', v_id::text,
    jsonb_build_object('app', trim(p_app), 'total', p_total, 'consent_mapped', p_consent_basis is not null));
  return v_id;
end $$;

create or replace function import_contacts(p_job uuid, p_rows jsonb, p_errors jsonb default '[]')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  j sync_jobs;
  v_ins int; v_upd int; v_grant int; v_deny int; v_dup int; v_err int;
begin
  if not is_admin() then raise exception 'FORBIDDEN'; end if;
  select * into j from sync_jobs where id = p_job for update;
  if j.id is null or j.source <> 'csv' then raise exception 'NOT_FOUND'; end if;
  if j.status <> 'running' then raise exception 'JOB_CLOSED'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 2000 then raise exception 'VALIDATION'; end if;

  drop table if exists _imp, _ph;
  create temp table _imp on commit drop as
  select distinct on (r."recordId")
    left(trim(r."recordId"), 64) as record_id,
    left(trim(r."lastName"), 50) as last_name,
    left(coalesce(trim(r."firstName"), ''), 50) as first_name,
    left(nullif(trim(r."lastKana"), ''), 50) as last_kana,
    left(nullif(trim(r."firstKana"), ''), 50) as first_kana,
    coalesce(r.phones, '[]'::jsonb) as phones,
    lower(nullif(trim(r.email), '')) as email,
    left(nullif(trim(r.pref), ''), 10) as pref,
    left(nullif(trim(r.city), ''), 100) as city,
    r."inquiredAt" as inquired_at,
    left(nullif(trim(r."sourceDetail"), ''), 100) as source_detail,
    case when r.consent in ('granted', 'denied') then r.consent end as consent,
    null::uuid as contact_id,
    false as is_new
  from jsonb_to_recordset(p_rows) as r("recordId" text, "lastName" text, "firstName" text, "lastKana" text, "firstKana" text,
       phones jsonb, email text, pref text, city text, "inquiredAt" timestamptz, "sourceDetail" text, consent text)
  where coalesce(trim(r."recordId"), '') <> '' and coalesce(trim(r."lastName"), '') <> ''
  order by r."recordId";

  -- 既存（同じ kintone アプリ・レコード番号）を特定
  update _imp i set contact_id = s.contact_id
  from contact_sources s
  where s.source_system = 'kintone' and s.source_app_id = j.source_app_id and s.source_record_id = i.record_id;
  update _imp set contact_id = gen_random_uuid(), is_new = true where contact_id is null;

  -- 新規：利用許諾は未確認（架電不可）で登録
  insert into contacts(id, last_name, first_name, last_name_kana, first_name_kana, email, area_pref, area_city,
                       first_inquiry_at, primary_source, source_detail)
  select contact_id, last_name, first_name, last_kana, first_kana, email, pref, city, inquired_at, 'kintone', source_detail
  from _imp where is_new;
  get diagnostics v_ins = row_count;
  insert into contact_sources(contact_id, source_system, source_app_id, source_record_id)
  select contact_id, 'kintone', j.source_app_id, record_id from _imp where is_new;

  -- 既存：属性のみ更新（許諾・キュー・担当・削除状態は変えない）
  update contacts c set last_name = i.last_name, first_name = i.first_name,
    last_name_kana = coalesce(i.last_kana, c.last_name_kana), first_name_kana = coalesce(i.first_kana, c.first_name_kana),
    email = coalesce(i.email, c.email), area_pref = coalesce(i.pref, c.area_pref), area_city = coalesce(i.city, c.area_city),
    first_inquiry_at = coalesce(c.first_inquiry_at, i.inquired_at), source_detail = coalesce(i.source_detail, c.source_detail)
  from _imp i where c.id = i.contact_id and not i.is_new
    and (c.last_name, c.first_name, c.last_name_kana, c.first_name_kana, c.email, c.area_pref, c.area_city, c.source_detail)
        is distinct from (i.last_name, i.first_name, coalesce(i.last_kana, c.last_name_kana), coalesce(i.first_kana, c.first_name_kana),
        coalesce(i.email, c.email), coalesce(i.pref, c.area_pref), coalesce(i.city, c.area_city), coalesce(i.source_detail, c.source_detail));
  get diagnostics v_upd = row_count;

  -- 電話番号（未登録のものだけ追加。E.164 の形式を DB でも検証）
  create temp table _ph on commit drop as
  select i.contact_id, p.value #>> '{}' as e164, p.ordinality as ord
  from _imp i cross join lateral jsonb_array_elements(i.phones) with ordinality p
  where jsonb_typeof(p.value) = 'string' and (p.value #>> '{}') ~ '^\+81[1-9][0-9]{8,9}$' and p.ordinality <= 3;
  insert into contact_phones(contact_id, phone_e164, type, is_primary)
  select ph.contact_id, ph.e164,
         case when ph.e164 ~ '^\+81[789]0' then 'mobile' else 'landline' end,
         ph.ord = 1 and not exists(select 1 from contact_phones x where x.contact_id = ph.contact_id)
  from _ph ph
  where not exists(select 1 from contact_phones x where x.contact_id = ph.contact_id and x.phone_e164 = ph.e164);

  -- 重複候補（電話・メール一致。自動統合はしない）
  with pairs as (
    select least(ph.contact_id, x.contact_id) a, greatest(ph.contact_id, x.contact_id) b, 'phone' k
    from _ph ph join contact_phones x on x.phone_hash = phone_hash(ph.e164) and x.contact_id <> ph.contact_id
    union all
    select least(i.contact_id, c.id), greatest(i.contact_id, c.id), 'email'
    from _imp i join contacts c on c.email_normalized = i.email and c.id <> i.contact_id and c.deleted_at is null
    where i.email is not null
  ), agg as (select a, b, array_agg(distinct k) keys from pairs group by a, b)
  insert into duplicate_candidates(contact_id_a, contact_id_b, match_keys, score)
  select a, b, keys, cardinality(keys) * 0.5 from agg
  on conflict (contact_id_a, contact_id_b) do nothing;
  get diagnostics v_dup = row_count;

  -- 利用許諾：根拠が記録されている取り込みのみ。
  --  拒否は常に反映（安全側）。許諾は「未確認」の顧客にだけ反映し、拒否・撤回済みを復活させない。
  if j.consent_basis is not null then
    insert into consents(contact_id, status, basis, recorded_by, note)
    select i.contact_id, 'denied', j.consent_basis, app_user_id(), 'CSV取り込み ' || p_job::text
    from _imp i join contacts c on c.id = i.contact_id
    where i.consent = 'denied' and c.consent_status not in ('denied', 'withdrawn');
    get diagnostics v_deny = row_count;
    insert into consents(contact_id, status, basis, recorded_by, note)
    select i.contact_id, 'granted', j.consent_basis, app_user_id(), 'CSV取り込み ' || p_job::text
    from _imp i join contacts c on c.id = i.contact_id
    where i.consent = 'granted' and c.consent_status = 'unknown';
    get diagnostics v_grant = row_count;
  else
    v_deny := 0; v_grant := 0;
  end if;

  -- 変換エラー（レコード番号とコードのみ）
  insert into sync_errors(sync_job_id, source_record_id, error_code, message)
  select p_job, left(e->>'recordId', 64), left(coalesce(e->>'code', 'invalid'), 40), left(e->>'message', 100)
  from jsonb_array_elements(case when jsonb_typeof(p_errors) = 'array' then p_errors else '[]' end) e
  limit 2000;
  get diagnostics v_err = row_count;

  update sync_jobs set
    processed = coalesce(processed, 0) + jsonb_array_length(p_rows) + v_err,
    inserted = coalesce(inserted, 0) + v_ins,
    updated = coalesce(updated, 0) + v_upd,
    skipped = coalesce(skipped, 0) + (select count(*) from _imp where not is_new) - v_upd,
    error_count = coalesce(error_count, 0) + v_err,
    consent_granted = consent_granted + v_grant,
    consent_denied = consent_denied + v_deny,
    duplicate_candidates = sync_jobs.duplicate_candidates + v_dup
  where id = p_job;

  return jsonb_build_object('inserted', v_ins, 'updated', v_upd, 'granted', v_grant, 'denied', v_deny,
                            'duplicates', v_dup, 'errors', v_err);
end $$;

create or replace function import_finish(p_job uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare j sync_jobs;
begin
  if not is_admin() then raise exception 'FORBIDDEN'; end if;
  if p_status not in ('completed', 'canceled', 'failed') then raise exception 'VALIDATION'; end if;
  update sync_jobs set status = p_status, finished_at = now()
  where id = p_job and source = 'csv' and status = 'running' returning * into j;
  if j.id is null then raise exception 'NOT_FOUND'; end if;
  perform write_audit('import:' || p_status, 'sync_jobs', p_job::text, jsonb_build_object(
    'processed', j.processed, 'inserted', j.inserted, 'updated', j.updated, 'errors', j.error_count,
    'consent_granted', j.consent_granted, 'consent_denied', j.consent_denied, 'duplicates', j.duplicate_candidates));
end $$;

revoke all on function import_start(text, int, text) from public, anon;
revoke all on function import_contacts(uuid, jsonb, jsonb) from public, anon;
revoke all on function import_finish(uuid, text) from public, anon;
grant execute on function import_start(text, int, text) to authenticated;
grant execute on function import_contacts(uuid, jsonb, jsonb) to authenticated;
grant execute on function import_finish(uuid, text) to authenticated;
