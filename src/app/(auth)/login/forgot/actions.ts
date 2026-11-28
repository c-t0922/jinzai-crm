"use server";
import { headers } from "next/headers";
import { z } from "zod";
import { createSupabaseServer } from "@/lib/supabase/server";

export type ForgotState = { sent?: boolean; error?: string };

/** 再設定メールを送る。登録の有無が分からないよう、結果は常に同じ表示にする */
export async function requestReset(_prev: ForgotState, form: FormData): Promise<ForgotState> {
  const email = z.email().safeParse(String(form.get("email") ?? "").trim());
  if (!email.success) return { error: "メールアドレスを入力してください" };
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;
  const supabase = await createSupabaseServer();
  await supabase.auth.resetPasswordForEmail(email.data, { redirectTo: `${origin}/auth/callback` });
  return { sent: true };
}
