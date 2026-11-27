import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createSupabaseServer: vi.fn() }));
vi.mock("@/lib/format", async (orig) => ({ ...(await orig<typeof import("@/lib/format")>()), todayJst: () => "2026-11-27" }));

const { kpiFilterFromParams, kpiQueryString, granularityOf } = await import("@/server/domain/kpi/query");

describe("KPI の集計条件", () => {
  it("既定は本日", () => expect(kpiFilterFromParams({})).toMatchObject({ preset: "today", from: "2026-11-27", to: "2026-11-27" }));
  it("直近7日は当日を含む7日間", () => expect(kpiFilterFromParams({ period: "7d" })).toMatchObject({ from: "2026-11-21", to: "2026-11-27" }));
  it("先月", () => expect(kpiFilterFromParams({ period: "lastMonth" })).toMatchObject({ from: "2026-10-01", to: "2026-10-31" }));
  it("期間指定の逆転は入れ替え、不正な UUID・流入経路は無視", () => {
    const f = kpiFilterFromParams({ period: "custom", from: "2026-11-10", to: "2026-11-01", user: "x' or 1=1", source: "evil" });
    expect(f).toMatchObject({ from: "2026-11-01", to: "2026-11-10", userId: undefined, source: undefined });
  });
  it("粒度：62日以内は日別", () => {
    expect(granularityOf({ preset: "custom", from: "2026-10-01", to: "2026-11-27" })).toBe("day");
    expect(granularityOf({ preset: "custom", from: "2026-01-01", to: "2026-11-27" })).toBe("month");
  });
  it("URL への往復", () => {
    const f = kpiFilterFromParams({ period: "custom", from: "2026-11-01", to: "2026-11-10", source: "lp" });
    expect(kpiFilterFromParams(Object.fromEntries(new URLSearchParams(kpiQueryString(f))))).toEqual(f);
  });
});
