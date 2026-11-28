/** 招待メールのリンク → パスワード設定 → ログイン（架空ユーザー） */
import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { login, sql } from "./helpers";

const admin = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

test("管理者が発行した招待リンクから本人がパスワードを設定してログインできる", async ({ page, browser }) => {
  test.setTimeout(90_000);
  const email = `invite-${Date.now()}@example.test`;
  await login(page, "admin@example.test", "/admin/users");
  await page.getByRole("button", { name: /招待/ }).first().click();
  await page.fill("#n-name", "招待 テスト");
  await page.fill("#n-email", email);
  await page.getByRole("button", { name: "招待リンクを発行する" }).click();
  const link = await page.getByTestId("issued-link").inputValue();
  expect(link).toContain("/auth/v1/verify");

  // 本人のブラウザ（別セッション）でリンクを開く
  const ctx = await browser.newContext();
  const p2 = await ctx.newPage();
  await p2.goto(link);
  await expect(p2).toHaveURL(/\/set-password/, { timeout: 20_000 });
  await p2.fill("#password", "Kakuu-Test-2026");
  await p2.fill("#confirm", "Kakuu-Test-2027");
  await p2.click("button[type=submit]");
  await expect(p2.getByText("確認用のパスワードが一致しません")).toBeVisible();
  await p2.fill("#password", "Kakuu-Test-2026");
  await p2.fill("#confirm", "Kakuu-Test-2026");
  await p2.click("button[type=submit]");
  await expect(p2).toHaveURL(/\/dashboard/, { timeout: 20_000 });
  await ctx.close();

  // 再発行リンク（パスワードを忘れた場合）
  const [u] = await sql<{ id: string }>("select id from users where email = $1", [email]);
  expect(u).toBeTruthy();
});

test("token_hash 形式のリンクにも対応", async ({ page }) => {
  const email = `invite2-${Date.now()}@example.test`;
  const { data } = await admin().auth.admin.generateLink({ type: "invite", email });
  await sql(`insert into users(auth_user_id, name, email) values ($1, '招待 テスト2', $2)`, [data.user!.id, email]);
  await page.goto(`/auth/confirm?token_hash=${data.properties!.hashed_token}&type=invite`);
  await expect(page).toHaveURL(/\/set-password/);
});

test("無効なリンクはログイン画面に案内する", async ({ page }) => {
  await page.goto(`/auth/confirm?token_hash=invalid&type=invite`);
  await expect(page).toHaveURL(/\/login\?reason=link/);
  await expect(page.getByText("リンクが無効か")).toBeVisible();
});

test("パスワード再設定は登録の有無に関係なく同じ表示", async ({ page }) => {
  await page.goto("/login/forgot");
  await page.fill("#email", "nobody@example.test");
  await page.click("button[type=submit]");
  await expect(page.getByText("登録されているメールアドレスであれば")).toBeVisible();
});
