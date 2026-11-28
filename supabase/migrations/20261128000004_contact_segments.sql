-- 顧客分析（性別・年代・居住地の集計）。社長指示 2026-11-28。
-- ・出身地（本籍・出生地）は職業安定法の指針で収集禁止のため持たない。居住地（area_pref/area_city）で分析する。
-- ・性別・生年は市場把握の集計用。個別の求人紹介は本人の希望・経験で行う（年齢・性別での絞り込みには使わない）。
-- ・集計 RPC は人数のみを返し、氏名・連絡先は返さない。閲覧は管理者・PM・経営陣。

alter table contacts
  add column gender text check (gender in ('male', 'female', 'other')),
  add column birth_date date,
  add column birth_year int check (birth_year between 1900 and 2100);

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
    case when r.gender in ('male', 'female', 'other') then r.gender end as gender,
    case when r."birthDate" between date '1900-01-01' and current_date then r."birthDate" end as birth_date,
    case when r."birthYear" between 1900 and extract(year from current_date)::int then r."birthYear" end as birth_year,
    null::uuid as contact_id,
    false as is_new
  from jsonb_to_recordset(p_rows) as r("recordId" text, "lastName" text, "firstName" text, "lastKana" text, "firstKana" text,
       phones jsonb, email text, pref text, city text, "inquiredAt" timestamptz, "sourceDetail" text, consent text,
       gender text, "birthDate" date, "birthYear" int)
  where coalesce(trim(r."recordId"), '') <> '' and coalesce(trim(r."lastName"), '') <> ''
  order by r."recordId";

  -- 既存（同じ kintone アプリ・レコード番号）を特定
  update _imp i set contact_id = s.contact_id
  from contact_sources s
  where s.source_system = 'kintone' and s.source_app_id = j.source_app_id and s.source_record_id = i.record_id;
  update _imp set contact_id = gen_random_uuid(), is_new = true where contact_id is null;

  -- 新規：利用許諾は未確認（架電不可）で登録
  insert into contacts(id, last_name, first_name, last_name_kana, first_name_kana, email, area_pref, area_city,
                       first_inquiry_at, primary_source, source_detail, gender, birth_date, birth_year)
  select contact_id, last_name, first_name, last_kana, first_kana, email, pref, city, inquired_at, 'kintone', source_detail,
         gender, birth_date, coalesce(extract(year from birth_date)::int, birth_year)
  from _imp where is_new;
  get diagnostics v_ins = row_count;
  insert into contact_sources(contact_id, source_system, source_app_id, source_record_id)
  select contact_id, 'kintone', j.source_app_id, record_id from _imp where is_new;

  -- 既存：属性のみ更新（許諾・キュー・担当・削除状態は変えない）
  update contacts c set last_name = i.last_name, first_name = i.first_name,
    last_name_kana = coalesce(i.last_kana, c.last_name_kana), first_name_kana = coalesce(i.first_kana, c.first_name_kana),
    email = coalesce(i.email, c.email), area_pref = coalesce(i.pref, c.area_pref), area_city = coalesce(i.city, c.area_city),
    first_inquiry_at = coalesce(c.first_inquiry_at, i.inquired_at), source_detail = coalesce(i.source_detail, c.source_detail),
    gender = coalesce(i.gender, c.gender), birth_date = coalesce(i.birth_date, c.birth_date),
    birth_year = coalesce(extract(year from i.birth_date)::int, i.birth_year, c.birth_year)
  from _imp i where c.id = i.contact_id and not i.is_new
    and (c.last_name, c.first_name, c.last_name_kana, c.first_name_kana, c.email, c.area_pref, c.area_city, c.source_detail,
         c.gender, c.birth_date, c.birth_year)
        is distinct from (i.last_name, i.first_name, coalesce(i.last_kana, c.last_name_kana), coalesce(i.first_kana, c.first_name_kana),
        coalesce(i.email, c.email), coalesce(i.pref, c.area_pref), coalesce(i.city, c.area_city), coalesce(i.source_detail, c.source_detail),
        coalesce(i.gender, c.gender), coalesce(i.birth_date, c.birth_date),
        coalesce(extract(year from i.birth_date)::int, i.birth_year, c.birth_year));
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

-- 性別 × 年代 × 都道府県 の人数と架電成果（人数のみ）
create or replace function contact_segments(p_callable_only boolean default false)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare res jsonb;
begin
  if not (has_role('admin') or has_role('pm') or has_role('executive')) then raise exception 'FORBIDDEN'; end if;
  -- 年代は今日（JST）時点。生年月日がなければ生まれ年から概算。25 万件で 1 秒以内に収まるよう関数を使わず直接計算する
  with t as (
    select (now() at time zone 'Asia/Tokyo')::date as d
  ), cr as (
    select contact_id, bool_or(is_connected) as connected from call_results group by contact_id
  ), ap as (
    select distinct contact_id from appointments
  ), base as (
    select coalesce(c.gender, 'unknown') as g,
           case when x.a is null then 'unknown' when x.a < 20 then 'u20' when x.a < 30 then '20s' when x.a < 40 then '30s'
                when x.a < 50 then '40s' when x.a < 60 then '50s' else '60p' end as a,
           coalesce(c.area_pref, '不明') as p,
           c.callable, cr.contact_id is not null as called, coalesce(cr.connected, false) as connected, ap.contact_id is not null as appt
    from t cross join contacts c
    cross join lateral (select coalesce(extract(year from age(t.d, c.birth_date))::int, extract(year from t.d)::int - c.birth_year) as a) x
    left join cr on cr.contact_id = c.id
    left join ap on ap.contact_id = c.id
    where c.deleted_at is null and (not p_callable_only or c.callable)
  )
  select coalesce(jsonb_agg(jsonb_build_object('gender', g, 'age', a, 'pref', p, 'n', n, 'callable', callable,
                                               'called', called, 'connected', connected, 'appointments', appt)), '[]'::jsonb)
  into res
  from (select g, a, p, count(*) n, count(*) filter (where callable) callable, count(*) filter (where called) called,
               count(*) filter (where connected) connected, count(*) filter (where appt) appt
        from base group by g, a, p) s;
  return res;
end $$;

revoke all on function contact_segments(boolean) from public, anon;
grant execute on function contact_segments(boolean) to authenticated;
