import "server-only";
import { cache } from "react";
import { z } from "zod";
import { createSupabaseServer } from "@/lib/supabase/server";
import { addDaysJst, todayJst } from "@/lib/format";

export type KpiPreset = "today" | "yesterday" | "7d" | "30d" | "month" | "lastMonth" | "custom";
export const PRESET_LABEL: Record<KpiPreset, string> = {
  today: "本日", yesterday: "昨日", "7d": "直近7日", "30d": "直近30日", month: "今月", lastMonth: "先月", custom: "期間指定",
};

export type KpiFilter = { preset: KpiPreset; from: string; to: string; userId?: string; teamId?: string; listId?: string; source?: string };

const dateRe = /^\d{4}-\d{2}-\d{2}$/;
const uuid = z.uuid().optional().catch(undefined);

/** URL クエリ → 集計条件（不正値は既定にフォールバック） */
export function kpiFilterFromParams(sp: Record<string, string | string[] | undefined>, fallback: KpiPreset = "today"): KpiFilter {
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const preset = (Object.keys(PRESET_LABEL) as KpiPreset[]).includes(s("period") as KpiPreset) ? (s("period") as KpiPreset) : fallback;
  const today = todayJst();
  let from = today, to = today;
  switch (preset) {
    case "yesterday": from = to = addDaysJst(today, -1); break;
    case "7d": from = addDaysJst(today, -6); break;
    case "30d": from = addDaysJst(today, -29); break;
    case "month": from = `${today.slice(0, 8)}01`; break;
    case "lastMonth": {
      const first = `${today.slice(0, 8)}01`;
      to = addDaysJst(first, -1);
      from = `${to.slice(0, 8)}01`;
      break;
    }
    case "custom": {
      const f = s("from"), t = s("to");
      if (f && dateRe.test(f)) from = f;
      if (t && dateRe.test(t)) to = t;
      if (from > to) [from, to] = [to, from];
      // 最大 366 日
      if (addDaysJst(from, 366) < to) from = addDaysJst(to, -365);
    }
  }
  const src = s("source");
  return {
    preset, from, to,
    userId: uuid.parse(s("user")), teamId: uuid.parse(s("team")), listId: uuid.parse(s("list")),
    source: src && ["kintone", "lp", "manual"].includes(src) ? src : undefined,
  };
}

export function kpiQueryString(f: KpiFilter, extra: Record<string, string> = {}) {
  const q = new URLSearchParams();
  q.set("period", f.preset);
  if (f.preset === "custom") { q.set("from", f.from); q.set("to", f.to); }
  if (f.userId) q.set("user", f.userId);
  if (f.teamId) q.set("team", f.teamId);
  if (f.listId) q.set("list", f.listId);
  if (f.source) q.set("source", f.source);
  for (const [k, v] of Object.entries(extra)) q.set(k, v);
  return q.toString();
}

type Row = { calls: number; connects: number; appointments: number };
export type KpiData = {
  range: { from: string; to: string; granularity: "day" | "week" | "month" };
  scope: "all" | "team" | "user";
  totals: { contacts: number | null; callable: number; untouchedCallable: number };
  current: Row & { unique_contacts: number; talk_sec: number; answered: number; appt_target: number; appt_done: number; work_hours: number | null };
  previous: Row;
  series: (Row & { bucket: string })[];
  resultBreakdown: { code: string; label: string; category: string; count: number }[];
  byHour: { hour: number; calls: number; connects: number }[];
  byUser: (Row & { userId: string; name: string })[];
  byTeam: (Row & { teamId: string; name: string })[];
  byList: (Row & { listId: string; name: string })[];
  bySource: (Row & { source: string })[];
  goals: Partial<Record<"calls" | "connects" | "appointments" | "revenue", number>>;
};

/** KPI の唯一の定義は DB の kpi_dashboard()。権限によるスコープも DB 側で決まる。 */
export const getKpi = cache(async (f: KpiFilter): Promise<KpiData> => {
  const supabase = await createSupabaseServer();
  const { data, error } = await supabase.rpc("kpi_dashboard", {
    p: { from: f.from, to: f.to, granularity: granularityOf(f), userId: f.userId ?? "", teamId: f.teamId ?? "", listId: f.listId ?? "", source: f.source ?? "" },
  });
  if (error) throw new Error(`KPI の取得に失敗しました（${error.code ?? "unknown"}）`);
  const d = data as KpiData;
  return { ...d, series: fillSeries(d.series, f, d.range.granularity) };
});

/** 62日以内は日別、それ以上は週別・月別 */
export function granularityOf(f: KpiFilter) {
  const days = (Date.parse(f.to) - Date.parse(f.from)) / 86400000 + 1;
  return days <= 62 ? "day" : days <= 200 ? "week" : "month";
}

/** 実績ゼロの期間も 0 として並べる（線が途切れて見えないように） */
function fillSeries(series: KpiData["series"], f: KpiFilter, gran: string) {
  if (gran !== "day") return series;
  const map = new Map(series.map((s) => [s.bucket, s]));
  const out: KpiData["series"] = [];
  for (let d = f.from; d <= f.to; d = addDaysJst(d, 1)) out.push(map.get(d) ?? { bucket: d, calls: 0, connects: 0, appointments: 0 });
  return out;
}

/** フィルタ用の選択肢（RLS により見える範囲のみ） */
export const getKpiOptions = cache(async () => {
  const supabase = await createSupabaseServer();
  const [users, teams, lists] = await Promise.all([
    supabase.from("users").select("id, name").eq("status", "active").order("name"),
    supabase.from("teams").select("id, name").order("name"),
    supabase.from("call_lists").select("id, name").neq("status", "archived").order("created_at", { ascending: false }).limit(100),
  ]);
  return { users: users.data ?? [], teams: teams.data ?? [], lists: lists.data ?? [] };
});
