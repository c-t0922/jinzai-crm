/** 異常系・非機能（docs/12_test_plan.md 3章）。権限違反・同時操作・二重登録・通信断・発信前チェック・自動ログアウト・表示 */
import { expect, test } from "@playwright/test";
import { login, PASSWORD, relaxCallingHours, shownContactId, sql, sqlAs, userId, waitContact } from "./helpers";

test.describe.configure({ mode: "serial" });
const CALLER = "caller08@example.test";

test.beforeAll(async () => {
  await relaxCallingHours();
  await sql(`update call_logs set status = 'canceled', ended_at = now() where ended_at is null and user_id = (select id from users where email = $1)`, [CALLER]);
  await sql(`delete from contact_locks where user_id = (select id from users where email = $1)`, [CALLER]);
  // 担当分が尽きていても試せるよう、許諾済・未割当の顧客を 10 件割り当てる
  await sql(`insert into assignments(contact_id, user_id, assigned_by)
    select c.id, u.id, u.id from contacts c, users u
    where u.email = $1 and c.callable and c.queue_state = 'new' and not exists(select 1 from assignments a where a.contact_id = c.id and a.released_at is null)
    limit 10`, [CALLER]);
});

test.describe("権限違反", () => {
  test("未ログインはログイン画面へ", async ({ page }) => {
    await page.goto("/contacts");
    await expect(page).toHaveURL(/\/login\?next=%2Fcontacts/);
  });
  test("ログイン失敗はメッセージを表示", async ({ page }) => {
    await page.goto("/login");
    await page.fill("#email", "caller01@example.test");
    await page.fill("#password", "wrong-password");
    await page.click("button[type=submit]");
    await expect(page.getByText("メールアドレスまたはパスワードが正しくありません")).toBeVisible();
  });
  test("架電担当は管理画面に入れない（URL 直打ちでも）", async ({ page }) => {
    await login(page, CALLER);
    for (const path of ["/admin/users", "/admin/consents", "/admin/audit-logs", "/call-lists/new"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/forbidden/);
    }
    // メニューにも出ない
    await page.goto("/dashboard");
    await expect(page.getByRole("link", { name: "ユーザー管理" })).toHaveCount(0);
  });
  test("経営陣は顧客の個人情報画面に入れない", async ({ page }) => {
    await login(page, "exec@example.test");
    await page.goto("/contacts");
    await expect(page).toHaveURL(/\/forbidden/);
    await page.goto("/call-center");
    await expect(page).toHaveURL(/\/forbidden/);
  });
  test("他人の担当顧客の詳細は見られない（404）", async ({ page }) => {
    const [other] = await sql<{ contact_id: string }>(
      `select a.contact_id from assignments a join users u on u.id = a.user_id where u.email = 'caller01@example.test' and a.released_at is null limit 1`);
    await login(page, CALLER);
    const [c] = await sql<{ full_name: string }>("select full_name from contacts where id = $1", [other.contact_id]);
    // ストリーミング描画のため HTTP ステータスは 200 のまま「見つかりません」を表示する（RLS で 0 件）
    await page.goto(`/contacts/${other.contact_id}`);
    await expect(page.getByText("ページが見つかりません")).toBeVisible();
    await expect(page.getByText(c.full_name)).toHaveCount(0);
  });
  test("利用停止したユーザーはログインできない", async ({ page }) => {
    await sql("update users set status = 'suspended' where email = 'caller07@example.test'");
    try {
      await page.goto("/login");
      await page.fill("#email", "caller07@example.test");
      await page.fill("#password", PASSWORD);
      await page.click("button[type=submit]");
      await expect(page.getByText(/利用停止中/)).toBeVisible();
    } finally {
      await sql("update users set status = 'active' where email = 'caller07@example.test'");
    }
  });
});

test.describe("同時操作・二重登録", () => {
  test("同じ顧客を 2 人が同時に開いても片方だけがロックを取れる", async () => {
    const [c] = await sql<{ id: string }>("select id from contacts where callable and not exists(select 1 from contact_locks l where l.contact_id = contacts.id) limit 1");
    const results = await Promise.all(["pm@example.test", "admin@example.test", "tl1@example.test"].map((e) =>
      sqlAs<{ r: { error?: string } }>(e, "select cc_open($1) r", [c.id]).then((x) => x[0].r).catch(() => ({ error: "forbidden" }))));
    expect(results.filter((r) => !r.error)).toHaveLength(1);
    expect(results.filter((r) => r.error === "locked_by_other").length).toBeGreaterThanOrEqual(1);
  });

  test("同じ冪等キーで 20 回同時に発信しても通話は 1 件", async () => {
    const [a] = await sql<{ contact_id: string }>(
      `select a.contact_id from assignments a join users u on u.id = a.user_id join contacts c on c.id = a.contact_id
       where u.email = $1 and a.released_at is null and c.callable limit 1`, [CALLER]);
    const key = crypto.randomUUID();
    const [{ t0 }] = await sql<{ t0: Date }>("select now() t0");
    const rs = await Promise.all(Array.from({ length: 20 }, () =>
      sqlAs<{ r: { callLogId?: string; error?: string } }>(CALLER, "select cc_start_call($1, $2) r", [a.contact_id, key]).then((x) => x[0].r).catch((e: Error) => ({ error: e.message }))));
    const ids = new Set(rs.map((r) => ("callLogId" in r ? r.callLogId : undefined)).filter(Boolean));
    expect(ids.size).toBe(1);
    const logs = await sql("select 1 from call_logs where contact_id = $1 and started_at >= $3 and user_id = $2", [a.contact_id, await userId(CALLER), t0]);
    expect(logs).toHaveLength(1);

    // 結果の二重送信（同じ冪等キー・別キー）でも 1 件
    const [log] = await sql<{ id: string }>("select id from call_logs where contact_id = $1 order by started_at desc limit 1", [a.contact_id]);
    await sqlAs(CALLER, "select cc_update_call($1, 'in_progress')", [log.id]);
    const saveKey = crypto.randomUUID();
    const saves = await Promise.all([saveKey, saveKey, crypto.randomUUID()].map((k) =>
      sqlAs<{ r: { error?: string } }>(CALLER, "select cc_save_result($1, $2, 'connected', $3) r", [a.contact_id, log.id, k]).then((x) => x[0].r).catch((e: Error) => ({ error: e.message }))));
    expect(saves.some((s) => !s.error)).toBe(true);
    const res = await sql("select 1 from call_results where call_log_id = $1", [log.id]);
    expect(res).toHaveLength(1);
  });
});

test.describe("架電センター", () => {
  test("1366×768 で主要操作がスクロールなしで収まる", async ({ page }) => {
    await login(page, CALLER, "/call-center");
    await waitContact(page);
    for (const id of ["dial-button", "save-next", "contact-name", "contact-phone"]) {
      const box = await page.getByTestId(id).boundingBox();
      expect(box, id).not.toBeNull();
      expect(box!.y + box!.height, id).toBeLessThanOrEqual(768);
    }
    const overflow = await page.evaluate(() => document.scrollingElement!.scrollHeight - window.innerHeight);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("発信直前に許諾が撤回されたら発信できない（サーバー側で再確認）", async ({ page }) => {
    await login(page, CALLER, "/call-center");
    await waitContact(page);
    const id = (await shownContactId(page))!;
    // 画面表示後に別経路で撤回
    await sql("insert into consents(contact_id, status, basis) values ($1, 'withdrawn', 'E2E：本人から撤回の連絡')", [id]);
    await page.getByTestId("dial-button").click();
    await expect(page.getByText("利用許諾が確認できていないため発信できません").first()).toBeVisible();
    await expect(page.getByTestId("hangup-button")).toHaveCount(0);
    expect(await sql("select 1 from call_logs where contact_id = $1 and started_at > now() - interval '1 minute' and status <> 'canceled'", [id])).toHaveLength(0);
  });

  test("通信断の間に保存した結果は一時保存され、復帰後に 1 件だけ送信される", async ({ page, context }) => {
    await context.addInitScript(() => localStorage.setItem("crm:mock-outcome", "answer"));
    await login(page, CALLER, "/call-center");
    await waitContact(page);
    const id = (await shownContactId(page))!;
    const count = async () => Number((await sql<{ n: string }>("select count(*) n from call_results where contact_id = $1", [id]))[0].n);
    const before = await count();
    await page.getByTestId("dial-button").click();
    await expect(page.getByTestId("call-status")).toContainText(/通話中/, { timeout: 20_000 });
    await page.locator('[data-result="connected"]').click();
    await page.fill("#memo", "E2E：オフライン中の保存");
    await context.setOffline(true);
    await page.getByTestId("save-next").click();
    await expect(page.getByText(/一時保存しました/)).toBeVisible();
    expect(await count()).toBe(before);
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect.poll(count, { timeout: 20_000 }).toBe(before + 1);
    await page.waitForTimeout(1500);
    expect(await count()).toBe(before + 1);
  });

  test("自動ログアウトを設定すると、一定時間操作がないとログアウト", async ({ page }) => {
    await sql(`update call_rules set value = '30' where key = 'auto_logout_minutes'`);
    try {
      await page.clock.install();
      await login(page, CALLER, "/dashboard");
      await page.clock.fastForward("31:00");
      await page.clock.runFor(60_000);
      await expect(page).toHaveURL(/\/login\?reason=timeout/, { timeout: 20_000 });
    } finally {
      await sql(`update call_rules set value = '0' where key = 'auto_logout_minutes'`);
    }
  });

  test("既定ではログインを保持し、/login を開いても入力なしで業務画面へ", async ({ page }) => {
    await page.clock.install();
    await login(page, CALLER, "/dashboard");
    await page.clock.fastForward("02:00:00");
    await page.clock.runFor(60_000);
    await expect(page).toHaveURL(/\/dashboard/);
    await page.goto("/login");
    await expect(page).toHaveURL(/\/dashboard/);
  });
});

test.describe("KPI", () => {
  test("実績のない期間は 0% ではなく「未計測」", async ({ page }) => {
    await login(page, "pm@example.test", "/dashboard?period=custom&from=2025-01-01&to=2025-01-07");
    await expect(page.getByTestId("kpi-call-appt-rate")).toContainText("未計測");
    await expect(page.getByTestId("kpi-connects")).toContainText("未計測");
  });
});
