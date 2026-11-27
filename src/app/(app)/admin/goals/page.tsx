import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/server/auth/session";
import { createSupabaseServer } from "@/lib/supabase/server";
import { PageBody, PageHeader } from "@/components/layout/page";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { GoalInput } from "@/features/admin/goal-input";
import { todayJst } from "@/lib/format";
import { ChevronLeft, ChevronRight } from "lucide-react";

export const metadata: Metadata = { title: "KPI目標設定" };
const METRICS = [["calls", "架電数"], ["connects", "接続数"], ["appointments", "アポ数"]] as const;

function shift(period: string, d: number) {
  const [y, m] = period.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + d, 1));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}`;
}

export default async function GoalsPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  await requireUser("admin.goals");
  const sp = await searchParams;
  const period = sp.period && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.period) ? sp.period : todayJst().slice(0, 7);
  const supabase = await createSupabaseServer();
  const [g, u] = await Promise.all([
    supabase.from("goals").select("scope, user_id, team_id, metric, target_value").eq("period", period),
    supabase.from("users").select("id, name, user_roles!inner(role)").eq("status", "active").in("user_roles.role", ["caller", "team_leader"]).order("name"),
  ]);
  const val = (scope: string, metric: string, id?: string) => {
    const row = (g.data ?? []).find((x) => x.scope === scope && x.metric === metric && (scope === "org" || x.user_id === id));
    return row ? Number(row.target_value) : null;
  };
  const users = Array.from(new Map((u.data ?? []).map((x) => [x.id, x])).values());
  return (
    <>
      <PageHeader title="KPI目標設定" description="月間目標。ダッシュボードで「今月」を選ぶと進捗が表示されます。入力欄からフォーカスを外すと保存されます（空欄で削除）。"
        actions={
          <div className="flex items-center gap-1">
            <Link href={`/admin/goals?period=${shift(period, -1)}`} className="rounded-md border border-border bg-white p-2 hover:bg-slate-50" aria-label="前月"><ChevronLeft className="size-4" /></Link>
            <span className="tabular w-24 text-center text-sm font-medium">{period.replace("-", "年")}月</span>
            <Link href={`/admin/goals?period=${shift(period, 1)}`} className="rounded-md border border-border bg-white p-2 hover:bg-slate-50" aria-label="翌月"><ChevronRight className="size-4" /></Link>
          </div>
        } />
      <PageBody>
        <div className="overflow-x-auto rounded-lg border border-border bg-white">
          <Table>
            <THead><TR><TH>対象</TH>{METRICS.map(([, l]) => <TH key={l} className="text-right">{l}</TH>)}</TR></THead>
            <TBody>
              <TR className="bg-slate-50 font-medium" key={`org-${period}`}>
                <TD>組織全体</TD>
                {METRICS.map(([m, l]) => <TD key={m} className="text-right"><div className="flex justify-end"><GoalInput scope="org" period={period} metric={m} value={val("org", m)} label={`組織全体 ${l}`} /></div></TD>)}
              </TR>
              {users.map((x) => (
                <TR key={`${x.id}-${period}`}>
                  <TD>{x.name}</TD>
                  {METRICS.map(([m, l]) => <TD key={m} className="text-right"><div className="flex justify-end"><GoalInput scope="user" period={period} metric={m} userId={x.id} value={val("user", m, x.id)} label={`${x.name} ${l}`} /></div></TD>)}
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
      </PageBody>
    </>
  );
}
