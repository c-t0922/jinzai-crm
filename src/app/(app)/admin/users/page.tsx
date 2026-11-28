import type { Metadata } from "next";
import { requireUser } from "@/server/auth/session";
import { createSupabaseServer } from "@/lib/supabase/server";
import { PageBody, PageHeader } from "@/components/layout/page";
import { UsersAdmin, type AdminUser } from "@/features/admin/users-admin";
import type { Role } from "@/lib/permissions";

export const metadata: Metadata = { title: "ユーザー管理" };

export default async function UsersPage() {
  const me = await requireUser("admin.users");
  const supabase = await createSupabaseServer();
  const [u, t] = await Promise.all([
    supabase.from("users").select("id, name, email, status, last_login_at, user_roles(role), team_members(team_id, is_leader)").order("status").order("email"),
    supabase.from("teams").select("id, name").order("name"),
  ]);
  const users: AdminUser[] = (u.data ?? []).map((x) => ({
    id: x.id, name: x.name, email: x.email, status: x.status, last_login_at: x.last_login_at,
    roles: (x.user_roles ?? []).map((r: { role: Role }) => r.role),
    teams: (x.team_members ?? []).map((m: { team_id: string; is_leader: boolean }) => ({ id: m.team_id, isLeader: m.is_leader })),
  }));
  return (
    <>
      <PageHeader title="ユーザー管理" description="ユーザーの招待・ロール・所属チーム・利用停止。変更はすべて操作ログに記録されます。" />
      <PageBody><UsersAdmin users={users} teams={t.data ?? []} meId={me.id} /></PageBody>
    </>
  );
}
