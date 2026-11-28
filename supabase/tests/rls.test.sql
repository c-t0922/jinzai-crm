-- RLS・権限の検証（pgTAP）。前提：pnpm db:reset で架空データ投入済み
begin;
select plan(22);

create or replace function pg_temp.login(p_email text) returns void language plpgsql as $$
declare aid uuid;
begin
  perform set_config('role', 'postgres', true);
  select id into aid from auth.users where email = p_email;
  perform set_config('request.jwt.claims', json_build_object('sub', aid, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
create or replace function pg_temp.logout() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

-- 準備：caller01 の担当顧客・caller02 の担当顧客を1件ずつ
create temp table t as
select (select a.contact_id from assignments a join users u on u.id = a.user_id where u.email = 'caller01@example.test' and a.released_at is null limit 1) as c1,
       (select a.contact_id from assignments a join users u on u.id = a.user_id where u.email = 'caller02@example.test' and a.released_at is null limit 1) as c2,
       (select id from users where email = 'caller02@example.test') as u2;
grant select on t to authenticated;

-- ---------- 匿名 ----------
select pg_temp.logout();
set local role anon;
select throws_ok('select count(*) from contacts', '42501', null, '匿名は顧客テーブルにアクセスできない');
reset role;

-- ---------- 架電担当 ----------
select pg_temp.login('caller01@example.test');
select ok((select count(*) from contacts where id = (select c1 from t)) = 1, '架電担当は自分の担当顧客を見られる');
select is((select count(*) from contacts where id = (select c2 from t))::int, 0, '架電担当は他人の担当顧客を見られない');
select is((select count(*) from call_logs where user_id = (select u2 from t))::int, 0, '架電担当は他人の通話ログを見られない');
select is((select count(*) from audit_logs)::int, 0, '架電担当は操作ログを見られない');
select is((select count(*) from export_logs)::int, 0, '架電担当は出力ログを見られない');
select throws_ok($$select contacts_export('{"filter":{"op":"and","rules":[]}}'::jsonb, 'test')$$, '42501', null, '架電担当は CSV 出力できない');
select throws_ok($$select suppression_release((select id from suppression_list limit 1), 'test reason')$$, '42501', null, '架電担当は架電禁止を解除できない');
select throws_ok($$select consent_bulk_grant('{"op":"and","rules":[]}'::jsonb, 'basis text', 'v1')$$, '42501', null, '架電担当は利用許諾を一括登録できない');
select throws_ok($$select goal_set('org','2026-11','calls',1)$$, '42501', null, '架電担当は目標を設定できない');
update call_rules set value = '1' where key = 'lock_ttl_minutes';
select is((select value from call_rules where key = 'lock_ttl_minutes'), '10'::jsonb, '架電担当は架電ルールを変更できない（RLS で 0 行更新）');
select throws_ok($$insert into audit_logs(action) values ('fake')$$, '42501', null, '操作ログは直接書き込めない');
select throws_ok($$select cc_open((select c2 from t))$$, null, null, '他人の担当顧客は架電センターで開けない');

-- ---------- 経営陣 ----------
select pg_temp.logout();
select pg_temp.login('exec@example.test');
select is((select count(*) from contacts)::int, 0, '経営陣は顧客の個人情報を見られない');
select is((select count(*) from contact_phones)::int, 0, '経営陣は電話番号を見られない');
select ok((select kpi_dashboard('{}'::jsonb)->>'scope') = 'all', '経営陣は全体の KPI を見られる');

-- ---------- チームリーダー ----------
select pg_temp.logout();
select pg_temp.login('tl1@example.test');
select ok((select kpi_dashboard('{}'::jsonb)->>'scope') = 'team', 'TL の KPI はチーム範囲');
select is((select count(*) from users u where u.id = any(kpi_scope_users('{}'::jsonb)) and not exists(
  select 1 from team_members tm join team_members me on me.team_id = tm.team_id
  where tm.user_id = u.id and me.user_id = app_user_id() and me.is_leader))::int, 0, 'TL は他チームの実績を集計範囲に含めない');

-- ---------- 管理者 ----------
select pg_temp.logout();
select pg_temp.login('admin@example.test');
select throws_ok($$select admin_update_user(app_user_id(), 'x', 'suspended', '{admin}', '{}')$$, '42501', null, '管理者は自分自身を利用停止にできない');
select lives_ok($$select goal_set('org', '2030-01', 'calls', 100)$$, '管理者は目標を設定できる');
select ok(exists(select 1 from audit_logs where action = 'insert:goals'), '設定変更は操作ログに記録される');

-- ---------- 架電禁止の伝播 ----------
select pg_temp.logout();
select is((select count(*) from contacts c join suppression_list s on s.contact_id = c.id and s.released_at is null where c.callable)::int, 0,
  '架電禁止の顧客は架電可能にならない');

select * from finish();
rollback;
