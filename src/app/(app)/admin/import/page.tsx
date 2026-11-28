import type { Metadata } from "next";
import { requireUser } from "@/server/auth/session";
import { createSupabaseServer } from "@/lib/supabase/server";
import { PageBody, PageHeader } from "@/components/layout/page";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { EmptyState } from "@/components/states";
import { CsvImport } from "@/features/admin/csv-import";
import { fmtDateTime, fmtNum } from "@/lib/format";

export const metadata: Metadata = { title: "顧客CSV取り込み" };
const STATUS: Record<string, string> = { running: "実行中", completed: "完了", canceled: "中止", failed: "停止" };

export default async function ImportPage() {
  await requireUser("admin.integrations");
  const supabase = await createSupabaseServer();
  const { data: jobs } = await supabase.from("sync_jobs")
    .select("id, status, source_app_id, total, processed, inserted, updated, error_count, consent_granted, consent_denied, duplicate_candidates, started_at, finished_at, creator:users!sync_jobs_created_by_fkey(name)")
    .eq("source", "csv").order("created_at", { ascending: false }).limit(20);
  return (
    <>
      <PageHeader title="顧客CSV取り込み" description="kintone から出力した顧客 CSV を取り込みます。取り込んだ顧客は、利用許諾を確認できるまで架電できません。" />
      <PageBody className="space-y-4">
        <Card>
          <CardContent className="pt-5"><CsvImport /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>取り込み履歴</CardTitle><span className="text-xs text-slate-500">新しい順に20件・操作ログにも記録</span></CardHeader>
          <CardContent className="p-0">
            {!jobs?.length ? <EmptyState title="取り込みの履歴はありません" /> : (
              <div className="overflow-x-auto">
                <Table>
                  <THead><TR><TH>開始</TH><TH>アプリ</TH><TH>状態</TH><TH className="text-right">行数</TH><TH className="text-right">新規</TH><TH className="text-right">更新</TH><TH className="text-right">エラー</TH><TH className="text-right">許諾反映</TH><TH className="text-right">重複候補</TH><TH>実行者</TH></TR></THead>
                  <TBody>
                    {jobs.map((j) => {
                      const by = (Array.isArray(j.creator) ? j.creator[0] : j.creator) as { name: string } | null;
                      return (
                        <TR key={j.id}>
                          <TD className="tabular text-xs">{fmtDateTime(j.started_at)}</TD>
                          <TD>{j.source_app_id}</TD>
                          <TD>{STATUS[j.status] ?? j.status}</TD>
                          <TD className="tabular text-right">{fmtNum(j.processed)} / {fmtNum(j.total)}</TD>
                          <TD className="tabular text-right">{fmtNum(j.inserted)}</TD>
                          <TD className="tabular text-right">{fmtNum(j.updated)}</TD>
                          <TD className="tabular text-right">{fmtNum(j.error_count)}</TD>
                          <TD className="tabular text-right">{fmtNum(j.consent_granted)}</TD>
                          <TD className="tabular text-right">{fmtNum(j.duplicate_candidates)}</TD>
                          <TD className="text-xs">{by?.name ?? "—"}</TD>
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
