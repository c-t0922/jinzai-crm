/**
 * 業務シナリオ S1〜S10（docs/12_test_plan.md・指示書21の完成基準）
 * 架電リスト作成 → 割当 → 架電 → 結果登録 → アポ → 引き継ぎ → KPI 反映 → 架電拒否の除外 まで一気通貫で確認する。
 */
import { expect, test } from "@playwright/test";
import { currentContactId, login, shownContactId, relaxCallingHours, sql, sqlAs, userId, waitContact } from "./helpers";

test.describe.configure({ mode: "serial" });

const CALLER = "caller09@example.test";
const CALLER2 = "caller10@example.test";
const listName = `E2E・許諾済・${Date.now()}`;
let listId = "";
let apptContactId = "";
let refusedContactId = "";

test.beforeAll(async () => {
  await relaxCallingHours();
  // 対象の架電担当の既存割当・ロックを外し、作成したリストの顧客だけが出るようにする
  await sql(`update assignments set released_at = now() where released_at is null and user_id in (select id from users where email = any($1))`, [[CALLER, CALLER2]]);
  await sql(`delete from contact_locks where user_id in (select id from users where email = any($1))`, [[CALLER, CALLER2]]);
  // 以前の実行で終了できなかった通話を片付ける
  await sql(`update call_logs set status = 'canceled', ended_at = now() where ended_at is null and user_id in (select id from users where email = any($1))`, [[CALLER, CALLER2]]);
});

test("S1 管理者が架電可能な顧客からリストを作成（架電禁止・許諾未確認は含まれない）", async ({ page }) => {
  await login(page, "pm@example.test", "/call-lists/new");
  // 都道府県＝東京都 で絞り込む
  await page.getByLabel("項目").first().selectOption("area_pref");
  await page.getByRole("button", { name: "東京都", exact: true }).first().click();
  await expect(page.getByTestId("preview-callable")).not.toHaveText("—", { timeout: 20_000 });
  await expect(page.getByText("除外：架電禁止")).toBeVisible();
  await expect(page.getByText("除外：利用許諾未確認・不許諾")).toBeVisible();
  await page.fill("#name", listName);
  await page.getByRole("button", { name: /件でリストを作成/ }).click();
  await page.waitForURL(/\/call-lists\/[0-9a-f-]{36}$/);
  listId = page.url().split("/").pop()!;

  const [bad] = await sql<{ n: number }>(
    `select count(*)::int n from call_list_members m join contacts c on c.id = m.contact_id
     where m.call_list_id = $1 and (c.consent_status <> 'granted' or c.is_suppressed or not c.callable)`, [listId]);
  expect(bad.n).toBe(0);
  const [all] = await sql<{ n: number }>("select count(*)::int n from call_list_members where call_list_id = $1", [listId]);
  expect(all.n).toBeGreaterThan(0);
});

test("S2 営業担当者へ均等割当（人数差 ±1 件以内）", async ({ page }) => {
  await login(page, "pm@example.test", `/call-lists/${listId}`);
  await page.getByRole("checkbox", { name: /中村 湊|加藤 悠真|小林 凛/ }).first().waitFor();
  for (const email of [CALLER, CALLER2]) {
    const [u] = await sql<{ name: string }>("select name from users where email = $1", [email]);
    await page.getByRole("checkbox", { name: u.name, exact: true }).check();
  }
  await page.fill("#max", "7");
  await page.getByRole("button", { name: /2 名に均等割当/ }).click();
  await expect(page.getByText(/件を 2 名に割り当てました/)).toBeVisible();
  const rows = await sql<{ n: number }>(
    `select count(*)::int n from assignments a join users u on u.id = a.user_id
     where a.call_list_id = $1 and a.released_at is null and u.email = any($2) group by u.id`, [listId, [CALLER, CALLER2]]);
  expect(rows).toHaveLength(2);
  expect(Math.abs(rows[0].n - rows[1].n)).toBeLessThanOrEqual(1);
});

test("S3〜S7 架電センター：表示→発信→アポ登録→次の顧客（自動発信しない）", async ({ page, context }) => {
  await context.addInitScript(() => localStorage.setItem("crm:mock-outcome", "answer"));
  await login(page, CALLER, "/call-center");

  // S3 優先順位どおりに表示・ロック取得
  await waitContact(page);
  await expect(page.getByTestId("demo-badge")).toBeVisible();
  apptContactId = (await shownContactId(page))!;
  expect(await currentContactId(CALLER)).toBe(apptContactId);
  expect(apptContactId).toBeTruthy();
  const [a] = await sql<{ call_list_id: string }>("select call_list_id from assignments where contact_id = $1 and released_at is null", [apptContactId]);
  expect(a.call_list_id).toBe(listId);

  // S4 発信（モック）：call_logs 作成・通話時間カウント
  const me = await userId(CALLER);
  const resultsBefore = (await sql("select 1 from call_results where contact_id = $1", [apptContactId])).length;
  await page.getByTestId("dial-button").click();
  await expect(page.getByTestId("hangup-button")).toBeVisible();
  await expect(page.getByTestId("call-timer")).not.toHaveText("0:00", { timeout: 10_000 });
  await expect.poll(async () => (await sql("select id from call_logs where contact_id = $1 and user_id = $2", [apptContactId, me])).length, { timeout: 10_000 }).toBe(1);

  // S5・S6 アポ獲得を登録（保存ボタン連打でも 1 件）
  await page.locator('[data-result="appointment"]').click();
  const d = new Date(Date.now() + 3 * 86400_000);
  const local = new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 10) + "T14:00";
  await page.fill("#appt-at", local);
  await page.locator("#appt-advisor").selectOption({ index: 1 });
  await page.fill("#h-job", "施工管理（E2E）");
  await page.fill("#memo", "E2E：平日夜なら面談可");
  const save = page.getByTestId("save-next");
  await save.click();
  await save.click({ force: true, timeout: 1000 }).catch(() => {});

  // S7 次の顧客が自動表示され、発信はしない
  await expect.poll(async () => shownContactId(page), { timeout: 20_000 }).not.toBe(apptContactId);
  await expect(page.getByTestId("dial-button")).toBeVisible();
  await expect(page.getByTestId("hangup-button")).toHaveCount(0);
  const nextId = await shownContactId(page);
  await page.waitForTimeout(1500);
  expect(await sql("select 1 from call_logs where contact_id = $1 and started_at > now() - interval '5 minutes'", [nextId])).toHaveLength(0);

  const results = await sql("select 1 from call_results where contact_id = $1", [apptContactId]);
  expect(results).toHaveLength(resultsBefore + 1);
  const appts = await sql<{ id: string; advisor_user_id: string }>("select id, advisor_user_id from appointments where contact_id = $1 and status = 'scheduled'", [apptContactId]);
  expect(appts).toHaveLength(1);
  const ho = await sql("select 1 from handoffs where appointment_id = $1", [appts[0].id]);
  expect(ho).toHaveLength(1);
  const tasks = await sql("select 1 from tasks where related_id = $1 and assignee_id = $2", [appts[0].id, appts[0].advisor_user_id]);
  expect(tasks.length).toBeGreaterThan(0);
});

test("S6 不在 → 指定日時で再架電キューに出る", async ({ page, context }) => {
  await context.addInitScript(() => localStorage.setItem("crm:mock-outcome", "no_answer"));
  await login(page, CALLER, "/call-center");
  await waitContact(page);
  const id = (await shownContactId(page))!;
  await page.getByTestId("dial-button").click();
  // モック端末が「応答なし」で終了 → 通話ログに no_answer が記録され、発信ボタンに戻る
  await expect.poll(async () => (await sql<{ status: string }>("select status from call_logs where contact_id = $1 order by started_at desc limit 1", [id]))[0]?.status, { timeout: 30_000 }).toBe("no_answer");
  await expect(page.getByTestId("dial-button")).toBeVisible();
  await page.locator('[data-result="no_answer"]').click();
  const at = new Date(Date.now() + 2 * 3600_000);
  const local = new Date(at.getTime() + 9 * 3600_000).toISOString().slice(0, 16);
  await page.fill("#next-call", local);
  await page.getByTestId("save-next").click();
  await expect.poll(async () => shownContactId(page), { timeout: 20_000 }).not.toBe(id);
  const [c] = await sql<{ queue_state: string; next_call_at: Date }>("select queue_state, next_call_at from contacts where id = $1", [id]);
  expect(c.queue_state).toBe("recall");
  expect(Math.abs(c.next_call_at.getTime() - new Date(`${local}:00+09:00`).getTime())).toBeLessThan(60_000);
  // 再架電タブに表示される
  const q = await sqlAs<{ cc_queue: { items: { id: string }[] } }>(CALLER, "select cc_queue('recall', 100)");
  expect(JSON.stringify(q[0].cc_queue)).toContain(id);
});

test("S8 ダッシュボードに実績が即時反映（定義どおりの率）", async ({ page }) => {
  await login(page, "pm@example.test", "/dashboard?period=today");
  const [k] = await sqlAs<{ k: { current: { calls: number; appointments: number; connects: number } } }>("pm@example.test", "select kpi_dashboard('{}'::jsonb) k");
  expect(k.k.current.calls).toBeGreaterThanOrEqual(2);
  await expect(page.getByTestId("kpi-calls")).toContainText(k.k.current.calls.toLocaleString("ja-JP"));
  await expect(page.getByTestId("kpi-appointments")).toContainText(k.k.current.appointments.toLocaleString("ja-JP"));
  const rate = k.k.current.calls ? ((k.k.current.connects / k.k.current.calls) * 100).toFixed(1) : null;
  if (rate) await expect(page.getByTestId("kpi-connects")).toContainText(`${rate}%`);

  // 本人のダッシュボードは自分の範囲のみ
  const [own] = await sqlAs<{ k: { scope: string } }>(CALLER, "select kpi_dashboard('{}'::jsonb) k");
  expect(own.k.scope).toBe("user");
});

test("S9 面談担当者へ引き継ぎ（ヒアリング内容と通知）", async ({ page }) => {
  const [a] = await sql<{ id: string; email: string }>(
    "select a.id, u.email from appointments a join users u on u.id = a.advisor_user_id where a.contact_id = $1", [apptContactId]);
  await login(page, a.email, `/appointments/${a.id}`);
  const ho = page.getByTestId("handoff");
  await expect(ho).toContainText("施工管理（E2E）");
  await expect(ho).toContainText("平日夜なら面談可");
  const n = await sql("select 1 from notifications n join users u on u.id = n.user_id where u.email = $1 and n.link like $2", [a.email, `%${a.id}%`]);
  expect(n.length).toBeGreaterThan(0);
  await page.getByRole("button", { name: "引き継ぎ内容を確認した" }).click();
  await expect.poll(async () => (await sql<{ acknowledged_at: Date | null }>("select acknowledged_at from handoffs where appointment_id = $1", [a.id]))[0].acknowledged_at).not.toBeNull();
});

test("S10 架電拒否した顧客は同じ番号の別レコードも含めて再度対象にならない", async ({ page }) => {
  page.on("dialog", (d) => d.accept());
  await login(page, CALLER, "/call-center");
  await waitContact(page);
  refusedContactId = (await shownContactId(page))!;
  const [ph] = await sql<{ phone_e164: string }>("select phone_e164 from contact_phones where contact_id = $1 limit 1", [refusedContactId]);
  // 同じ電話番号を持つ別レコード（重複・架空データ）を用意。自動統合はせず、架電禁止は番号単位で伝播する
  const [twin] = await sql<{ id: string }>(
    `insert into contacts(last_name, first_name, consent_status, primary_source, area_pref) values ('重複', 'テスト', 'granted', 'lp', '東京都') returning id`);
  await sql("insert into contact_phones(contact_id, phone_e164, is_primary) values ($1, $2, true)", [twin.id, ph.phone_e164]);
  expect((await sql<{ callable: boolean }>("select callable from contacts where id = $1", [twin.id]))[0].callable).toBe(true);

  await page.locator('[data-result="refused"]').click();
  await page.getByTestId("save-next").click();
  await expect.poll(async () => shownContactId(page), { timeout: 20_000 }).not.toBe(refusedContactId);

  for (const id of [refusedContactId, twin.id]) {
    const [c] = await sql<{ callable: boolean; is_suppressed: boolean }>("select callable, is_suppressed from contacts where id = $1", [id]);
    expect(c).toEqual({ callable: false, is_suppressed: true });
  }
  // リスト抽出・キュー・発信 API のすべてで除外
  const q = await sqlAs<{ q: unknown }>(CALLER, "select cc_queue('today', 200) q");
  expect(JSON.stringify(q)).not.toContain(refusedContactId);
  const [dial] = await sqlAs<{ r: { error?: string; reason?: string } }>("pm@example.test", "select cc_start_call($1, $2) r", [twin.id, crypto.randomUUID()]);
  expect(dial.r).toEqual({ error: "NOT_CALLABLE", reason: "suppressed" });
  expect(await sql("select 1 from call_logs where contact_id = $1", [twin.id])).toHaveLength(0);

  // 画面からも発信できない
  await page.goto(`/call-center?contact=${twin.id}`);
  await expect(page.getByText(/架電禁止|発信できません|対応中です|開けません/).first()).toBeVisible();
});
