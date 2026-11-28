import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { createSupabaseServer } from "@/lib/supabase/server";
import { PageBody, PageHeader } from "@/components/layout/page";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { APPT_METHOD, ApptBadge, ResultBadge, SOURCE_LABEL } from "@/components/status";
import { fmtDateTime } from "@/lib/format";
import { AppointmentActions } from "@/features/appointments/appointment-actions";

export const metadata: Metadata = { title: "アポイント詳細" };

const HEARING_LABEL: Record<string, string> = { currentJob: "現在の職種", desiredTiming: "転職希望時期", desiredJob: "希望職種", desiredArea: "希望勤務地" };

export default async function AppointmentDetail({ params }: { params: Promise<{ id: string }> }) {
  await requireUser("appointments.view");
  const { id } = await params;
  const supabase = await createSupabaseServer();
  const { data: a } = await supabase
    .from("appointments")
    .select("*, contacts(id, full_name), advisor:users!appointments_advisor_user_id_fkey(id,name), booker:users!appointments_booked_by_fkey(name), handoffs(*)")
    .eq("id", id)
    .maybeSingle();
  if (!a) notFound();
  const { data: advisors } = await supabase.from("user_roles").select("users!inner(id,name)").eq("role", "career_advisor");
  const ho = Array.isArray(a.handoffs) ? a.handoffs[0] : a.handoffs;
  const snap = (ho?.snapshot ?? {}) as { contact?: { name?: string; area?: string; source?: string; firstInquiryAt?: string }; hearing?: Record<string, string>; memo?: string; recentCalls?: { at: string; result: string; memo?: string }[] };
  const contact = Array.isArray(a.contacts) ? a.contacts[0] : a.contacts;
  const advisor = Array.isArray(a.advisor) ? a.advisor[0] : a.advisor;
  const booker = Array.isArray(a.booker) ? a.booker[0] : a.booker;

  return (
    <>
      <PageHeader title={`アポイント：${contact?.full_name ?? ""}`} description={`${fmtDateTime(a.scheduled_at, { withYear: true })}・${APPT_METHOD[a.method]}`} />
      <PageBody className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle>引き継ぎ情報</CardTitle><span className="text-xs text-slate-500">{booker?.name ?? "—"} → {advisor?.name ?? "担当未定"}</span></CardHeader>
            <CardContent className="space-y-4 text-sm" data-testid="handoff">
              <dl className="grid grid-cols-[120px_1fr] gap-y-1.5">
                <dt className="text-slate-500">顧客</dt><dd>{contact ? <Link href={`/contacts/${contact.id}`} className="text-accent-blue hover:underline">{snap.contact?.name ?? contact.full_name}</Link> : "—"}</dd>
                <dt className="text-slate-500">エリア</dt><dd>{snap.contact?.area ?? "—"}</dd>
                <dt className="text-slate-500">流入経路</dt><dd>{SOURCE_LABEL[snap.contact?.source ?? ""] ?? snap.contact?.source ?? "—"}</dd>
                {Object.entries(snap.hearing ?? {}).map(([k, v]) => (
                  <div key={k} className="contents"><dt className="text-slate-500">{HEARING_LABEL[k] ?? k}</dt><dd>{v}</dd></div>
                ))}
                <dt className="text-slate-500">架電メモ</dt><dd className="whitespace-pre-wrap">{snap.memo || "—"}</dd>
              </dl>
              {snap.recentCalls?.length ? (
                <div>
                  <p className="mb-1 text-xs font-medium text-slate-500">直近の架電</p>
                  <ul className="space-y-1">
                    {snap.recentCalls.map((c, i) => <li key={i} className="flex gap-2 text-xs"><span className="tabular text-slate-500">{fmtDateTime(c.at)}</span><ResultBadge code={c.result} /><span>{c.memo}</span></li>)}
                  </ul>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle>状況</CardTitle><ApptBadge status={a.status} /></CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p>日時：<span className="tabular">{fmtDateTime(a.scheduled_at, { withYear: true })}</span></p>
              <p>形式：{APPT_METHOD[a.method]}</p>
              {a.meeting_url ? <p className="break-all">URL：<a href={a.meeting_url} target="_blank" rel="noreferrer" className="text-accent-blue hover:underline">{a.meeting_url}</a></p> : null}
              {a.done_at ? <p>実施：{fmtDateTime(a.done_at)}</p> : null}
              {a.cancel_reason ? <p>キャンセル理由：{a.cancel_reason}</p> : null}
              <p>引き継ぎ確認：{ho?.acknowledged_at ? fmtDateTime(ho.acknowledged_at) : "未確認"}</p>
            </CardContent>
          </Card>
          <AppointmentActions
            id={a.id}
            status={a.status}
            scheduledAt={a.scheduled_at}
            advisorId={advisor?.id ?? null}
            acknowledged={!!ho?.acknowledged_at}
            advisors={(advisors ?? []).map((r) => (Array.isArray(r.users) ? r.users[0] : r.users) as { id: string; name: string })}
          />
        </div>
      </PageBody>
    </>
  );
}
