import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/server/auth/session";
import { createSupabaseServer } from "@/lib/supabase/server";
import { PageBody, PageHeader } from "@/components/layout/page";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TeamForm } from "@/features/admin/teams-admin";
import { can } from "@/lib/permissions";

export const metadata: Metadata = { title: "チーム管理" };

export default async function TeamsPage() {
  const me = await requireUser("admin.teams");
  const supabase = await createSupabaseServer();
  const { data } = await supabase.from("teams").select("id, name, base_location, team_members(is_leader, users(name, status))").order("name");
  return (
    <>
      <PageHeader title="チーム管理" description="チームの追加・名称変更。メンバーとリーダーの設定はユーザー管理から行います。" />
      <PageBody className="space-y-4">
        <Card><CardHeader><CardTitle>チームを追加</CardTitle></CardHeader><CardContent><TeamForm /></CardContent></Card>
        {(data ?? []).map((t) => {
          const members = (t.team_members ?? []) as unknown as { is_leader: boolean; users: { name: string; status: string } | null }[];
          const active = members.filter((m) => m.users?.status === "active");
          return (
            <Card key={t.id}>
              <CardHeader><CardTitle>{t.name}</CardTitle><span className="text-xs text-slate-500">{active.length}名</span></CardHeader>
              <CardContent className="space-y-3">
                <TeamForm team={t} />
                <p className="text-sm text-slate-600">
                  <span className="text-xs text-slate-500">リーダー：</span>{active.filter((m) => m.is_leader).map((m) => m.users?.name).join("、") || "未設定"}
                  <span className="ml-4 text-xs text-slate-500">メンバー：</span>{active.filter((m) => !m.is_leader).map((m) => m.users?.name).join("、") || "—"}
                </p>
                {can(me.roles, "admin.users") ? <Link href="/admin/users" className="text-xs text-accent-blue hover:underline">メンバーを変更（ユーザー管理）</Link> : null}
              </CardContent>
            </Card>
          );
        })}
      </PageBody>
    </>
  );
}
