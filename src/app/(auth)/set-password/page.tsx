import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createSupabaseServer } from "@/lib/supabase/server";
import { AuthShell } from "../auth-shell";
import { SetPasswordForm } from "./set-password-form";

export const metadata: Metadata = { title: "パスワードの設定" };

export default async function SetPasswordPage() {
  const supabase = await createSupabaseServer();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login?reason=link");
  return (
    <AuthShell title="パスワードの設定">
      <p className="mb-4 text-xs text-slate-600">{data.user.email} のログイン用パスワードを設定してください。</p>
      <SetPasswordForm />
    </AuthShell>
  );
}
