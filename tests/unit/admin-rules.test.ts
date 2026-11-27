import { describe, expect, it } from "vitest";
import { RULE_SCHEMAS } from "@/lib/admin-rules";

describe("架電ルールの入力検証", () => {
  it("架電時間帯：開始 < 終了、曜日 1 つ以上", () => {
    expect(RULE_SCHEMAS.calling_hours.safeParse({ start: "10:00", end: "20:00", days: [1], enforce: true }).success).toBe(true);
    expect(RULE_SCHEMAS.calling_hours.safeParse({ start: "21:00", end: "20:00", days: [1], enforce: true }).success).toBe(false);
    expect(RULE_SCHEMAS.calling_hours.safeParse({ start: "10:00", end: "20:00", days: [], enforce: true }).success).toBe(false);
  });
  it("優先順位は全項目を重複なく", () => {
    expect(RULE_SCHEMAS.assignment_priority.safeParse(["lp_new", "recall_today", "consult_wanted", "untouched", "recall_absent"]).success).toBe(true);
    expect(RULE_SCHEMAS.assignment_priority.safeParse(["lp_new", "lp_new", "consult_wanted", "untouched", "recall_absent"]).success).toBe(false);
  });
  it("数値の範囲", () => {
    expect(RULE_SCHEMAS.export_max_rows.safeParse(0).success).toBe(false);
    expect(RULE_SCHEMAS.auto_logout_minutes.safeParse(1).success).toBe(false);
  });
});
