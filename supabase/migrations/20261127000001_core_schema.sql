-- =====================================================================
-- 人材CRM コアスキーマ（docs/05_er_diagram.md）
-- =====================================================================
create extension if not exists pg_trgm with schema extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------- 列挙型 ----------
create type app_role as enum ('admin','pm','team_leader','caller','career_advisor','executive');
create type consent_status as enum ('unknown','granted','denied','withdrawn');
create type queue_state as enum ('new','recall','appointed','closed');
create type call_status as enum ('initiating','ringing','in_progress','completed','failed','no_answer','busy','canceled');
create type appointment_status as enum ('scheduled','rescheduled','canceled','done','no_show');
create type appointment_method as enum ('online','phone','visit');
create type task_status as enum ('open','done','canceled');

-- ---------- 共通：updated_at ----------
create or replace function set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

-- ---------- 組織 ----------
create table teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  base_location text,
  parent_team_id uuid references teams(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  name text not null,
  email text not null unique,
  status text not null default 'active' check (status in ('active','suspended')),
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table user_roles (
  user_id uuid not null references users(id) on delete cascade,
  role app_role not null,
  primary key (user_id, role)
);

create table team_members (
  team_id uuid not null references teams(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  is_leader boolean not null default false,
  primary key (team_id, user_id)
);
create index on team_members(user_id);

-- ---------- 顧客 ----------
create table contacts (
  id uuid primary key default gen_random_uuid(),
  last_name text not null,
  first_name text not null default '',
  last_name_kana text,
  first_name_kana text,
  full_name text generated always as (last_name || ' ' || first_name) stored,
  email text,
  email_normalized text,
  area_pref text,
  area_city text,
  first_inquiry_at timestamptz,
  primary_source text not null default 'manual',   -- kintone / lp / manual
  source_detail text,                              -- LP名・媒体
  consent_status consent_status not null default 'unknown',
  is_suppressed boolean not null default false,
  has_valid_phone boolean not null default false,
  callable boolean not null default false,          -- トリガーで更新
  job_change_intent text,                           -- consult_wanted / yes / future / no
  tags text[] not null default '{}',
  owner_user_id uuid references users(id),
  queue_state queue_state not null default 'new',
  call_count integer not null default 0,
  no_answer_count integer not null default 0,
  last_called_at timestamptz,
  last_call_result text,
  next_call_at timestamptz,
  recall_block_until timestamptz,
  data_quality_flags text[] not null default '{}',
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index contacts_name_trgm on contacts using gin (full_name extensions.gin_trgm_ops);
create index contacts_kana_trgm on contacts using gin ((coalesce(last_name_kana,'') || coalesce(first_name_kana,'')) extensions.gin_trgm_ops);
create index contacts_email_idx on contacts(email_normalized);
create index contacts_callable_idx on contacts(callable, queue_state, next_call_at) where deleted_at is null;
create index contacts_owner_idx on contacts(owner_user_id, next_call_at);
create index contacts_inquiry_idx on contacts(first_inquiry_at);
create index contacts_source_idx on contacts(primary_source);
create index contacts_pref_idx on contacts(area_pref);
create index contacts_created_idx on contacts(created_at desc, id desc);
create trigger contacts_updated before update on contacts for each row execute function set_updated_at();

create table contact_phones (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references contacts(id) on delete cascade,
  phone_raw text,
  phone_e164 text not null,
  phone_hash text not null,
  type text not null default 'mobile',
  is_valid boolean not null default true,
  is_primary boolean not null default true,
  created_at timestamptz not null default now()
);
create index on contact_phones(contact_id);
create index on contact_phones(phone_e164);
create index on contact_phones(phone_hash);

create table contact_sources (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references contacts(id) on delete cascade,
  source_system text not null,
  source_app_id text not null default '',
  source_record_id text not null,
  source_updated_at timestamptz,
  raw_snapshot jsonb,
  utm jsonb,
  lp_id text,
  ad_media text,
  created_at timestamptz not null default now(),
  unique (source_system, source_app_id, source_record_id)
);
create index on contact_sources(contact_id);

create table consents (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references contacts(id) on delete cascade,
  purpose text not null default 'jinzai_sales',
  status consent_status not null,
  basis text,
  terms_version text,
  obtained_at timestamptz not null default now(),
  recorded_by uuid references users(id),
  note text,
  created_at timestamptz not null default now()
);
create index on consents(contact_id, obtained_at desc);

create table suppression_list (
  id uuid primary key default gen_random_uuid(),
  phone_hash text,
  email_hash text,
  contact_id uuid references contacts(id) on delete set null,
  reason text not null check (reason in ('refusal','complaint','legal','request','other')),
  note text,
  registered_by uuid references users(id),
  registered_at timestamptz not null default now(),
  expires_at timestamptz,
  released_at timestamptz,
  released_by uuid references users(id),
  release_reason text
);
create unique index suppression_phone_active on suppression_list(phone_hash) where released_at is null and phone_hash is not null;
create index on suppression_list(contact_id);

create table duplicate_candidates (
  id uuid primary key default gen_random_uuid(),
  contact_id_a uuid not null references contacts(id) on delete cascade,
  contact_id_b uuid not null references contacts(id) on delete cascade,
  match_keys text[] not null,
  score numeric not null default 0,
  status text not null default 'pending' check (status in ('pending','merged','not_duplicate')),
  reviewed_by uuid references users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  check (contact_id_a < contact_id_b),
  unique (contact_id_a, contact_id_b)
);

-- ---------- 設定・マスタ ----------
create table call_result_masters (
  code text primary key,
  label text not null,
  category text not null,          -- untouched / unreachable / progress / success / stop / review
  is_connected boolean not null default false,
  counts_as_dial boolean not null default true,
  required_fields text[] not null default '{}',
  optional_fields text[] not null default '{}',
  auto_action jsonb not null default '{}'::jsonb,
  shortcut_key text,
  sort_order integer not null,
  active boolean not null default true
);

create table call_rules (
  key text primary key,
  value jsonb not null,
  description text,
  updated_by uuid references users(id),
  updated_at timestamptz not null default now()
);

create table scripts (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  version integer not null default 1,
  active boolean not null default true,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table application_status_masters (
  code text primary key,
  label text not null,
  sort_order integer not null,
  is_terminal boolean not null default false
);

-- ---------- 架電リスト・割当 ----------
create table call_lists (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  type text not null default 'static' check (type in ('static','dynamic')),
  filter_definition jsonb not null default '{}'::jsonb,
  team_id uuid references teams(id),
  priority integer not null default 100,
  status text not null default 'active' check (status in ('active','paused','archived')),
  member_count integer not null default 0,
  refreshed_at timestamptz,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table call_list_members (
  call_list_id uuid not null references call_lists(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  added_at timestamptz not null default now(),
  removed_at timestamptz,
  primary key (call_list_id, contact_id)
);
create index on call_list_members(contact_id);

create table assignments (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references contacts(id) on delete cascade,
  user_id uuid not null references users(id),
  call_list_id uuid references call_lists(id) on delete set null,
  assigned_by uuid references users(id),
  assigned_at timestamptz not null default now(),
  released_at timestamptz,
  reason text
);
create unique index assignments_active_one on assignments(contact_id) where released_at is null;
create index assignments_user_active on assignments(user_id) where released_at is null;
create index on assignments(call_list_id) where released_at is null;

create table contact_locks (
  contact_id uuid primary key references contacts(id) on delete cascade,
  user_id uuid not null references users(id),
  acquired_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index on contact_locks(user_id);

-- ---------- 通話（月次パーティション） ----------
create table call_logs (
  id uuid not null default gen_random_uuid(),
  started_at timestamptz not null default now(),
  contact_id uuid not null references contacts(id),
  user_id uuid not null references users(id),
  call_list_id uuid references call_lists(id) on delete set null,
  script_id uuid references scripts(id) on delete set null,
  direction text not null default 'out' check (direction in ('out','in')),
  provider text not null default 'mock',
  provider_call_id text,
  phone_e164 text,
  status call_status not null default 'initiating',
  answered_at timestamptz,
  ended_at timestamptz,
  duration_sec integer,
  is_demo boolean not null default true,
  error_message text,
  primary key (id, started_at)
) partition by range (started_at);
create index on call_logs(user_id, started_at);
create index on call_logs(contact_id, started_at);
create index on call_logs(provider, provider_call_id);

-- 2024-01〜2028-12 の月次パーティション＋default
do $$
declare d date := date '2024-01-01';
begin
  while d < date '2029-01-01' loop
    execute format('create table call_logs_%s partition of call_logs for values from (%L) to (%L)',
      to_char(d,'YYYYMM'), d, (d + interval '1 month')::date);
    d := (d + interval '1 month')::date;
  end loop;
  execute 'create table call_logs_default partition of call_logs default';
end $$;

create table call_results (
  id uuid primary key default gen_random_uuid(),
  call_log_id uuid not null,
  call_started_at timestamptz not null,
  contact_id uuid not null references contacts(id),
  user_id uuid not null references users(id),
  call_list_id uuid,
  result_code text not null references call_result_masters(code),
  is_connected boolean not null,
  hearing jsonb not null default '{}'::jsonb,
  memo text,
  next_action_at timestamptz,
  saved_at timestamptz not null default now(),
  updated_at timestamptz,
  unique (call_log_id),
  foreign key (call_log_id, call_started_at) references call_logs(id, started_at)
);
create index on call_results(user_id, call_started_at);
create index on call_results(contact_id, saved_at desc);
create index on call_results(result_code, call_started_at);

create table call_recordings (
  id uuid primary key default gen_random_uuid(),
  call_log_id uuid not null unique,
  call_started_at timestamptz not null,
  storage_path text not null,
  duration_sec integer,
  consent_announced boolean not null default false,
  retention_until date,
  created_at timestamptz not null default now(),
  foreign key (call_log_id, call_started_at) references call_logs(id, started_at)
);

create table call_drafts (
  user_id uuid not null references users(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, contact_id)
);

create table idempotency_keys (
  key text primary key,
  user_id uuid not null references users(id),
  scope text not null,
  response jsonb,
  created_at timestamptz not null default now()
);

-- ---------- アポイント・タスク ----------
create table appointments (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references contacts(id),
  origin_call_log_id uuid,
  booked_by uuid references users(id),
  advisor_user_id uuid references users(id),
  scheduled_at timestamptz not null,
  method appointment_method not null default 'phone',
  meeting_url text,
  status appointment_status not null default 'scheduled',
  done_at timestamptz,
  cancel_reason text,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on appointments(advisor_user_id, scheduled_at);
create index on appointments(booked_by, created_at);
create index on appointments(scheduled_at);
create index on appointments(contact_id);
create trigger appointments_updated before update on appointments for each row execute function set_updated_at();

create table handoffs (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null unique references appointments(id) on delete cascade,
  snapshot jsonb not null,
  from_user_id uuid references users(id),
  to_user_id uuid references users(id),
  acknowledged_at timestamptz,
  created_at timestamptz not null default now()
);

create table tasks (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid references contacts(id) on delete cascade,
  assignee_id uuid references users(id),
  type text not null default 'general',
  title text not null,
  description text,
  due_at timestamptz,
  status task_status not null default 'open',
  related_type text,
  related_id uuid,
  created_by uuid references users(id),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
create index on tasks(assignee_id, status, due_at);
create index on tasks(contact_id);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index on notifications(user_id, read_at, created_at desc);

-- ---------- 人材事業（Phase 3 で画面化） ----------
create table candidates (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null unique references contacts(id),
  intent_confirmed_at timestamptz not null,
  confirmed_by uuid references users(id),
  advisor_user_id uuid references users(id),
  desired_job text,
  desired_timing text,
  current_status text references application_status_masters(code),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table interviews (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references candidates(id) on delete cascade,
  appointment_id uuid references appointments(id),
  advisor_user_id uuid references users(id),
  held_at timestamptz not null,
  summary text,
  next_step text,
  created_at timestamptz not null default now()
);

create table companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  industry text,
  contact_person text,
  fee_rate numeric,
  refund_policy jsonb,
  created_at timestamptz not null default now()
);

create table jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  title text not null,
  location text,
  salary_min integer,
  salary_max integer,
  fee_rate numeric,
  status text not null default 'open',
  created_at timestamptz not null default now()
);

create table applications (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references candidates(id) on delete cascade,
  job_id uuid not null references jobs(id),
  status text not null references application_status_masters(code),
  status_changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (candidate_id, job_id)
);

create table application_status_history (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references applications(id) on delete cascade,
  from_status text,
  to_status text not null,
  changed_by uuid references users(id),
  changed_at timestamptz not null default now()
);

create table placements (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null unique references applications(id),
  offer_accepted_at timestamptz,
  join_date date,
  fee_amount integer,
  refund_deadline date,
  created_at timestamptz not null default now()
);

create table revenues (
  id uuid primary key default gen_random_uuid(),
  placement_id uuid not null references placements(id),
  amount integer not null,
  status text not null check (status in ('forecast','confirmed','invoiced','paid','refunded')),
  confirmed_at timestamptz,
  due_date date,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------- 目標・連携・ログ ----------
create table goals (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('user','team','org')),
  user_id uuid references users(id) on delete cascade,
  team_id uuid references teams(id) on delete cascade,
  period text not null,             -- YYYY-MM
  metric text not null,             -- calls / connects / appointments / revenue
  target_value numeric not null,
  updated_by uuid references users(id),
  updated_at timestamptz not null default now()
);
create unique index goals_unique on goals(scope, coalesce(user_id,'00000000-0000-0000-0000-000000000000'), coalesce(team_id,'00000000-0000-0000-0000-000000000000'), period, metric);

create table integration_settings (
  service text primary key,
  mode text not null default 'mock' check (mode in ('mock','live')),
  config jsonb not null default '{}'::jsonb,
  updated_by uuid references users(id),
  updated_at timestamptz not null default now()
);

create table field_mappings (
  id uuid primary key default gen_random_uuid(),
  source_app_id text not null,
  source_field text not null,
  target_field text,
  transform text,
  allowed boolean not null default true,
  unique (source_app_id, source_field)
);

create table sync_jobs (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('full','delta','manual')),
  status text not null default 'queued',
  cursor_id text,
  last_source_updated_at timestamptz,
  total integer, processed integer default 0, inserted integer default 0,
  updated integer default 0, skipped integer default 0, error_count integer default 0,
  started_at timestamptz, finished_at timestamptz,
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);

create table sync_errors (
  id uuid primary key default gen_random_uuid(),
  sync_job_id uuid not null references sync_jobs(id) on delete cascade,
  source_record_id text,
  error_code text,
  message text,
  retry_count integer not null default 0,
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);

create table webhook_events (
  provider text not null,
  event_id text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  primary key (provider, event_id)
);

create table audit_logs (
  id uuid not null default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  actor_id uuid,
  action text not null,
  target_type text,
  target_id text,
  diff jsonb,
  ip text,
  user_agent text,
  primary key (id, occurred_at)
) partition by range (occurred_at);
create index on audit_logs(actor_id, occurred_at);
create index on audit_logs(target_type, target_id);
do $$
declare d date := date '2025-01-01';
begin
  while d < date '2029-01-01' loop
    execute format('create table audit_logs_%s partition of audit_logs for values from (%L) to (%L)',
      to_char(d,'YYYYMM'), d, (d + interval '1 month')::date);
    d := (d + interval '1 month')::date;
  end loop;
  execute 'create table audit_logs_default partition of audit_logs default';
end $$;

create table export_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references users(id),
  resource text not null,
  filter jsonb,
  row_count integer not null,
  reason text not null,
  exported_at timestamptz not null default now()
);

create table login_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id),
  event text not null,
  ip text,
  user_agent text,
  occurred_at timestamptz not null default now()
);
create index on login_history(user_id, occurred_at desc);

create table saved_searches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  params jsonb not null,
  created_at timestamptz not null default now()
);
