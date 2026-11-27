import "server-only";
import Link from "next/link";
import type { Me } from "@/server/auth/session";
import { getKpiOptions, type KpiFilter } from "@/server/domain/kpi/query";
import { KpiFilters } from "./kpi-filters";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { fmtNum, fmtPct, ratio } from "@/lib/format";
import { EmptyState } from "@/components/states";

export function viewOf(me: Me) {
  const full = me.roles.some((r) => r === "admin" || r === "pm" || r === "executive");
  const leader = me.roles.includes("team_leader");
  return { full, leader, personal: !full && !leader };
}

/** 集計条件バー（サーバー側で選択肢を取得。RLS で見える範囲のみ） */
export async function KpiFilterBar({ me, filter }: { me: Me; filter: KpiFilter }) {
  const v = viewOf(me);
  const opts = await getKpiOptions();
  const teams = v.full ? opts.teams : opts.teams.filter((t) => me.teams.some((m) => m.id === t.id && m.isLeader));
  return (
    <KpiFilters preset={filter.preset} from={filter.from} to={filter.to} users={opts.users} teams={teams} lists={opts.lists}
      show={{ user: !v.personal, team: !v.personal }} />
  );
}

export function scopeLabel(scope: "all" | "team" | "user", me: Me, filter: KpiFilter) {
  if (scope === "all") return "全体";
  if (scope === "user") return filter.userId && filter.userId !== me.id ? "担当者" : "自分";
  return "チーム";
}

type PerfRow = { key: string; name: string; href?: string; calls: number; connects: number; appointments: number };

/** 実績テーブル（接続率＝接続/架電、アポ率＝アポ/接続、架電アポ率＝アポ/架電） */
export function PerfTable({ rows, nameLabel, emptyText = "対象期間の実績はありません", testId }: { rows: PerfRow[]; nameLabel: string; emptyText?: string; testId?: string }) {
  if (!rows.length) return <EmptyState title={emptyText} description="期間や条件を変更してください" />;
  const sum = rows.reduce((a, r) => ({ calls: a.calls + r.calls, connects: a.connects + r.connects, appointments: a.appointments + r.appointments }), { calls: 0, connects: 0, appointments: 0 });
  return (
    <div className="overflow-x-auto">
      <Table data-testid={testId}>
        <THead>
          <TR>
            <TH>{nameLabel}</TH>
            <TH className="text-right">架電数</TH>
            <TH className="text-right">接続数</TH>
            <TH className="text-right">接続率</TH>
            <TH className="text-right">アポ数</TH>
            <TH className="text-right">アポ率（接続比）</TH>
            <TH className="text-right">架電アポ率</TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((r) => (
            <TR key={r.key}>
              <TD className="font-medium">{r.href ? <Link href={r.href} className="hover:text-accent-blue hover:underline">{r.name}</Link> : r.name}</TD>
              <TD className="tabular text-right">{fmtNum(r.calls)}</TD>
              <TD className="tabular text-right">{fmtNum(r.connects)}</TD>
              <TD className="tabular text-right">{fmtPct(ratio(r.connects, r.calls))}</TD>
              <TD className="tabular text-right font-medium">{fmtNum(r.appointments)}</TD>
              <TD className="tabular text-right">{fmtPct(ratio(r.appointments, r.connects))}</TD>
              <TD className="tabular text-right">{fmtPct(ratio(r.appointments, r.calls))}</TD>
            </TR>
          ))}
          <TR className="bg-slate-50 font-medium">
            <TD>合計</TD>
            <TD className="tabular text-right">{fmtNum(sum.calls)}</TD>
            <TD className="tabular text-right">{fmtNum(sum.connects)}</TD>
            <TD className="tabular text-right">{fmtPct(ratio(sum.connects, sum.calls))}</TD>
            <TD className="tabular text-right">{fmtNum(sum.appointments)}</TD>
            <TD className="tabular text-right">{fmtPct(ratio(sum.appointments, sum.connects))}</TD>
            <TD className="tabular text-right">{fmtPct(ratio(sum.appointments, sum.calls))}</TD>
          </TR>
        </TBody>
      </Table>
    </div>
  );
}
