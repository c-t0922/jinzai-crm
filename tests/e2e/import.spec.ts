/** 顧客 CSV 取り込み（架空データ・Shift_JIS・1,200 行でバッチ分割を確認） */
import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { login, sql } from "./helpers";

test.describe.configure({ mode: "serial" });
const APP = `e2e-${Date.now()}`;
const N = 1200;

function csvSjis() {
  const lines = ["レコード番号,氏名,フリガナ,携帯電話,自宅電話,メールアドレス,都道府県,問合せ日,住宅ローン審査結果,人材案内同意"];
  for (let i = 1; i <= N; i++) {
    const tel = i === 3 ? "" : `090-7${String(i).padStart(3, "0").slice(-3)}-${String(i).padStart(4, "0")}`;
    const consent = i % 3 === 0 ? "同意する" : i % 3 === 1 ? "同意しない" : "";
    lines.push([i === 5 ? "" : `R${i}`, `架空　取込${i}`, `カクウ　トリコミ`, tel, i === 2 ? "03-0000-0002" : "", `t${i}@example.test`, "東京", "2024/4/1", "承認", consent].join(","));
  }
  // テスト用 CSV を Shift_JIS（cp932）で作る
  return execFileSync("python3", ["-c", "import sys; sys.stdout.buffer.write(sys.stdin.read().encode('cp932'))"], { input: lines.join("\r\n") });
}

test("管理者は CSV を取り込め、許諾の根拠がある行だけ架電可能になる", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, "admin@example.test", "/admin/import");
  await page.getByTestId("csv-file").setInputFiles({ name: "kintone.csv", mimeType: "text/csv", buffer: csvSjis() });
  await expect(page.getByText(`${N.toLocaleString()} 行・Shift_JIS`)).toBeVisible();
  await expect(page.getByText("住宅ローン審査結果", { exact: false }).first()).toBeVisible();
  // ローン列は対応付けの候補で選べない
  await expect(page.locator("#map-phone1 option", { hasText: "住宅ローン審査結果（取り込み不可）" })).toBeDisabled();
  await page.fill("#app-id", APP);
  await page.selectOption("#consent-col", { label: "人材案内同意" });
  await page.getByLabel("同意する の扱い").selectOption("granted");
  await page.getByLabel("同意しない の扱い").selectOption("denied");
  await expect(page.getByTestId("import-run")).toBeDisabled();
  await page.fill("#basis", "E2E テスト用の架空の根拠");
  await page.getByRole("checkbox").check();
  await expect(page.getByTestId("import-check")).toContainText("1"); // 取り込めない行（レコード番号なし）
  await page.getByTestId("import-run").click();
  await expect(page.getByTestId("import-result")).toContainText("取り込み結果", { timeout: 90_000 });
  await expect(page.getByTestId("import-result")).toContainText(`新規 ${(N - 1).toLocaleString()}`);

  const [r] = await sql<{ n: number; callable: number; granted: number; snap: number }>(
    `select count(*)::int n, count(*) filter (where c.callable)::int callable, count(*) filter (where c.consent_status = 'granted')::int granted,
            count(*) filter (where s.raw_snapshot is not null)::int snap
     from contact_sources s join contacts c on c.id = s.contact_id where s.source_app_id = $1`, [APP]);
  expect(r.n).toBe(N - 1);
  expect(r.granted).toBe(400);
  expect(r.callable).toBe(400 - 1); // R3 は電話なし
  expect(r.snap).toBe(0);
  const [loan] = await sql<{ n: number }>(`select count(*)::int n from contacts c join contact_sources s on s.contact_id = c.id
    where s.source_app_id = $1 and (c.tags::text like '%承認%' or c.source_detail like '%承認%')`, [APP]);
  expect(loan.n).toBe(0);

  // 同じファイルを再投入しても二重登録しない
  await page.getByTestId("csv-file").setInputFiles({ name: "kintone.csv", mimeType: "text/csv", buffer: csvSjis() });
  await page.fill("#app-id", APP);
  await page.getByRole("checkbox").check();
  await page.getByTestId("import-run").click();
  await expect(page.getByTestId("import-result")).toContainText("新規 0", { timeout: 90_000 });
  const [again] = await sql<{ n: number }>(`select count(*)::int n from contact_sources where source_app_id = $1`, [APP]);
  expect(again.n).toBe(N - 1);
  await expect(page.getByText("取り込めなかった行（1 件）")).toBeVisible();
});

test("架電担当者は取り込み画面を開けない", async ({ page }) => {
  await login(page, "caller01@example.test");
  await page.goto("/admin/import");
  await expect(page.getByTestId("csv-file")).toHaveCount(0);
});

test.describe("顧客分析（性別・年代・居住地）", () => {
  test("管理者は人数の集計と共有用テキストを見られる（個人情報は出ない）", async ({ page }) => {
    await login(page, "admin@example.test", "/analytics/segments");
    await expect(page.getByTestId("segments-summary")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("segments-age-gender")).toContainText("30代");
    await expect(page.getByTestId("segments-pref")).toContainText("東京都");
    await page.getByTestId("share-toggle").click();
    const text = await page.getByTestId("share-text").inputValue();
    expect(text).toContain("■ 年代×性別");
    expect(text).not.toMatch(/@example\.test|\+81|090-/);
    await page.getByRole("link", { name: "架電可能のみ" }).click();
    await expect(page).toHaveURL(/scope=callable/);
    await expect(page.getByTestId("segments-summary")).toContainText("架電可能な顧客");
  });

  test("架電担当者は顧客分析を開けない", async ({ page }) => {
    await login(page, "caller01@example.test", "/analytics/segments");
    await expect(page).toHaveURL(/\/forbidden/);
  });
});
