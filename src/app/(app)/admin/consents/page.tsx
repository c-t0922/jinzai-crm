import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/server/auth/session";
import { createSupabaseServer } from "@/lib/supabase/server";
import { PageBody, PageHeader } from "@/components/layout/page";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { EmptyState } from "@/components/states";
import { ConsentBadge } from "@/components/status";
import { BulkGrantForm, ReleaseButton } from "@/features/admin/consents-admin";
import { can } from "@/lib/permissions";
import { fmtDateTime, fmtNum } from "@/lib/format";

export const metadata: Metadata = { title: "個人情報・利用許諾管理" };
const REASON: Record<string, string> = { refusal: "架電拒否", complaint: "クレーム", legal: "法的要請", request: "本人依頼", other: "その他" };
const STATUSES = ["granted", "unknown", "denied", "withdrawn"] as const;

export default async function ConsentsPage() {
  const me = await requireUser("admin.consents");
  const supabase = await createSupabaseServer();
  const one = <T,>(v: T | T[] | null) => (Array.isArray(v) ? v[0] : v);
  const [counts, supp, suppCount, history] = await Promise.all([
    Promise.all(STATUSES.map((s) => supabase.from("contacts").select("id", { count: "exact", head: true }).eq("consent_status", s).is("deleted_at", null))),
    supabase.from("suppression_list").select("id, reason, note, registered_at, contact_id, contacts(full_name), registered_by_user:users!suppression_list_registered_by_fkey(name)").is("released_at", null).order("registered_at", { ascending: false }).limit(50),
    supabase.from("suppression_list").select("id", { count: "exact", head: true }).is("released_at", null),
    supabase.from("consents").select("id, status, basis, obtained_at, contact_id, contacts(full_name), recorder:users!consents_recorded_by_fkey(name)").order("created_at", { ascending: false }).limit(30),
  ]);
  const canRelease = can(me.roles, "suppression.release");
  return (
    <>
      <PageHeader title="個人情報・利用許諾管理" description="利用許諾が「許諾済」で、架電禁止に該当しない顧客だけが架電対象になります。履歴は削除されません。" />
      <PageBody className="space-y-4">
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-5" aria-label="利用許諾の状況">
          {STATUSES.map((s, i) => (
            <Link key={s} href={`/contacts?consent=${s}`} className="rounded-lg border border-border bg-white p-4 hover:border-accent-blue/50">
              <ConsentBadge status={s} />
              <p className="tabular mt-2 text-2xl font-semibold">{fmtNum(counts[i].count)}</p>
            </Link>
          ))}
          <div className="rounded-lg border border-border bg-white p-4">
            <span className="text-xs font-medium text-rose-700">架電禁止（有効）</span>
            <p className="tabular mt-2 text-2xl font-semibold">{fmtNum(suppCount.count)}</p>
          </div>
        </section>

        <Card>
          <CardHeader><CardTitle>架電禁止リスト</CardTitle><span className="text-xs text-slate-500">新しい順に50件{canRelease ? "" : "・解除はシステム管理者のみ"}</span></CardHeader>
          <CardContent className="p-0">
            {!supp.data?.length ? <EmptyState title="架電禁止の登録はありません" /> : (
              <div className="overflow-x-auto">
                <Table>
                  <THead><TR><TH>登録日時</TH><TH>顧客</TH><TH>理由</TH><TH>メモ</TH><TH>登録者</TH>{canRelease ? <TH><span className="sr-only">操作</span></TH> : null}</TR></THead>
                  <TBody>
                    {supp.data.map((s) => {
                      const c = one<{ full_name: string }>(s.contacts as unknown as { full_name: string } | null);
                      const by = one<{ name: string }>(s.registered_by_user as unknown as { name: string } | null);
                      return (
                        <TR key={s.id}>
                          <TD className="tabular text-xs">{fmtDateTime(s.registered_at)}</TD>
                          <TD>{s.contact_id && c ? <Link href={`/contacts/${s.contact_id}`} className="hover:text-accent-blue hover:underline">{c.full_name}</Link> : "—"}</TD>
                          <TD>{REASON[s.reason] ?? s.reason}</TD>
                          <TD className="max-w-64 truncate text-xs text-slate-600">{s.note ?? ""}</TD>
                          <TD className="text-xs">{by?.name ?? "システム"}</TD>
                          {canRelease ? <TD><ReleaseButton id={s.id} label={c?.full_name ?? "この番号"} /></TD> : null}
                        </TR>
                      );
                    })}
                  </TBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {can(me.roles, "consent.bulk") ? (
          <Card>
            <CardHeader><CardTitle>利用許諾の一括登録</CardTitle><span className="text-xs text-slate-500">システム管理者のみ・監査ログに記録</span></CardHeader>
            <CardContent><BulkGrantForm /></CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader><CardTitle>最近の利用許諾の記録</CardTitle></CardHeader>
          <CardContent className="p-0">
            {!history.data?.length ? <EmptyState title="記録はありません" /> : (
              <div className="overflow-x-auto">
                <Table>
                  <THead><TR><TH>日時</TH><TH>顧客</TH><TH>状態</TH><TH>根拠</TH><TH>記録者</TH></TR></THead>
                  <TBody>
                    {history.data.map((h) => {
                      const c = one<{ full_name: string }>(h.contacts as unknown as { full_name: string } | null);
                      const by = one<{ name: string }>(h.recorder as unknown as { name: string } | null);
                      return (
                        <TR key={h.id}>
                          <TD className="tabular text-xs">{fmtDateTime(h.obtained_at)}</TD>
                          <TD><Link href={`/contacts/${h.contact_id}`} className="hover:text-accent-blue hover:underline">{c?.full_name ?? "—"}</Link></TD>
                          <TD><ConsentBadge status={h.status} /></TD>
                          <TD className="max-w-80 truncate text-xs">{h.basis ?? "—"}</TD>
                          <TD className="text-xs">{by?.name ?? "取り込み"}</TD>
                        </TR>
                      );
                    })}
                  </TBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </PageBody>
    </>
  );
}
