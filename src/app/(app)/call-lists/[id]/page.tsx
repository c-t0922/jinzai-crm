import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { createSupabaseServer } from "@/lib/supabase/server";
import { PageBody, PageHeader } from "@/components/layout/page";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { fmtDateTime, fmtNum, fmtPct, ratio } from "@/lib/format";
import { ListAssign } from "@/features/call-lists/list-assign";

export const metadata: Metadata = { title: "架電リスト詳細" };

const FIELD_LABEL: Record<string, string> = {
  first_inquiry_at: "問い合わせ時期", area_pref: "居住エリア", primary_source: "流入元", call_count: "架電回数", last_called_at: "最終架電",
  last_call_result: "過去の架電結果", job_change_intent: "転職意向", queue_state: "対応状況", consent_status: "利用許諾",
};
type Node = { op?: string; rules?: Node[]; field?: string; operator?: string; value?: unknown };
function describe(n: Node): string {
  if (n.rules) return n.rules.map(describe).filter(Boolean).join(n.op === "or" ? " または " : " かつ ");
  const v = Array.isArray(n.value) ? (n.value as string[]).join("・") : String(n.value ?? "");
  return `${FIELD_LABEL[n.field ?? ""] ?? n.field}：${v}${n.operator === "not_in" ? " 以外" : ""}`;
}

export default async function ListDetail({ params }: { params: Promise<{ id: string }> }) {
  await requireUser("calllists.manage");
  const { id } = await params;
  const supabase = await createSupabaseServer();
  const { data: list } = await supabase.from("call_lists").select("*, teams(name)").eq("id", id).maybeSingle();
  if (!list) notFound();
  const [assigns, callers, stats] = await Promise.all([
    supabase.from("assignments").select("user_id, users!assignments_user_id_fkey(name)").eq("call_list_id", id).is("released_at", null),
    supabase.from("user_roles").select("user_id, users!inner(id,name,status)").in("role", ["caller", "team_leader"]),
    supabase.rpc("kpi_dashboard", { p: { listId: id, from: "2000-01-01" } }),
  ]);
  const perUser = new Map<string, { name: string; count: number }>();
  (assigns.data ?? []).forEach((a) => {
    const u = Array.isArray(a.users) ? a.users[0] : a.users;
    const cur = perUser.get(a.user_id) ?? { name: u?.name ?? "—", count: 0 };
    cur.count++;
    perUser.set(a.user_id, cur);
  });
  const users = (callers.data ?? [])
    .map((r) => (Array.isArray(r.users) ? r.users[0] : r.users) as { id: string; name: string; status: string })
    .filter((u, i, a) => u?.status === "active" && a.findIndex((x) => x.id === u.id) === i);
  const cur = stats.data?.current ?? {};
  return (
    <>
      <PageHeader title={list.name} description={describe(list.filter_definition) || "条件なし"} />
      <PageBody className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              ["メンバー", fmtNum(list.member_count)],
              ["割当中", fmtNum([...perUser.values()].reduce((s, x) => s + x.count, 0))],
              ["架電数（累計）", fmtNum(cur.calls)],
              ["アポ獲得率（架電）", fmtPct(ratio(cur.appointments, cur.calls))],
            ].map(([k, v]) => (
              <Card key={k}><CardContent><p className="text-xs text-slate-500">{k}</p><p className="tabular mt-1 text-2xl font-semibold">{v}</p></CardContent></Card>
            ))}
          </div>
          <Card>
            <CardHeader><CardTitle>担当者別の割当状況</CardTitle></CardHeader>
            <CardContent>
              {perUser.size === 0 ? <p className="text-sm text-slate-400">まだ割り当てられていません</p> : (
                <ul className="space-y-1.5">
                  {[...perUser.entries()].sort((a, b) => b[1].count - a[1].count).map(([uid, v]) => (
                    <li key={uid} className="flex items-center gap-3 text-sm">
                      <span className="w-28 truncate">{v.name}</span>
                      <span className="h-2 flex-1 overflow-hidden rounded bg-slate-100"><span className="block h-full bg-accent-blue" style={{ width: `${Math.min(100, (v.count / Math.max(...[...perUser.values()].map((x) => x.count))) * 100)}%` }} /></span>
                      <span className="tabular w-14 text-right">{fmtNum(v.count)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>リスト情報</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-[120px_1fr] gap-y-1.5 text-sm">
              <span className="text-slate-500">種類</span><span>{list.type === "dynamic" ? "動的リスト" : "固定リスト"}</span>
              <span className="text-slate-500">状態</span><span>{list.status === "active" ? <Badge tone="emerald">稼働中</Badge> : <Badge tone="amber">一時停止</Badge>}</span>
              <span className="text-slate-500">チーム</span><span>{list.teams?.name ?? "指定なし"}</span>
              <span className="text-slate-500">優先度</span><span className="tabular">{list.priority}</span>
              <span className="text-slate-500">最終更新</span><span className="tabular">{fmtDateTime(list.refreshed_at)}</span>
            </CardContent>
          </Card>
        </div>
        <ListAssign listId={list.id} status={list.status} type={list.type} users={users.map((u) => ({ id: u.id, name: u.name }))} />
      </PageBody>
    </>
  );
}
