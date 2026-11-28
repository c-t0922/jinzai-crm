import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { getKpi, kpiFilterFromParams, kpiQueryString, PRESET_LABEL, type KpiData, type KpiFilter } from "@/server/domain/kpi/query";
import { PageBody, PageHeader } from "@/components/layout/page";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { HourChart, TrendChart } from "@/features/kpi/charts";
import { KpiFilterBar, PerfTable, scopeLabel } from "@/features/kpi/kpi-shell";
import { SOURCE_LABEL } from "@/components/status";
import { fmtNum, fmtPct, ratio } from "@/lib/format";
import { cn } from "@/lib/utils";

const VIEWS = {
  sales: { title: "営業分析", desc: "架電 → 接続 → アポイントの推移と転換率" },
  members: { title: "担当者別実績", desc: "担当者・チームごとの架電実績" },
  lists: { title: "リスト別分析", desc: "架電リストごとの成果" },
  hours: { title: "時間帯別分析", desc: "どの時間帯につながりやすいか" },
  sources: { title: "流入経路別分析", desc: "kintone（住宅）・人材LP など流入元ごとの成果" },
} as const;
type View = keyof typeof VIEWS;

export async function generateMetadata({ params }: { params: Promise<{ view: string }> }): Promise<Metadata> {
  const { view } = await params;
  return { title: VIEWS[view as View]?.title ?? "分析" };
}

export default async function AnalyticsPage({ params, searchParams }: { params: Promise<{ view: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { view } = await params;
  if (!(view in VIEWS)) notFound();
  const me = await requireUser("analytics.view");
  const filter = kpiFilterFromParams(await searchParams, "30d");
  const k = await getKpi(filter);
  const qs = kpiQueryString(filter);
  const v = VIEWS[view as View];
  return (
    <>
      <PageHeader title={v.title} description={v.desc} />
      <PageBody className="space-y-4">
        <nav className="flex flex-wrap gap-1 border-b border-border" aria-label="分析の切り替え">
          {(Object.keys(VIEWS) as View[]).map((key) => (
            <Link key={key} href={`/analytics/${key}?${qs}`} aria-current={key === view ? "page" : undefined}
              className={cn("-mb-px border-b-2 px-3 py-2 text-sm", key === view ? "border-accent-blue font-medium text-primary" : "border-transparent text-slate-500 hover:text-slate-800")}>
              {VIEWS[key].title}
            </Link>
          ))}
        </nav>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <KpiFilterBar me={me} filter={filter} />
          <p className="text-xs text-slate-500">
            <Badge tone="blue">{scopeLabel(k.scope, me, filter)}</Badge> {PRESET_LABEL[filter.preset]} {filter.from.replaceAll("-", "/")}〜{filter.to.replaceAll("-", "/")}
          </p>
        </div>
        {view === "sales" ? <Sales k={k} /> : null}
        {view === "members" ? <Members k={k} filter={filter} /> : null}
        {view === "lists" ? (
          <Card><CardContent className="p-0"><PerfTable testId="by-list" nameLabel="架電リスト" rows={k.byList.map((r) => ({ key: r.listId, href: `/call-lists/${r.listId}`, ...r }))} /></CardContent></Card>
        ) : null}
        {view === "hours" ? <Hours k={k} /> : null}
        {view === "sources" ? (
          <Card><CardContent className="p-0"><PerfTable testId="by-source" nameLabel="流入経路" rows={k.bySource.map((r) => ({ key: r.source ?? "none", name: SOURCE_LABEL[r.source] ?? r.source ?? "不明", ...r }))} /></CardContent></Card>
        ) : null}
        <p className="text-xs text-slate-500">
          指標の定義：接続率＝接続数÷架電数、アポ率（接続比）＝アポ数÷接続数、架電アポ率＝アポ数÷架電数。分母 0 は「未計測」。集計は JST の日付境界。
        </p>
      </PageBody>
    </>
  );
}

function Sales({ k }: { k: KpiData }) {
  const c = k.current;
  const steps = [
    { label: "架電", n: c.calls },
    { label: "接続", n: c.connects },
    { label: "アポイント", n: c.appointments },
    { label: "面談実施", n: c.appt_done },
  ];
  const gLabel = { day: "日", week: "週", month: "月" }[k.range.granularity];
  return (
    <>
      <Card>
        <CardHeader><CardTitle>転換ファネル</CardTitle></CardHeader>
        <CardContent>
          <ol className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="funnel">
            {steps.map((s, i) => (
              <li key={s.label} className="rounded-md border border-border p-3">
                <p className="text-xs text-slate-500">{s.label}</p>
                <p className="tabular text-xl font-semibold">{fmtNum(s.n)}</p>
                {i > 0 ? <p className="tabular text-xs text-slate-500">前段からの転換 {fmtPct(ratio(s.n, steps[i - 1].n))}</p> : <p className="text-xs text-slate-400">起点</p>}
              </li>
            ))}
          </ol>
          <p className="mt-2 text-[11px] text-slate-500">面談実施は期間内に予定日がある面談のうち実施済みの件数（獲得日ベースではありません）。</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>{gLabel}別の推移</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {(["calls", "connects", "appointments"] as const).map((key) => (
            <div key={key}>
              <p className="mb-1 text-xs font-medium text-slate-600">{{ calls: "架電数", connects: "接続数", appointments: "アポ数" }[key]}</p>
              <TrendChart data={k.series} dataKey={key} height={200} label={key} />
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>{gLabel}別の明細</CardTitle></CardHeader>
        <CardContent className="p-0">
          <PerfTable nameLabel={`${gLabel}`} rows={[...k.series].reverse().filter((s) => s.calls || s.connects || s.appointments).map((s) => ({ key: s.bucket, name: s.bucket.replaceAll("-", "/"), ...s }))} />
        </CardContent>
      </Card>
    </>
  );
}

function Members({ k, filter }: { k: KpiData; filter: KpiFilter }) {
  return (
    <>
      <Card>
        <CardHeader><CardTitle>担当者別</CardTitle></CardHeader>
        <CardContent className="p-0">
          <PerfTable testId="by-user" nameLabel="担当者" rows={k.byUser.map((r) => ({ key: r.userId, href: `/dashboard?${kpiQueryString({ ...filter, userId: r.userId, teamId: undefined })}`, ...r }))} />
        </CardContent>
      </Card>
      {k.byTeam.length ? (
        <Card>
          <CardHeader><CardTitle>チーム別</CardTitle></CardHeader>
          <CardContent className="p-0">
            <PerfTable testId="by-team" nameLabel="チーム" rows={k.byTeam.map((r) => ({ key: r.teamId, href: `/analytics/members?${kpiQueryString({ ...filter, teamId: r.teamId, userId: undefined })}`, ...r }))} />
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}

function Hours({ k }: { k: KpiData }) {
  const rows = Array.from({ length: 13 }, (_, i) => i + 9).map((h) => k.byHour.find((x) => x.hour === h) ?? { hour: h, calls: 0, connects: 0 });
  const best = rows.reduce<{ hour: number; r: number } | null>((b, x) => {
    const r = ratio(x.connects, x.calls);
    if (r === null || x.calls < 10) return b;
    return !b || r > b.r ? { hour: x.hour, r } : b;
  }, null);
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader><CardTitle>時間帯別 架電数</CardTitle></CardHeader>
        <CardContent>
          <HourChart data={k.byHour} height={260} />
          {best ? <p className="mt-2 text-xs text-slate-600">接続率が最も高い時間帯：<strong>{best.hour}時台（{fmtPct(best.r)}）</strong>（架電 10 件以上の時間帯が対象）</p> : null}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>時間帯別 接続率</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table data-testid="by-hour">
            <THead><TR><TH>時間帯</TH><TH className="text-right">架電数</TH><TH className="text-right">接続数</TH><TH className="text-right">接続率</TH></TR></THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.hour}>
                  <TD>{r.hour}時台</TD>
                  <TD className="tabular text-right">{fmtNum(r.calls)}</TD>
                  <TD className="tabular text-right">{fmtNum(r.connects)}</TD>
                  <TD className="tabular text-right">{fmtPct(ratio(r.connects, r.calls))}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
