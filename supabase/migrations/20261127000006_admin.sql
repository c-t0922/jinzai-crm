-- =====================================================================
-- 管理機能：設定系テーブルの変更監査・ユーザー/目標/スクリプト管理 RPC
-- =====================================================================

-- 設定系テーブルの変更は誰が・何を・どう変えたかを監査ログに自動記録する
create or replace function audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  o jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  n jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  tid text := coalesce(n->>'id', o->>'id', n->>'key', o->>'key', n->>'code', o->>'code', n->>'user_id', o->>'user_id');
begin
  if app_user_id() is null then return coalesce(new, old); end if; -- seed・バッチは対象外
  -- 最終ログイン日時・更新日時だけの変更は記録しない（ログイン履歴は login_history に別途記録）
  if tg_op = 'UPDATE' and (o - 'updated_at' - 'last_login_at') = (n - 'updated_at' - 'last_login_at') then
    return new;
  end if;
  perform write_audit(lower(tg_op) || ':' || tg_table_name, tg_table_name, tid,
    jsonb_build_object('old', o, 'new', n));
  return coalesce(new, old);
end $$;
revoke all on function audit_row() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['users','user_roles','teams','team_members','goals','scripts','call_rules','call_result_masters'] loop
    execute format('create trigger %I after insert or update or delete on %I for each row execute function audit_row()', 'audit_' || t, t);
  end loop;
end $$;

-- スクリプト：本文が変わったら版を上げる
create or replace function scripts_bump_version() returns trigger language plpgsql as $$
begin
  if new.body is distinct from old.body or new.title is distinct from old.title then
    new.version := old.version + 1;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger scripts_version before update on scripts for each row execute function scripts_bump_version();

-- ---------- ユーザー管理（admin のみ） ----------
-- 認証ユーザーの作成（招待メール送信）はサーバー側で行い、本関数で業務ユーザーと紐付ける
create or replace function admin_create_user(p_auth uuid, p_name text, p_email text, p_roles app_role[], p_team uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); new_id uuid;
begin
  if not is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if coalesce(trim(p_name),'') = '' or coalesce(array_length(p_roles,1),0) = 0 then
    raise exception 'VALIDATION_ERROR: name/roles' using errcode = '22023';
  end if;
  insert into users(auth_user_id, name, email) values (p_auth, trim(p_name), lower(trim(p_email))) returning id into new_id;
  insert into user_roles(user_id, role) select new_id, r from unnest(p_roles) r on conflict do nothing;
  if p_team is not null then insert into team_members(team_id, user_id) values (p_team, new_id); end if;
  return new_id;
end $$;

create or replace function admin_update_user(p_user uuid, p_name text, p_status text, p_roles app_role[], p_teams uuid[], p_leader_teams uuid[] default '{}')
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user();
begin
  if not is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_status not in ('active','suspended') then raise exception 'VALIDATION_ERROR: status' using errcode = '22023'; end if;
  if coalesce(array_length(p_roles,1),0) = 0 then raise exception 'VALIDATION_ERROR: roles' using errcode = '22023'; end if;
  -- 自分自身の管理者権限の剥奪・停止は不可（管理者不在を防ぐ）
  if p_user = uid and (p_status <> 'active' or not ('admin' = any(p_roles))) then
    raise exception 'SELF_LOCKOUT' using errcode = '42501';
  end if;
  update users set name = trim(p_name), status = p_status, updated_at = now() where id = p_user;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  delete from user_roles where user_id = p_user and role <> all(p_roles);
  insert into user_roles(user_id, role) select p_user, r from unnest(p_roles) r on conflict do nothing;
  delete from team_members where user_id = p_user and team_id <> all(coalesce(p_teams, '{}'));
  insert into team_members(team_id, user_id, is_leader)
    select t, p_user, t = any(coalesce(p_leader_teams,'{}')) from unnest(coalesce(p_teams,'{}')) t
    on conflict (team_id, user_id) do update set is_leader = excluded.is_leader;
  -- 停止したユーザーの担当（未完了）を解除して他の人が架電できるようにする
  if p_status = 'suspended' then
    update assignments set released_at = now() where user_id = p_user and released_at is null;
    delete from contact_locks where user_id = p_user;
  end if;
end $$;

-- ---------- KPI 目標（manager） ----------
create or replace function goal_set(p_scope text, p_period text, p_metric text, p_value numeric, p_user uuid default null, p_team uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user();
begin
  if not is_manager() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_period !~ '^\d{4}-(0[1-9]|1[0-2])$' or p_metric not in ('calls','connects','appointments','revenue')
     or p_scope not in ('org','team','user') or p_value < 0
     or (p_scope = 'user' and p_user is null) or (p_scope = 'team' and p_team is null) then
    raise exception 'VALIDATION_ERROR' using errcode = '22023';
  end if;
  delete from goals where scope = p_scope and period = p_period and metric = p_metric
    and user_id is not distinct from (case when p_scope = 'user' then p_user end)
    and team_id is not distinct from (case when p_scope = 'team' then p_team end);
  if p_value > 0 then
    insert into goals(scope, user_id, team_id, period, metric, target_value, updated_by)
    values (p_scope, case when p_scope = 'user' then p_user end, case when p_scope = 'team' then p_team end, p_period, p_metric, p_value, uid);
  end if;
end $$;

grant execute on function admin_create_user(uuid, text, text, app_role[], uuid) to authenticated;
grant execute on function admin_update_user(uuid, text, text, app_role[], uuid[], uuid[]) to authenticated;
grant execute on function goal_set(text, text, text, numeric, uuid, uuid) to authenticated;
