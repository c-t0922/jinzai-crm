import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/server/auth/session";
import { AGE_LABEL, AGES, byPref, GENDER_LABEL, GENDERS, getSegments, shareText, sum, type SegmentCell, type Totals } from "@/server/domain/analytics/segments";
import { PageBody, PageHeader } from "@/components/layout/page";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { ShareBox } from "@/features/analytics/share-box";
import { fmtNum, fmtPct, ratio, todayJst } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "顧客分析" };

export default async function SegmentsPage({ searchParams }: { searchParams: Promise<{ scope?: string }> }) {
  await requireUser("analytics.segments");
  const sp = await searchParams;
  const callableOnly = sp.scope === "callable";
  const cells = await getSegments(callableOnly);
  const all = sum(cells);
  const scopeLabel = callableOnly ? "架電可能な顧客" : "全顧客";
  const known = (pred: (c: SegmentCell) => boolean) => sum(cells.filter(pred)).n;
  const prefs = byPref(cells);
  return (
    <>
      <PageHeader title="顧客分析" description="性別・年代・居住地ごとの人数と架電の成果。人数の集計のみで、個人は表示しません" />
      <PageBody className="space-y-4">
        <nav className="flex gap-1 border-b border-border" aria-label="対象の切り替え">
          {[["all", "全顧客"], ["callable", "架電可能のみ"]].map(([k, label]) => {
            const active = (k === "callable") === callableOnly;
            return (
              <Link key={k} href={k === "all" ? "/analytics/segments" : "/analytics/segments?scope=callable"} aria-current={active ? "page" : undefined}
                className={cn("-mb-px border-b-2 px-3 py-2 text-sm", active ? "border-accent-blue font-medium text-primary" : "border-transparent text-slate-500 hover:text-slate-800")}>
                {label}
              </Link>
            );
          })}
        </nav>

        {all.n === 0 ? (
          <Card><CardContent className="py-10 text-center text-sm text-slate-500" data-testid="segments-empty">
            対象の顧客がいません。<Link href="/admin/import" className="text-accent-blue hover:underline">顧客CSV取り込み</Link>で取り込むと、ここに集計が表示されます。
          </CardContent></Card>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="segments-summary">
              <Stat label={scopeLabel} value={fmtNum(all.n)} unit="人" />
              <Stat label="性別が分かる" value={fmtPct(ratio(known((c) => c.gender !== "unknown"), all.n))} />
              <Stat label="年代が分かる" value={fmtPct(ratio(known((c) => c.age !== "unknown"), all.n))} />
              <Stat label="架電可能" value={fmtNum(all.callable)} unit="人" />
            </div>

            <Card>
              <CardHeader><CardTitle>年代 × 性別</CardTitle></CardHeader>
              <CardContent className="overflow-x-auto p-0">
                <Table data-testid="segments-age-gender">
                  <THead><TR>
                    <TH>年代</TH>
                    {GENDERS.map((g) => <TH key={g} className="text-right">{GENDER_LABEL[g]}</TH>)}
                    <TH className="text-right">計</TH><TH className="text-right">構成比</TH>
                    <TH className="text-right">架電済</TH><TH className="text-right">接続率</TH><TH className="text-right">アポ率（接続比）</TH>
                  </TR></THead>
                  <TBody>
                    {AGES.map((a) => {
                      const row = cells.filter((c) => c.age === a);
                      const t = sum(row);
                      return (
                        <TR key={a}>
                          <TD className="font-medium">{AGE_LABEL[a]}</TD>
                          {GENDERS.map((g) => <TD key={g} className="text-right tabular-nums">{fmtNum(sum(row.filter((c) => c.gender === g)).n)}</TD>)}
                          <ResultCells t={t} total={all.n} />
                        </TR>
                      );
                    })}
                  </TBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>都道府県 × 年代（居住地・多い順）</CardTitle></CardHeader>
              <CardContent className="overflow-x-auto p-0">
                <Table data-testid="segments-pref">
                  <THead><TR>
                    <TH>都道府県</TH>
                    {AGES.map((a) => <TH key={a} className="text-right">{AGE_LABEL[a]}</TH>)}
                    <TH className="text-right">計</TH><TH className="text-right">構成比</TH>
                    <TH className="text-right">架電済</TH><TH className="text-right">接続率</TH><TH className="text-right">アポ率（接続比）</TH>
                  </TR></THead>
                  <TBody>
                    {prefs.map((p) => {
                      const row = cells.filter((c) => c.pref === p.pref);
                      return (
                        <TR key={p.pref}>
                          <TD className="whitespace-nowrap font-medium">{p.pref}</TD>
                          {AGES.map((a) => <TD key={a} className="text-right tabular-nums">{fmtNum(sum(row.filter((c) => c.age === a)).n)}</TD>)}
                          <ResultCells t={p} total={all.n} />
                        </TR>
                      );
                    })}
                  </TBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>分析を依頼する</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm text-slate-600">
                <p>下の「集計をコピー」で、この画面の数字だけをテキストにできます。氏名・電話番号などは含まれず、5人未満の数字は「&lt;5」に伏せています。Claude に貼り付けると、市場の分析と「どの層にどんな仕事が合いそうか」をまとめます。</p>
                <ShareBox text={shareText(cells, scopeLabel, todayJst())} />
              </CardContent>
            </Card>
          </>
        )}
        <p className="text-xs text-slate-500">
          年代は今日（日本時間）時点の年齢。年齢だけ取り込んだ顧客は生まれ年から概算。出身地（本籍・出生地）は職業安定法の指針により扱いません。
          性別・年代は市場を把握するための集計に使い、個別の求人紹介は本人の希望・経験をもとに行います。分母 0 は「未計測」。
        </p>
      </PageBody>
    </>
  );
}

function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <Card><CardContent className="p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}{unit && value !== "—" ? <span className="ml-0.5 text-sm font-normal text-slate-500">{unit}</span> : null}</p>
    </CardContent></Card>
  );
}

function ResultCells({ t, total }: { t: Totals; total: number }) {
  return (
    <>
      <TD className="text-right font-medium tabular-nums">{fmtNum(t.n)}</TD>
      <TD className="text-right tabular-nums text-slate-500">{fmtPct(ratio(t.n, total))}</TD>
      <TD className="text-right tabular-nums">{fmtNum(t.called)}</TD>
      <TD className="text-right tabular-nums">{fmtPct(ratio(t.connected, t.called))}</TD>
      <TD className="text-right tabular-nums">{fmtPct(ratio(t.appointments, t.connected))}</TD>
    </>
  );
}
