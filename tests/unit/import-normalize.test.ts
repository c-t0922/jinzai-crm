import { describe, expect, it } from "vitest";
import { birthYearFromAge, convertRow, guessMapping, isBlockedColumn, normalizeGender, normalizePhoneJp, normalizePref, parseBirthDate, parseDateJst, splitName } from "@/lib/import/normalize";

describe("電話番号の正規化（架空の番号）", () => {
  it.each([
    ["090-0000-1234", "+819000001234"],
    ["０９０－００００－１２３４", "+819000001234"],
    ["9000001234", "+819000001234"],
    ["+81 90 0000 1234", "+819000001234"],
    ["03-0000-1234", "+81300001234"],
    ["(03)0000-1234", "+81300001234"],
  ])("%s → %s", (raw, e164) => expect(normalizePhoneJp(raw)).toBe(e164));
  it.each(["", "123", "0120-000-000", "0570-000-000", "abc"])("%s は無効", (raw) => expect(normalizePhoneJp(raw)).toBeNull());
});

describe("その他の正規化", () => {
  it("氏名の分割（全角スペース）", () => expect(splitName("山田　太郎")).toEqual(["山田", "太郎"]));
  it("区切りなしは姓のみ", () => expect(splitName("山田太郎")).toEqual(["山田太郎", ""]));
  it("日付", () => {
    expect(parseDateJst("2024/1/5")).toBe("2024-01-04T15:00:00.000Z");
    expect(parseDateJst("2024年1月5日")).toBe("2024-01-04T15:00:00.000Z");
    expect(parseDateJst("20240105")).toBe("2024-01-04T15:00:00.000Z");
    expect(parseDateJst("2024-13-01")).toBeNull();
  });
  it("都道府県", () => {
    expect(normalizePref("東京都港区")).toBe("東京都");
    expect(normalizePref("大阪")).toBe("大阪府");
    expect(normalizePref("不明")).toBeNull();
  });
});

describe("取り込み禁止の列", () => {
  it.each(["住宅ローン審査結果", "借入状況", "年収", "自己資金", "金融資産"])("%s は取り込まない", (h) => expect(isBlockedColumn(h)).toBe(true));
  it.each(["氏名", "電話番号", "都道府県"])("%s は取り込める", (h) => expect(isBlockedColumn(h)).toBe(false));
  it("推測でも禁止列は選ばれない", () => {
    const m = guessMapping(["レコード番号", "氏名", "携帯電話", "住宅ローン審査結果", "年収"]);
    expect(m).toEqual({ recordId: 0, fullName: 1, phone1: 2 });
  });
});

describe("1 行の変換", () => {
  const headers = ["レコード番号", "氏名", "フリガナ", "携帯電話", "自宅電話", "メールアドレス", "都道府県", "問合せ日", "人材案内同意"];
  const map = guessMapping(headers);
  it("正常", () => {
    const r = convertRow(["101", "架空　花子", "カクウ　ハナコ", "090-0000-0001", "03-0000-0001", "Hanako@Example.TEST", "神奈川", "2024/05/01", "同意する"], map,
      { column: 8, grantedValues: ["同意する"], deniedValues: ["同意しない"] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.row).toMatchObject({ recordId: "101", lastName: "架空", firstName: "花子", lastKana: "カクウ", phones: ["+819000000001", "+81300000001"], email: "hanako@example.test", pref: "神奈川県", consent: "granted" });
  });
  it("許諾の値が想定外なら未確認のまま（架電不可）", () => {
    const r = convertRow(["102", "架空 一郎", "", "090-0000-0002", "", "", "", "", "不明"], map, { column: 8, grantedValues: ["同意する"], deniedValues: [] });
    expect(r.ok && r.row.consent).toBeNull();
  });
  it("レコード番号・氏名なしはエラー", () => {
    expect(convertRow(["", "架空 一郎"], map).ok).toBe(false);
    expect(convertRow(["103", ""], map).ok).toBe(false);
  });
  it("電話なしは警告付きで取り込む", () => {
    const r = convertRow(["104", "架空 次郎", "", "", "", "", "", "", ""], map);
    expect(r.ok && r.warnings.join()).toContain("有効な電話番号なし");
  });
});

describe("性別・生年月日・年齢", () => {
  it.each([["男", "male"], ["女性", "female"], ["Ｍ", "male"], ["female", "female"], ["その他", "other"], ["?", null], ["", null]])("性別 %s → %s", (raw, v) => expect(normalizeGender(raw)).toBe(v));
  const today = new Date("2026-11-28T00:00:00Z");
  it.each([
    ["1990/4/1", "1990-04-01"],
    ["19900401", "1990-04-01"],
    ["昭和55年1月2日", "1980-01-02"],
    ["S55.1.2", "1980-01-02"],
    ["平成元年5月6日", "1989-05-06"],
  ])("生年月日 %s → %s", (raw, v) => expect(parseBirthDate(raw, today)).toBe(v));
  it.each(["2030/1/1", "1899/12/31", "1990/2/30", "abc"])("生年月日 %s は無効", (raw) => expect(parseBirthDate(raw, today)).toBeNull());
  it("年齢から生まれ年（JST の今年基準）", () => {
    expect(birthYearFromAge("35", today)).toBe(1991);
    expect(birthYearFromAge("３５歳", today)).toBe(1991);
    expect(birthYearFromAge("5", today)).toBeNull();
    expect(birthYearFromAge("abc", today)).toBeNull();
  });
  it("取り込み行に性別・生年が入る（生年月日を優先）", () => {
    const r = convertRow(["1", "山田 花子", "女", "1990-04-01", "40"], { recordId: 0, fullName: 1, gender: 2, birthDate: 3, age: 4 });
    expect(r.ok && r.row).toMatchObject({ gender: "female", birthDate: "1990-04-01", birthYear: 1990 });
    const r2 = convertRow(["2", "山田 太郎", "", "", "40"], { recordId: 0, fullName: 1, gender: 2, birthDate: 3, age: 4 });
    expect(r2.ok && r2.row.birthYear).toBe(new Date(Date.now() + 9 * 3600_000).getUTCFullYear() - 40);
  });
  it("列名から性別・生年月日・年齢を推測", () => {
    expect(guessMapping(["レコード番号", "氏名", "性別", "生年月日", "年齢"])).toMatchObject({ gender: 2, birthDate: 3, age: 4 });
  });
});
