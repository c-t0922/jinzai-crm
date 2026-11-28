/** 招待メールのリンク → パスワード設定 → ログイン（架空ユーザー） */
import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { sql } from "./helpers";

const admin = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

test("招待されたユーザーはリンクからパスワードを設定してログインできる", async ({ page }) => {
  const email = `invite-${Date.now()}@example.test`;
  const { data, error } = await admin().auth.admin.generateLink({ type: "invite", email });
  expect(error).toBeNull();
  await sql(`insert into users(auth_user_id, name, email) values ($1, '招待 テスト', $2)`, [data.user!.id, email]);
  await sql(`insert into user_roles(user_id, role) select id, 'caller' from users where email = $1`, [email]);

  await page.goto(`/auth/confirm?token_hash=${data.properties!.hashed_token}&type=invite`);
  await expect(page).toHaveURL(/\/set-password/);
  await page.fill("#password", "Kakuu-Test-2026");
  await page.fill("#confirm", "Kakuu-Test-2027");
  await page.click("button[type=submit]");
  await expect(page.getByText("確認用のパスワードが一致しません")).toBeVisible();
  await page.fill("#password", "Kakuu-Test-2026");
  await page.fill("#confirm", "Kakuu-Test-2026");
  await page.click("button[type=submit]");
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
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
