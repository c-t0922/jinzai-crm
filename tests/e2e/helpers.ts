import { expect, type Page } from "@playwright/test";
import { Client } from "pg";

try {
  process.loadEnvFile(".env.local");
} catch {
  /* CI では環境変数で渡す */
}

export const PASSWORD = process.env.SEED_USER_PASSWORD ?? "LocalDev#2026";

const url = process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(url)) throw new Error("E2E はローカル DB に対してのみ実行できます");

/** 検証用にローカル DB を直接参照する（架空データのみ） */
export async function sql<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    return (await c.query(text, params)).rows as T[];
  } finally {
    await c.end();
  }
}

/** ログインユーザーとして SQL を実行（RLS・RPC の権限チェックを通す） */
export async function sqlAs<T = Record<string, unknown>>(email: string, text: string, params: unknown[] = []): Promise<T[]> {
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    const [{ id }] = (await c.query("select id from auth.users where email = $1", [email])).rows;
    await c.query("begin");
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: id, role: "authenticated", aal: "aal2" })]);
    await c.query("set local role authenticated");
    const r = (await c.query(text, params)).rows as T[];
    await c.query("commit");
    return r;
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    await c.end();
  }
}

export async function login(page: Page, email: string, next = "/dashboard") {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 });
}

export async function userId(email: string) {
  const [r] = await sql<{ id: string }>("select id from users where email = $1", [email]);
  return r.id;
}

/** ローカル開発では架電時間帯の制限を外す（JST 夜間でもテストできるように） */
export async function relaxCallingHours() {
  await sql(`update call_rules set value = jsonb_set(value, '{enforce}', 'false') where key = 'calling_hours'`);
}

export async function waitContact(page: Page) {
  await expect(page.getByTestId("contact-name")).toBeVisible({ timeout: 30_000 });
  return (await page.getByTestId("contact-name").innerText()).trim();
}

export async function currentContactId(email: string) {
  const [r] = await sql<{ contact_id: string }>(
    "select l.contact_id from contact_locks l join users u on u.id = l.user_id where u.email = $1 and l.expires_at > now() order by l.acquired_at desc limit 1",
    [email],
  );
  return r?.contact_id ?? null;
}

/** 架電センターで表示中の顧客 ID（顧客詳細リンクから取得） */
export async function shownContactId(page: Page) {
  const href = await page.getByLabel("顧客詳細を別タブで開く").getAttribute("href");
  return href?.split("/").pop() ?? null;
}
