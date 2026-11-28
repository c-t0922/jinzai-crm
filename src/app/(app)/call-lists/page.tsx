import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { createSupabaseServer } from "@/lib/supabase/server";
import { PageBody, PageHeader } from "@/components/layout/page";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { EmptyState } from "@/components/states";
import { fmtDateTime, fmtNum } from "@/lib/format";

export const metadata: Metadata = { title: "架電リスト管理" };

export default async function CallListsPage() {
  await requireUser("calllists.manage");
  const supabase = await createSupabaseServer();
  const { data: lists } = await supabase.from("call_lists").select("*, teams(name)").neq("status", "archived").order("priority").order("created_at", { ascending: false });
  const ids = (lists ?? []).map((l) => l.id);
  const { data: assigned } = ids.length
    ? await supabase.from("assignments").select("call_list_id").in("call_list_id", ids).is("released_at", null)
    : { data: [] as { call_list_id: string }[] };
  const countBy = new Map<string, number>();
  (assigned ?? []).forEach((a) => countBy.set(a.call_list_id, (countBy.get(a.call_list_id) ?? 0) + 1));
  return (
    <>
      <PageHeader
        title="架電リスト管理"
        description="条件で顧客を抽出し、チーム・担当者へ割り当てます"
        actions={<Link href="/call-lists/new" className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3.5 text-sm font-medium text-white hover:bg-primary/90"><Plus className="size-4" /> リストを作成</Link>}
      />
      <PageBody>
        <div className="rounded-lg border border-border bg-white">
          {!lists?.length ? (
            <EmptyState title="架電リストはまだありません" description="「リストを作成」から条件を指定して作成してください" />
          ) : (
            <Table>
              <THead><tr><TH>優先度</TH><TH>リスト名</TH><TH>種類</TH><TH>チーム</TH><TH className="text-right">メンバー</TH><TH className="text-right">割当中</TH><TH>状態</TH><TH>更新</TH></tr></THead>
              <TBody>
                {lists.map((l) => (
                  <TR key={l.id}>
                    <TD className="tabular">{l.priority}</TD>
                    <TD><Link href={`/call-lists/${l.id}`} className="font-medium hover:text-accent-blue">{l.name}</Link></TD>
                    <TD>{l.type === "dynamic" ? <Badge tone="blue">動的</Badge> : <Badge>固定</Badge>}</TD>
                    <TD className="text-xs">{l.teams?.name ?? "—"}</TD>
                    <TD className="tabular text-right">{fmtNum(l.member_count)}</TD>
                    <TD className="tabular text-right">{fmtNum(countBy.get(l.id) ?? 0)}</TD>
                    <TD>{l.status === "active" ? <Badge tone="emerald">稼働中</Badge> : <Badge tone="amber">一時停止</Badge>}</TD>
                    <TD className="tabular text-xs">{fmtDateTime(l.refreshed_at ?? l.updated_at)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </div>
      </PageBody>
    </>
  );
}
