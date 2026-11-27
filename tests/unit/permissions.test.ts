import { describe, expect, it } from "vitest";
import { can, requiresMfa, ROLES, type Permission } from "@/lib/permissions";

describe("権限マトリクス（docs/06 と一致）", () => {
  it("架電担当は CSV 出力・一括操作・管理画面にアクセスできない", () => {
    for (const p of ["contacts.export", "contacts.bulk", "admin.view", "admin.users", "calllists.manage"] as Permission[]) {
      expect(can(["caller"], p)).toBe(false);
    }
  });
  it("経営陣は個人情報（顧客一覧）を見られないが KPI は見られる", () => {
    expect(can(["executive"], "contacts.view")).toBe(false);
    expect(can(["executive"], "dashboard.view")).toBe(true);
    expect(can(["executive"], "callcenter.use")).toBe(false);
  });
  it("架電禁止の解除・利用許諾の一括登録はシステム管理者のみ", () => {
    for (const r of ROLES) {
      expect(can([r], "suppression.release")).toBe(r === "admin");
      expect(can([r], "consent.bulk")).toBe(r === "admin");
    }
  });
  it("CSV 出力は管理者・PM のみ（仮仕様 C4）", () => {
    expect(ROLES.filter((r) => can([r], "contacts.export"))).toEqual(["admin", "pm"]);
  });
  it("兼務（TL + 架電）は和集合", () => {
    expect(can(["caller", "team_leader"], "calllists.manage")).toBe(true);
  });
  it("管理者・PM は MFA 必須", () => {
    expect(requiresMfa(["pm"])).toBe(true);
    expect(requiresMfa(["caller", "team_leader"])).toBe(false);
  });
});
