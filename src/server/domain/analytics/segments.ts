import "server-only";
import { z } from "zod";
import { createSupabaseServer } from "@/lib/supabase/server";
import { authorize } from "@/server/auth/session";

/** 顧客分析（性別・年代・都道府県）。人数のみを扱い、氏名・連絡先は扱わない */
export const GENDERS = ["male", "female", "other", "unknown"] as const;
export const AGES = ["u20", "20s", "30s", "40s", "50s", "60p", "unknown"] as const;
export type Gender = (typeof GENDERS)[number];
export type AgeBand = (typeof AGES)[number];
export const GENDER_LABEL: Record<Gender, string> = { male: "男性", female: "女性", other: "その他", unknown: "不明" };
export const AGE_LABEL: Record<AgeBand, string> = { u20: "〜19歳", "20s": "20代", "30s": "30代", "40s": "40代", "50s": "50代", "60p": "60歳〜", unknown: "不明" };

const cellSchema = z.object({
  gender: z.enum(GENDERS),
  age: z.enum(AGES),
  pref: z.string(),
  n: z.number(),
  callable: z.number(),
  called: z.number(),
  connected: z.number(),
  appointments: z.number(),
});
export type SegmentCell = z.infer<typeof cellSchema>;
export type Totals = Omit<SegmentCell, "gender" | "age" | "pref">;

export async function getSegments(callableOnly: boolean): Promise<SegmentCell[]> {
  await authorize("analytics.segments");
  const supabase = await createSupabaseServer();
  const { data, error } = await supabase.rpc("contact_segments", { p_callable_only: callableOnly });
  if (error) throw new Error("SEGMENTS_FAILED");
  return z.array(cellSchema).parse(data ?? []);
}

export function sum(cells: SegmentCell[]): Totals {
  return cells.reduce<Totals>(
    (a, c) => ({ n: a.n + c.n, callable: a.callable + c.callable, called: a.called + c.called, connected: a.connected + c.connected, appointments: a.appointments + c.appointments }),
    { n: 0, callable: 0, called: 0, connected: 0, appointments: 0 },
  );
}

/** 共有用テキスト（AI・社外に渡す想定）。5 人未満のセルは「<5」に伏せる */
export function shareText(cells: SegmentCell[], scopeLabel: string, today: string): string {
  const v = (n: number) => (n === 0 ? "0" : n < 5 ? "<5" : String(n));
  const lines: string[] = [`顧客分析（${scopeLabel}・${today} 時点・人数のみ。5人未満は <5）`, ""];
  const all = sum(cells);
  lines.push(`総数\t${v(all.n)}\t架電可能\t${v(all.callable)}\t架電済\t${v(all.called)}\t接続\t${v(all.connected)}\tアポ\t${v(all.appointments)}`, "");
  lines.push("■ 年代×性別", ["年代", ...GENDERS.map((g) => GENDER_LABEL[g]), "計", "架電済", "接続", "アポ"].join("\t"));
  for (const a of AGES) {
    const row = cells.filter((c) => c.age === a);
    const t = sum(row);
    lines.push([AGE_LABEL[a], ...GENDERS.map((g) => v(sum(row.filter((c) => c.gender === g)).n)), v(t.n), v(t.called), v(t.connected), v(t.appointments)].join("\t"));
  }
  lines.push("", "■ 都道府県×年代（多い順）", ["都道府県", ...AGES.map((a) => AGE_LABEL[a]), "計", "男性", "女性", "架電済", "接続", "アポ"].join("\t"));
  for (const p of byPref(cells)) {
    const row = cells.filter((c) => c.pref === p.pref);
    lines.push([p.pref, ...AGES.map((a) => v(sum(row.filter((c) => c.age === a)).n)), v(p.n), v(sum(row.filter((c) => c.gender === "male")).n), v(sum(row.filter((c) => c.gender === "female")).n), v(p.called), v(p.connected), v(p.appointments)].join("\t"));
  }
  return lines.join("\n");
}

export function byPref(cells: SegmentCell[]): (Totals & { pref: string })[] {
  const m = new Map<string, SegmentCell[]>();
  for (const c of cells) m.set(c.pref, [...(m.get(c.pref) ?? []), c]);
  return [...m.entries()].map(([pref, cs]) => ({ pref, ...sum(cs) })).sort((a, b) => b.n - a.n);
}
