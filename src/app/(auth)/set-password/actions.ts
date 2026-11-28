"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseServer } from "@/lib/supabase/server";

export type SetPasswordState = { error?: string };

const schema = z
  .object({ password: z.string().min(10).max(72), confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ["confirm"] });

export async function setPassword(_prev: SetPasswordState, form: FormData): Promise<SetPasswordState> {
  const parsed = schema.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    const confirmIssue = parsed.error.issues.some((i) => i.path[0] === "confirm");
    return { error: confirmIssue ? "確認用のパスワードが一致しません" : "パスワードは10文字以上で入力してください" };
  }
  const supabase = await createSupabaseServer();
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return { error: "リンクの有効期限が切れています。管理者に再招待を依頼してください" };
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    return { error: error.message.includes("same") ? "以前と異なるパスワードを設定してください" : "パスワードを設定できませんでした（推測されやすいパスワードは使えません）" };
  }
  const { data: me } = await supabase.rpc("me");
  if (!me) {
    await supabase.auth.signOut();
    redirect("/login?reason=unregistered");
  }
  redirect("/dashboard");
}
