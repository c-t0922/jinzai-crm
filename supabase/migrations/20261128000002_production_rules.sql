-- 本番運用開始時の架電ルール（2026-11-28 社長回答：架電は月〜金。時間帯は仮で 10〜20 時）。
-- 管理画面「架電ルール設定」から変更できる。
update call_rules
set value = jsonb_set(jsonb_set(value, '{days}', '[1,2,3,4,5]'), '{enforce}', 'true'),
    description = '架電可能時間帯（月〜金 10-20時。時間帯は仮）'
where key = 'calling_hours';

-- 最初の管理者の登録（本番の初回のみ）。Supabase の Authentication から招待したユーザーを、
-- SQL エディタ（postgres 権限）で `select bootstrap_first_admin('メール', '氏名');` として管理者にする。
-- 既に管理者が 1 人でもいれば何もしない。アプリ（authenticated）からは呼べない。
create or replace function bootstrap_first_admin(p_email text, p_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_auth uuid; v_id uuid;
begin
  if exists(select 1 from user_roles where role = 'admin') then raise exception 'ADMIN_EXISTS'; end if;
  select id into v_auth from auth.users where lower(email) = lower(trim(p_email));
  if v_auth is null then raise exception 'AUTH_USER_NOT_FOUND'; end if;
  insert into users(auth_user_id, name, email) values (v_auth, trim(p_name), lower(trim(p_email)))
  on conflict (email) do update set auth_user_id = excluded.auth_user_id, status = 'active'
  returning id into v_id;
  insert into user_roles(user_id, role) values (v_id, 'admin'), (v_id, 'caller') on conflict do nothing;
  insert into audit_logs(actor_id, action, target_type, target_id) values (v_id, 'bootstrap:first_admin', 'users', v_id::text);
  return v_id;
end $$;
revoke all on function bootstrap_first_admin(text, text) from public, anon, authenticated;
