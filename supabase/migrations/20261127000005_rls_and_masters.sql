-- =====================================================================
-- Row Level Security（docs/06_permission_matrix.md）
-- 方針：参照は RLS、更新は原則 security definer の RPC 経由（関数内で権限確認）
-- =====================================================================
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- 匿名ロールには一切許可しない
revoke all on all tables in schema public from anon;
revoke execute on all functions in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke execute on functions from anon;

-- 組織・マスタ（ログインユーザーは参照可、更新は管理者）
create policy users_select on users for select to authenticated using (true);
create policy users_admin on users for all to authenticated using ((select is_admin())) with check ((select is_admin()));
create policy user_roles_select on user_roles for select to authenticated using (true);
create policy user_roles_admin on user_roles for all to authenticated using ((select is_admin())) with check ((select is_admin()));
create policy teams_select on teams for select to authenticated using (true);
create policy teams_manage on teams for all to authenticated using ((select is_manager())) with check ((select is_manager()));
create policy team_members_select on team_members for select to authenticated using (true);
create policy team_members_manage on team_members for all to authenticated using ((select is_manager())) with check ((select is_manager()));

create policy crm_select on call_result_masters for select to authenticated using (true);
create policy crm_admin on call_result_masters for all to authenticated using ((select is_admin())) with check ((select is_admin()));
create policy rules_select on call_rules for select to authenticated using (true);
create policy rules_admin on call_rules for all to authenticated using ((select is_admin())) with check ((select is_admin()));
create policy scripts_select on scripts for select to authenticated using (true);
create policy scripts_manage on scripts for all to authenticated using ((select is_manager())) with check ((select is_manager()));
create policy asm_select on application_status_masters for select to authenticated using (true);
create policy goals_select on goals for select to authenticated using (true);
create policy goals_manage on goals for all to authenticated using ((select is_manager())) with check ((select is_manager()));

-- 顧客：管理者/PM は全件、TL はチームの割当分、担当者は自分の割当分、CA は引継ぎ分。経営陣は個人情報を見ない
create policy contacts_select on contacts for select to authenticated using (
  (select is_manager())
  or exists(select 1 from assignments a where a.contact_id = contacts.id and a.released_at is null
            and (a.user_id = (select app_user_id()) or a.user_id = any(coalesce((select led_member_ids()), '{}'::uuid[]))))
  or exists(select 1 from appointments ap where ap.contact_id = contacts.id
            and (ap.advisor_user_id = (select app_user_id()) or ap.booked_by = (select app_user_id())))
);
create policy contacts_update on contacts for update to authenticated using ((select is_manager())) with check ((select is_manager()));

create policy contact_phones_select on contact_phones for select to authenticated using (
  exists(select 1 from contacts c where c.id = contact_phones.contact_id));
create policy contact_sources_select on contact_sources for select to authenticated using (
  exists(select 1 from contacts c where c.id = contact_sources.contact_id));
create policy consents_select on consents for select to authenticated using (
  exists(select 1 from contacts c where c.id = consents.contact_id));
create policy duplicates_select on duplicate_candidates for select to authenticated using ((select is_manager()));
create policy suppression_select on suppression_list for select to authenticated using ((select is_manager()) or (select has_role('team_leader')));

-- 架電
create policy call_lists_select on call_lists for select to authenticated using (
  (select is_manager()) or team_id = any(coalesce((select led_team_ids()), '{}'::uuid[]))
  or exists(select 1 from assignments a where a.call_list_id = call_lists.id and a.user_id = (select app_user_id()) and a.released_at is null));
create policy clm_select on call_list_members for select to authenticated using (
  exists(select 1 from call_lists l where l.id = call_list_members.call_list_id));
create policy assignments_select on assignments for select to authenticated using (
  (select is_manager()) or user_id = (select app_user_id()) or user_id = any(coalesce((select led_member_ids()), '{}'::uuid[])));
create policy locks_select on contact_locks for select to authenticated using (true);

create policy call_logs_select on call_logs for select to authenticated using (
  (select is_manager()) or user_id = (select app_user_id()) or user_id = any(coalesce((select led_member_ids()), '{}'::uuid[])));
create policy call_results_select on call_results for select to authenticated using (
  (select is_manager()) or user_id = (select app_user_id()) or user_id = any(coalesce((select led_member_ids()), '{}'::uuid[]))
  or exists(select 1 from appointments ap where ap.contact_id = call_results.contact_id and ap.advisor_user_id = (select app_user_id())));
create policy recordings_select on call_recordings for select to authenticated using (
  exists(select 1 from call_logs cl where cl.id = call_recordings.call_log_id));
create policy drafts_own on call_drafts for select to authenticated using (user_id = (select app_user_id()));

-- アポ・タスク・通知
create policy appointments_select on appointments for select to authenticated using (
  (select is_manager()) or advisor_user_id = (select app_user_id()) or booked_by = (select app_user_id())
  or booked_by = any(coalesce((select led_member_ids()), '{}'::uuid[])));
create policy handoffs_select on handoffs for select to authenticated using (
  exists(select 1 from appointments a where a.id = handoffs.appointment_id));
create policy tasks_select on tasks for select to authenticated using (
  (select is_manager()) or assignee_id = (select app_user_id()) or created_by = (select app_user_id()));
create policy tasks_update_own on tasks for update to authenticated
  using ((select is_manager()) or assignee_id = (select app_user_id()))
  with check ((select is_manager()) or assignee_id = (select app_user_id()));
create policy tasks_insert on tasks for insert to authenticated with check (created_by = (select app_user_id()));
create policy notifications_own on notifications for select to authenticated using (user_id = (select app_user_id()));
create policy notifications_read on notifications for update to authenticated
  using (user_id = (select app_user_id())) with check (user_id = (select app_user_id()));

-- 人材事業（CA・PM・管理者）
create policy candidates_select on candidates for select to authenticated using (
  (select is_manager()) or advisor_user_id = (select app_user_id()));
create policy interviews_select on interviews for select to authenticated using (
  (select is_manager()) or advisor_user_id = (select app_user_id()));
create policy companies_select on companies for select to authenticated using ((select is_manager()) or (select has_role('career_advisor')));
create policy jobs_select on jobs for select to authenticated using ((select is_manager()) or (select has_role('career_advisor')));
create policy applications_select on applications for select to authenticated using (
  exists(select 1 from candidates c where c.id = applications.candidate_id));
create policy ash_select on application_status_history for select to authenticated using (
  exists(select 1 from applications a where a.id = application_status_history.application_id));
create policy placements_select on placements for select to authenticated using ((select is_manager()) or (select has_role('executive')));
create policy revenues_select on revenues for select to authenticated using ((select is_manager()) or (select has_role('executive')));

-- 連携・ログ（管理者のみ。ログは追記専用：更新・削除ポリシーなし）
create policy integ_admin on integration_settings for select to authenticated using ((select is_admin()));
create policy mappings_admin on field_mappings for select to authenticated using ((select is_admin()));
create policy sync_jobs_admin on sync_jobs for select to authenticated using ((select is_admin()));
create policy sync_errors_admin on sync_errors for select to authenticated using ((select is_admin()));
create policy audit_select on audit_logs for select to authenticated using ((select is_manager()));
create policy export_logs_select on export_logs for select to authenticated using ((select is_manager()));
create policy login_history_select on login_history for select to authenticated using ((select is_admin()) or user_id = (select app_user_id()));
create policy saved_searches_own on saved_searches for all to authenticated
  using (user_id = (select app_user_id())) with check (user_id = (select app_user_id()));

-- 監査・出力ログは管理者でも改ざん不可
revoke update, delete, truncate on audit_logs, export_logs, login_history from authenticated;

-- 内部関数は直接呼ばせない
revoke execute on function try_lock(uuid, uuid), write_audit(text, text, text, jsonb),
  call_block_reason(uuid, uuid) from authenticated, public;

-- ログイン履歴の記録（本人のみ）
create or replace function record_login(p_event text, p_ip text default null, p_ua text default null) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := app_user_id();
begin
  if uid is null then return; end if;
  insert into login_history(user_id, event, ip, user_agent) values (uid, p_event, p_ip, p_ua);
  if p_event = 'login' then update users set last_login_at = now() where id = uid; end if;
end $$;

-- ログインユーザーの概要（画面のメニュー出し分け用）
create or replace function me() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', u.id, 'name', u.name, 'email', u.email,
    'roles', coalesce((select jsonb_agg(role) from user_roles where user_id = u.id), '[]'),
    'teams', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'isLeader', tm.is_leader))
                       from team_members tm join teams t on t.id = tm.team_id where tm.user_id = u.id), '[]'),
    'unreadNotifications', (select count(*) from notifications n where n.user_id = u.id and n.read_at is null))
  from users u where u.id = app_user_id()
$$;

-- =====================================================================
-- マスタ初期値（仮仕様。管理画面から変更可能）
-- =====================================================================
insert into call_result_masters(code, label, category, is_connected, required_fields, optional_fields, auto_action, shortcut_key, sort_order) values
 ('not_called',      '未架電',               'untouched',   false, '{}', '{}', '{}', null, 0),
 ('no_answer',       '不在',                 'unreachable', false, '{}', '{memo,next_call_at}', '{"type":"recall","delay":"next_business_day"}', '1', 10),
 ('voicemail',       '留守番電話',           'unreachable', false, '{}', '{memo,next_call_at}', '{"type":"recall","delay":"next_business_day"}', '2', 20),
 ('busy',            '話し中',               'unreachable', false, '{}', '{next_call_at}', '{"type":"recall","delay":"30 minutes"}', '3', 30),
 ('other_person',    '本人以外が応答',       'unreachable', false, '{}', '{memo,next_call_at}', '{"type":"recall","delay":"next_business_day"}', '4', 40),
 ('connected',       '接続・ヒアリング済み', 'progress',    true,  '{}', '{hearing,memo,next_call_at}', '{"type":"keep"}', '5', 50),
 ('intent_yes',      '転職意向あり',         'progress',    true,  '{next_call_at}', '{hearing,memo}', '{"type":"keep"}', '6', 60),
 ('intent_future',   '将来的に転職を検討',   'progress',    true,  '{next_call_at}', '{hearing,memo}', '{"type":"keep"}', '7', 70),
 ('callback',        '再架電希望',           'progress',    true,  '{next_call_at}', '{memo}', '{"type":"recall"}', '8', 80),
 ('appointment',     'アポイント獲得',       'success',     true,  '{appointment}', '{hearing,memo}', '{"type":"appointment"}', '9', 90),
 ('intent_no',       '転職意向なし',         'stop',        true,  '{}', '{memo}', '{"type":"close","block_days":180}', '0', 100),
 ('invalid_number',  '電話番号不通',         'stop',        false, '{}', '{memo}', '{"type":"invalid_phone"}', 'q', 110),
 ('out_of_scope',    '対象外',               'stop',        false, '{memo}', '{}', '{"type":"close"}', 'w', 120),
 ('complaint',       'クレーム',             'stop',        true,  '{memo}', '{}', '{"type":"suppress","reason":"complaint","notify":"leaders"}', 'e', 130),
 ('refused',         '架電拒否',             'stop',        true,  '{}', '{memo}', '{"type":"suppress","reason":"refusal"}', 'r', 140),
 ('consent_unknown', '利用許諾未確認',       'review',      false, '{}', '{memo}', '{"type":"consent_review"}', 't', 150);

-- 発信しない結果（架電数に含めない）
update call_result_masters set counts_as_dial = false where code in ('not_called','out_of_scope','consent_unknown');

insert into call_rules(key, value, description) values
 ('calling_hours', '{"enforce": true, "days": [1,2,3,4,5,6], "start": "10:00", "end": "20:00"}', '架電可能時間帯（仮：月〜土 10-20時、日祝不可）'),
 ('assignment_priority', '["recall_today","lp_new","consult_wanted","untouched","recall_absent"]', '自動割当・キューの優先順位'),
 ('max_no_answer_attempts', '6', '不通系の最大再架電回数（到達で自動クローズ）'),
 ('lock_ttl_minutes', '10', '架電ロックの有効時間（分）'),
 ('export_max_rows', '5000', 'CSV出力の1回あたり上限件数'),
 ('auto_logout_minutes', '30', '無操作時の自動ログアウト（分）'),
 ('recording_enabled', 'false', '通話録音（告知・同意運用の確定まで無効）');

insert into application_status_masters(code, label, sort_order, is_terminal) values
 ('appointment','アポイント獲得',10,false), ('interview_scheduled','キャリア面談予定',20,false),
 ('interview_done','キャリア面談実施',30,false), ('job_proposed','求人提案',40,false),
 ('intent_check','応募意思確認',50,false), ('document_screening','書類選考',60,false),
 ('first_interview','一次面接',70,false), ('final_interview','最終面接',80,false),
 ('offer','内定',90,false), ('offer_accepted','内定承諾',100,false), ('joined','入社',110,false),
 ('revenue_confirmed','売上確定',120,false), ('paid','入金済み',130,true), ('lost','辞退・失注',140,true);

insert into integration_settings(service, mode, config) values
 ('cti', 'mock', '{"provider": "mock"}'), ('kintone', 'mock', '{}'), ('lp', 'mock', '{}');
