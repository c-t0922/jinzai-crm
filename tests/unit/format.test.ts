import { describe, expect, it } from "vitest";
import { addDaysJst, displayPhone, fmtPct, maskPhone, ratio } from "@/lib/format";
import { fromLocalInput, toLocalInput } from "@/lib/datetime-local";
import { csvCell, toCsv } from "@/lib/csv";

describe("KPI の率（未計測の扱い）", () => {
  it("分母 0・null は未計測（0% にしない）", () => {
    expect(ratio(0, 0)).toBeNull();
    expect(ratio(5, null)).toBeNull();
    expect(fmtPct(ratio(3, 0))).toBe("未計測");
  });
  it("分子 0 は 0.0%（計測済み）", () => {
    expect(fmtPct(ratio(0, 10))).toBe("0.0%");
    expect(fmtPct(ratio(1, 3))).toBe("33.3%");
  });
});

describe("電話番号の表示・マスキング", () => {
  it("携帯は 3-4-4", () => expect(displayPhone("+819012345678")).toBe("090-1234-5678"));
  it("固定は 2-4-4", () => expect(displayPhone("+81312345678")).toBe("03-1234-5678"));
  it("架電担当者向けのマスキング", () => expect(maskPhone("+819012345678")).toBe("090-****-5678"));
  it("未登録は —", () => expect(maskPhone(null)).toBe("—"));
});

describe("JST の日付計算", () => {
  it("月跨ぎ", () => expect(addDaysJst("2026-11-30", 1)).toBe("2026-12-01"));
  it("年跨ぎ（逆方向）", () => expect(addDaysJst("2026-01-01", -1)).toBe("2025-12-31"));
  it("datetime-local は JST として往復できる", () => {
    const iso = fromLocalInput("2026-11-27T10:30");
    expect(iso).toBe("2026-11-27T01:30:00.000+00:00");
    expect(toLocalInput(iso)).toBe("2026-11-27T10:30");
  });
});

describe("CSV 出力", () => {
  it("数式インジェクションを無害化", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell("+81")).toBe(`"'+81"`);
    expect(csvCell("@SUM")).toBe(`"'@SUM"`);
  });
  it("null は空、ダブルクォートはエスケープ", () => {
    expect(csvCell(null)).toBe('""');
    expect(csvCell('a"b')).toBe('"a""b"');
  });
  it("BOM 付き・CRLF", () => {
    const s = toCsv(["a", "b"], [[1, 2]]);
    expect(s.startsWith("﻿")).toBe(true);
    expect(s).toContain("\r\n");
  });
});
