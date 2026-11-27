import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/server/auth/session";
import { createSupabaseServer } from "@/lib/supabase/server";
import { PageBody, PageHeader } from "@/components/layout/page";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/states";
import { APPT_METHOD, ApptBadge } from "@/components/status";
import { fmtDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "アポイント管理" };

const VIEWS = [
  { key: "upcoming", label: "今後の予定" },
  { key: "today", label: "本日" },
  { key: "unassigned", label: "担当未定" },
  { key: "past", label: "過去" },
] as const;

export default async function AppointmentsPage({ searchParams }: { searchParams: Promise<{ view?: string; mine?: string }> }) {
  const me = await requireUser("appointments.view");
  const sp = await searchParams;
  const view = sp.view ?? "upcoming";
  const supabase = await createSupabaseServer();
  const now = new Date();
  const startToday = new Date(`${now.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" })}T00:00:00+09:00`);
  const endToday = new Date(startToday.getTime() + 86400_000);
  let q = supabase
    .from("appointments")
    .select("id, scheduled_at, method, status, contact_id, contacts(full_name, area_pref), advisor:users!appointments_advisor_user_id_fkey(name), booker:users!appointments_booked_by_fkey(name), handoffs(acknowledged_at)")
    .limit(200);
  if (view === "upcoming") q = q.gte("scheduled_at", now.toISOString()).in("status", ["scheduled", "rescheduled"]).order("scheduled_at");
  if (view === "today") q = q.gte("scheduled_at", startToday.toISOString()).lt("scheduled_at", endToday.toISOString()).order("scheduled_at");
  if (view === "unassigned") q = q.is("advisor_user_id", null).in("status", ["scheduled", "rescheduled"]).order("scheduled_at");
  if (view === "past") q = q.lt("scheduled_at", now.toISOString()).order("scheduled_at", { ascending: false });
  if (sp.mine === "1") q = q.or(`advisor_user_id.eq.${me.id},booked_by.eq.${me.id}`);
  const { data, error } = await q;

  return (
    <>
      <PageHeader title="アポイント管理" description="架電で獲得したアポイントと、キャリアアドバイザーへの引き継ぎ状況" />
      <PageBody className="space-y-3">
        <div className="flex flex-wrap items-center gap-1">
          {VIEWS.map((v) => (
            <Link key={v.key} href={`/appointments?view=${v.key}${sp.mine ? "&mine=1" : ""}`}
              className={cn("rounded-md px-3 py-1.5 text-sm", view === v.key ? "bg-primary text-white" : "bg-white text-slate-600 ring-1 ring-border hover:bg-slate-50")}>
              {v.label}
            </Link>
          ))}
          <Link href={`/appointments?view=${view}${sp.mine ? "" : "&mine=1"}`} className="ml-auto text-xs text-accent-blue hover:underline">
            {sp.mine ? "すべて表示" : "自分の担当のみ"}
          </Link>
        </div>
        <div className="rounded-lg border border-border bg-white">
          {error ? <EmptyState title="読み込みに失敗しました" /> : !data?.length ? <EmptyState title="該当するアポイントはありません" /> : (
            <Table>
              <THead><tr><TH>日時</TH><TH>顧客</TH><TH>形式</TH><TH>面談担当</TH><TH>獲得者</TH><TH>状態</TH><TH>引き継ぎ</TH></tr></THead>
              <TBody>
                {data.map((a) => {
                  const contact = Array.isArray(a.contacts) ? a.contacts[0] : a.contacts;
                  const advisor = Array.isArray(a.advisor) ? a.advisor[0] : a.advisor;
                  const booker = Array.isArray(a.booker) ? a.booker[0] : a.booker;
                  const ho = Array.isArray(a.handoffs) ? a.handoffs[0] : a.handoffs;
                  return (
                    <TR key={a.id}>
                      <TD className="tabular"><Link href={`/appointments/${a.id}`} className="font-medium hover:text-accent-blue">{fmtDateTime(a.scheduled_at)}</Link></TD>
                      <TD>{contact?.full_name ?? "—"} <span className="text-xs text-slate-400">{contact?.area_pref}</span></TD>
                      <TD className="text-xs">{APPT_METHOD[a.method]}</TD>
                      <TD>{advisor?.name ?? <Badge tone="amber">未定</Badge>}</TD>
                      <TD className="text-xs text-slate-600">{booker?.name ?? "—"}</TD>
                      <TD><ApptBadge status={a.status} /></TD>
                      <TD>{ho?.acknowledged_at ? <Badge tone="emerald">確認済</Badge> : <Badge tone="slate">未確認</Badge>}</TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          )}
        </div>
      </PageBody>
    </>
  );
}
