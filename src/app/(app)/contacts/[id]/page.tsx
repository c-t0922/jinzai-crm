import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PhoneCall } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { createSupabaseServer } from "@/lib/supabase/server";
import { PageBody, PageHeader } from "@/components/layout/page";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ApptBadge, APPT_METHOD, ConsentBadge, INTENT_LABEL, QueueBadge, ResultBadge, SOURCE_LABEL } from "@/components/status";
import { EmptyState } from "@/components/states";
import { can } from "@/lib/permissions";
import { displayPhone, fmtDate, fmtDateTime, fmtDuration, maskPhone } from "@/lib/format";
import { ContactActions } from "@/features/contacts/contact-actions";

export const metadata: Metadata = { title: "顧客詳細" };

type TimelineItem = { at: string; kind: string; title: React.ReactNode; body?: string | null; by?: string | null };

export default async function ContactDetail({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser("contacts.view");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await createSupabaseServer();
  const { data: c } = await supabase.from("contacts").select("*").eq("id", id).maybeSingle();
  if (!c) notFound(); // RLS で見えない顧客も 404（存在を推測させない）

  const [phones, sources, consents, results, appts, assigns, tasks, supp] = await Promise.all([
    supabase.from("contact_phones").select("*").eq("contact_id", id).order("is_primary", { ascending: false }),
    supabase.from("contact_sources").select("*").eq("contact_id", id),
    supabase.from("consents").select("*, users(name)").eq("contact_id", id).order("obtained_at", { ascending: false }),
    supabase.from("call_results").select("*, users(name), call_result_masters(label)").eq("contact_id", id).order("saved_at", { ascending: false }).limit(100),
    supabase.from("appointments").select("*, advisor:users!appointments_advisor_user_id_fkey(name), booker:users!appointments_booked_by_fkey(name)").eq("contact_id", id).order("scheduled_at", { ascending: false }),
    supabase.from("assignments").select("*, users!assignments_user_id_fkey(name), call_lists(name)").eq("contact_id", id).order("assigned_at", { ascending: false }),
    supabase.from("tasks").select("*").eq("contact_id", id).order("created_at", { ascending: false }),
    supabase.from("suppression_list").select("*").eq("contact_id", id).is("released_at", null),
  ]);
  const fullPhone = can(me.roles, "contacts.viewAllPhones");
  const callLogIds = (results.data ?? []).map((r) => r.call_log_id);
  const { data: logs } = callLogIds.length
    ? await supabase.from("call_logs").select("id,duration_sec,is_demo").in("id", callLogIds)
    : { data: [] as { id: string; duration_sec: number | null; is_demo: boolean }[] };
  const durationOf = new Map((logs ?? []).map((l) => [l.id, l.duration_sec]));

  const timeline: TimelineItem[] = [
    ...(results.data ?? []).map((r) => ({
      at: r.saved_at, kind: "架電", by: r.users?.name,
      title: <span className="flex items-center gap-2"><ResultBadge code={r.result_code} />{durationOf.get(r.call_log_id) ? <span className="tabular text-xs text-slate-400">通話 {fmtDuration(durationOf.get(r.call_log_id))}</span> : null}</span>,
      body: [r.memo, Object.entries(r.hearing ?? {}).map(([k, v]) => `${{ currentJob: "現職", desiredTiming: "希望時期", desiredJob: "希望職種", desiredArea: "希望勤務地" }[k] ?? k}：${v}`).join(" ／ ")].filter(Boolean).join("\n"),
    })),
    ...(appts.data ?? []).map((a) => ({ at: a.created_at, kind: "アポイント", by: a.booker?.name, title: <span className="flex items-center gap-2"><ApptBadge status={a.status} /> {fmtDateTime(a.scheduled_at)}（{APPT_METHOD[a.method]}）</span>, body: a.note })),
    ...(consents.data ?? []).map((x) => ({ at: x.obtained_at, kind: "利用許諾", by: x.users?.name, title: <ConsentBadge status={x.status} />, body: [x.basis, x.terms_version && `規約版：${x.terms_version}`, x.note].filter(Boolean).join(" ／ ") })),
    ...(assigns.data ?? []).map((a) => ({ at: a.assigned_at, kind: "担当割当", by: null, title: <span>{a.users?.name ?? "—"} に割当{a.call_lists?.name ? `（${a.call_lists.name}）` : ""}</span>, body: a.released_at ? `解除：${fmtDateTime(a.released_at)}（${a.reason ?? ""}）` : null })),
  ].sort((a, b) => (a.at < b.at ? 1 : -1));

  const activeAssign = (assigns.data ?? []).find((a) => !a.released_at);

  return (
    <>
      <PageHeader
        title={c.full_name}
        description={`${c.last_name_kana ?? ""} ${c.first_name_kana ?? ""}`}
        actions={
          <>
            {can(me.roles, "callcenter.use") && c.callable && ["new", "recall"].includes(c.queue_state) ? (
              <Link href={`/call-center?contact=${c.id}`} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-emerald-600 px-3.5 text-sm font-medium text-white hover:bg-emerald-700">
                <PhoneCall className="size-4" /> 架電センターで開く
              </Link>
            ) : null}
            <ContactActions contactId={c.id} canConsent={can(me.roles, "admin.consents")} suppressed={c.is_suppressed} />
          </>
        }
      />
      <PageBody className="grid grid-cols-1 gap-4 xl:grid-cols-[360px_1fr]">
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle>基本情報</CardTitle><QueueBadge state={c.queue_state} /></CardHeader>
            <CardContent>
              <dl className="grid grid-cols-[96px_1fr] gap-y-2 text-sm">
                <dt className="text-slate-500">電話番号</dt>
                <dd className="space-y-0.5">
                  {(phones.data ?? []).map((p) => (
                    <div key={p.id} className="tabular">{fullPhone ? displayPhone(p.phone_e164) : maskPhone(p.phone_e164)} {!p.is_valid ? <Badge tone="rose">不通</Badge> : null}</div>
                  ))}
                </dd>
                <dt className="text-slate-500">メール</dt><dd className="break-all">{c.email ?? "—"}</dd>
                <dt className="text-slate-500">居住エリア</dt><dd>{[c.area_pref, c.area_city].filter(Boolean).join(" ") || "—"}</dd>
                <dt className="text-slate-500">転職意向</dt><dd>{c.job_change_intent ? INTENT_LABEL[c.job_change_intent] ?? c.job_change_intent : "未確認"}</dd>
                <dt className="text-slate-500">利用許諾</dt><dd className="flex flex-wrap gap-1"><ConsentBadge status={c.consent_status} />{c.is_suppressed ? <Badge tone="rose">架電禁止</Badge> : null}</dd>
                <dt className="text-slate-500">担当者</dt><dd>{activeAssign?.users?.name ?? "未割当"}</dd>
                <dt className="text-slate-500">架電</dt><dd className="tabular">{c.call_count} 回／最終 {fmtDateTime(c.last_called_at)}</dd>
                <dt className="text-slate-500">次回架電</dt><dd className="tabular">{fmtDateTime(c.next_call_at)}</dd>
                <dt className="text-slate-500">タグ</dt><dd className="flex flex-wrap gap-1">{c.tags?.length ? c.tags.map((t: string) => <Badge key={t}>{t}</Badge>) : "—"}</dd>
              </dl>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>流入情報</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>初回問い合わせ：<span className="tabular">{fmtDate(c.first_inquiry_at)}</span></p>
              <p>流入経路：{SOURCE_LABEL[c.primary_source] ?? c.primary_source}{c.source_detail ? ` / ${c.source_detail}` : ""}</p>
              {(sources.data ?? []).map((s) => (
                <p key={s.id} className="text-xs text-slate-500">取得元：{s.source_system} アプリ {s.source_app_id || "—"} ／ レコード {s.source_record_id}</p>
              ))}
            </CardContent>
          </Card>
          {(supp.data ?? []).length ? (
            <Card className="border-rose-200">
              <CardHeader><CardTitle className="text-rose-700">架電禁止</CardTitle></CardHeader>
              <CardContent className="text-sm">
                {(supp.data ?? []).map((s) => <p key={s.id}>{fmtDateTime(s.registered_at)} 登録（{{ refusal: "架電拒否", complaint: "クレーム", legal: "法的要請", request: "本人依頼", other: "その他" }[s.reason as string]}）</p>)}
              </CardContent>
            </Card>
          ) : null}
          <Card>
            <CardHeader><CardTitle>タスク</CardTitle></CardHeader>
            <CardContent className="space-y-1 text-sm">
              {(tasks.data ?? []).length === 0 ? <p className="text-slate-400">タスクはありません</p> : (tasks.data ?? []).map((t) => (
                <p key={t.id} className="flex justify-between gap-2"><span>{t.title}</span><span className="text-xs text-slate-500">{t.status === "done" ? "完了" : fmtDateTime(t.due_at)}</span></p>
              ))}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>対応履歴</CardTitle>
            <span className="text-xs text-slate-500">架電・アポイント・利用許諾・担当変更を時系列で表示（面談・選考・成約は Phase 3）</span>
          </CardHeader>
          <CardContent>
            {timeline.length === 0 ? <EmptyState title="履歴はまだありません" /> : (
              <ol className="relative space-y-4 border-l border-border pl-5">
                {timeline.map((t, i) => (
                  <li key={i} className="relative">
                    <span className="absolute -left-[25px] top-1.5 size-2.5 rounded-full border-2 border-white bg-slate-300 ring-1 ring-slate-300" />
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span className="tabular">{fmtDateTime(t.at, { withYear: true })}</span>
                      <Badge>{t.kind}</Badge>
                      {t.by ? <span>{t.by}</span> : null}
                    </div>
                    <div className="mt-1 text-sm">{t.title}</div>
                    {t.body ? <p className="mt-0.5 whitespace-pre-wrap text-xs text-slate-600">{t.body}</p> : null}
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </PageBody>
    </>
  );
}
