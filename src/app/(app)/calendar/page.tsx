import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { createSupabaseServer } from "@/lib/supabase/server";
import { PageBody, PageHeader } from "@/components/layout/page";
import { APPT_STATUS } from "@/components/status";
import { addDaysJst, todayJst } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "カレンダー" };

const DOW = ["月", "火", "水", "木", "金", "土", "日"];
const TONE: Record<string, string> = { blue: "border-blue-300 bg-blue-50 text-blue-800", emerald: "border-emerald-300 bg-emerald-50 text-emerald-800", amber: "border-amber-300 bg-amber-50 text-amber-800", rose: "border-rose-200 bg-rose-50 text-rose-700 line-through", slate: "border-slate-200 bg-slate-50" };

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ week?: string; mine?: string }> }) {
  const me = await requireUser("appointments.view");
  const sp = await searchParams;
  const base = sp.week && /^\d{4}-\d{2}-\d{2}$/.test(sp.week) ? sp.week : todayJst();
  const dow = (new Date(`${base}T12:00:00+09:00`).getUTCDay() + 6) % 7; // 月=0
  const monday = addDaysJst(base, -dow);
  const days = Array.from({ length: 7 }, (_, i) => addDaysJst(monday, i));
  const supabase = await createSupabaseServer();
  let q = supabase
    .from("appointments")
    .select("id, scheduled_at, status, method, contacts(full_name), advisor:users!appointments_advisor_user_id_fkey(name)")
    .gte("scheduled_at", new Date(`${monday}T00:00:00+09:00`).toISOString())
    .lt("scheduled_at", new Date(`${addDaysJst(monday, 7)}T00:00:00+09:00`).toISOString())
    .order("scheduled_at")
    .limit(500);
  if (sp.mine === "1") q = q.or(`advisor_user_id.eq.${me.id},booked_by.eq.${me.id}`);
  const { data } = await q;
  const byDay = new Map<string, NonNullable<typeof data>>();
  (data ?? []).forEach((a) => {
    const d = new Date(a.scheduled_at).toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
    byDay.set(d, [...(byDay.get(d) ?? []), a]);
  });
  const today = todayJst();
  const link = (w: string) => `/calendar?week=${w}${sp.mine ? "&mine=1" : ""}`;
  return (
    <>
      <PageHeader
        title="カレンダー"
        description={`${monday.replaceAll("-", "/")} 〜 ${addDaysJst(monday, 6).replaceAll("-", "/")}`}
        actions={
          <div className="flex items-center gap-1">
            <Link href={link(addDaysJst(monday, -7))} className="rounded-md border border-border bg-white p-2 hover:bg-slate-50" aria-label="前の週"><ChevronLeft className="size-4" /></Link>
            <Link href={link(today)} className="rounded-md border border-border bg-white px-3 py-1.5 text-sm hover:bg-slate-50">今週</Link>
            <Link href={link(addDaysJst(monday, 7))} className="rounded-md border border-border bg-white p-2 hover:bg-slate-50" aria-label="次の週"><ChevronRight className="size-4" /></Link>
            <Link href={`/calendar?week=${monday}${sp.mine ? "" : "&mine=1"}`} className="ml-2 text-xs text-accent-blue hover:underline">{sp.mine ? "すべて表示" : "自分の予定のみ"}</Link>
          </div>
        }
      />
      <PageBody>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-7">
          {days.map((d, i) => (
            <div key={d} className={cn("min-h-40 rounded-lg border border-border bg-white", d === today && "ring-2 ring-accent-blue/40")}>
              <div className={cn("flex items-baseline justify-between border-b border-border px-2 py-1.5 text-xs", i >= 5 ? "text-rose-600" : "text-slate-600")}>
                <span className="font-medium">{Number(d.slice(8))}日（{DOW[i]}）</span>
                <span className="tabular text-slate-400">{byDay.get(d)?.length ?? 0}件</span>
              </div>
              <ul className="space-y-1 p-1.5">
                {(byDay.get(d) ?? []).map((a) => {
                  const tone = APPT_STATUS[a.status]?.[1] ?? "slate";
                  const c = Array.isArray(a.contacts) ? a.contacts[0] : a.contacts;
                  const adv = Array.isArray(a.advisor) ? a.advisor[0] : a.advisor;
                  return (
                    <li key={a.id}>
                      <Link href={`/appointments/${a.id}`} className={cn("block rounded border px-1.5 py-1 text-[11px] leading-tight hover:opacity-80", TONE[tone])}>
                        <span className="tabular font-medium">{new Date(a.scheduled_at).toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" })}</span> {c?.full_name}
                        <span className="block text-[10px] opacity-75">{adv?.name ?? "担当未定"}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </PageBody>
    </>
  );
}
