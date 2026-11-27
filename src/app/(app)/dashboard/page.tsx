import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PhoneCall } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { getKpi, kpiFilterFromParams, kpiQueryString, PRESET_LABEL } from "@/server/domain/kpi/query";
import { PageBody, PageHeader } from "@/components/layout/page";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/states";
import { StatTile } from "@/features/kpi/stat-tile";
import { HourChart, ResultBars, TrendChart } from "@/features/kpi/charts";
import { KpiFilterBar, PerfTable, scopeLabel, viewOf } from "@/features/kpi/kpi-shell";
import { fmtDuration, fmtNum, fmtPct, ratio } from "@/lib/format";
import { can } from "@/lib/permissions";

export const metadata: Metadata = { title: "ダッシュボード" };

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function DashboardPage({ searchParams }: { searchParams: SP }) {
  const me = await requireUser("dashboard.view");
  const filter = kpiFilterFromParams(await searchParams);
  const v = viewOf(me);
  return (
    <>
      <PageHeader
        title="ダッシュボード"
        description={`${PRESET_LABEL[filter.preset]}（${filter.from.replaceAll("-", "/")}${filter.from !== filter.to ? ` 〜 ${filter.to.replaceAll("-", "/")}` : ""}）`}
        actions={can(me.roles, "callcenter.use") ? (
          <Link href="/call-center" className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-white hover:bg-primary/90">
            <PhoneCall className="size-4" /> 架電センターへ
          </Link>
        ) : undefined}
      />
      <PageBody className="space-y-4">
        <KpiFilterBar me={me} filter={filter} />
        <Suspense key={kpiQueryString(filter)} fallback={<DashSkeleton />}>
          <DashboardBody me={me} filter={filter} view={v} />
        </Suspense>
      </PageBody>
    </>
  );
}

function DashSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-28" />)}</div>
      <Skeleton className="h-64" />
    </div>
  );
}

async function DashboardBody({ me, filter, view }: { me: Awaited<ReturnType<typeof requireUser>>; filter: ReturnType<typeof kpiFilterFromParams>; view: ReturnType<typeof viewOf> }) {
  const k = await getKpi(filter);
  const c = k.current;
  const qs = kpiQueryString(filter);
  const perHour = c.work_hours && c.work_hours > 0.25 ? c.calls / c.work_hours : null;
  const pastAppt = c.appt_target;
  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500">
        集計範囲：<Badge tone="blue">{scopeLabel(k.scope, me, filter)}</Badge>
        <span className="ml-2">前期間比は同じ日数の直前期間との比較です。分母が 0 の指標は「未計測」と表示します。</span>
      </p>
      <section aria-label="主要KPI" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile testId="kpi-calls" label="架電数" value={fmtNum(c.calls)} sub={`対象顧客 ${fmtNum(c.unique_contacts)}名`} current={c.calls} prev={k.previous.calls} goal={filter.preset === "month" ? k.goals.calls : null} href={`/analytics/sales?${qs}`} />
        <StatTile testId="kpi-connects" label="接続数" value={fmtNum(c.connects)} sub={`接続率 ${fmtPct(ratio(c.connects, c.calls))}`} current={c.connects} prev={k.previous.connects} goal={filter.preset === "month" ? k.goals.connects : null} href={`/analytics/sales?${qs}`} />
        <StatTile testId="kpi-appointments" label="アポイント獲得数" value={fmtNum(c.appointments)} sub={`アポ率（接続比） ${fmtPct(ratio(c.appointments, c.connects))}`} current={c.appointments} prev={k.previous.appointments} goal={filter.preset === "month" ? k.goals.appointments : null} href={`/appointments`} />
        <StatTile testId="kpi-call-appt-rate" label="架電アポ率" value={fmtPct(ratio(c.appointments, c.calls))} sub="アポ数 ÷ 架電数" href={`/analytics/members?${qs}`} />
        <StatTile testId="kpi-talk" label="平均通話時間" value={c.answered ? fmtDuration(Math.round(c.talk_sec / c.answered)) : "未計測"} sub={`通話 ${fmtNum(c.answered)}件`} />
        <StatTile testId="kpi-per-hour" label="1時間あたり架電数" value={perHour === null ? "未計測" : perHour.toFixed(1)} sub="稼働時間＝初回〜最終架電" href={`/analytics/hours?${qs}`} />
        <StatTile testId="kpi-interview" label="面談実施率" value={fmtPct(ratio(c.appt_done, pastAppt))} sub={`期間内の面談予定 ${fmtNum(pastAppt)}件中 実施 ${fmtNum(c.appt_done)}件`} href="/appointments?view=past" />
        <StatTile testId="kpi-callable" label={view.personal ? "担当の架電可能件数" : "架電可能件数"} value={fmtNum(k.totals.callable)} sub={`うち未架電 ${fmtNum(k.totals.untouchedCallable)}件${k.totals.contacts !== null ? `／総顧客 ${fmtNum(k.totals.contacts)}件` : ""}`} href={view.personal ? "/call-center" : "/contacts?callable=1"} />
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader><CardTitle>推移</CardTitle><Link href={`/analytics/sales?${qs}`} className="text-xs text-accent-blue hover:underline">営業分析へ</Link></CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {(["calls", "connects", "appointments"] as const).map((key) => (
              <div key={key}>
                <p className="mb-1 text-xs font-medium text-slate-600">{{ calls: "架電数", connects: "接続数", appointments: "アポ数" }[key]}</p>
                <TrendChart data={k.series} dataKey={key} label={`${key} の推移`} />
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>架電結果の内訳</CardTitle></CardHeader>
          <CardContent><ResultBars data={k.resultBreakdown.filter((r) => r.count > 0 || ["appointment", "no_answer", "recall"].includes(r.code))} /></CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card>
          <CardHeader><CardTitle>時間帯別 架電数</CardTitle><Link href={`/analytics/hours?${qs}`} className="text-xs text-accent-blue hover:underline">詳細</Link></CardHeader>
          <CardContent><HourChart data={k.byHour} /></CardContent>
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>{view.personal ? "リスト別の実績" : "担当者別ランキング"}</CardTitle>
            <Link href={`/analytics/${view.personal ? "lists" : "members"}?${qs}`} className="text-xs text-accent-blue hover:underline">すべて表示</Link>
          </CardHeader>
          <CardContent className="p-0">
            {view.personal ? (
              <PerfTable rows={k.byList.slice(0, 8).map((r) => ({ key: r.listId, ...r }))} nameLabel="架電リスト" />
            ) : (
              <PerfTable testId="ranking" rows={k.byUser.slice(0, 8).map((r) => ({ key: r.userId, href: `/dashboard?${kpiQueryString({ ...filter, userId: r.userId })}`, ...r }))} nameLabel="担当者" />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
