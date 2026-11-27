"use server";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { z } from "zod";
import { createSupabaseServer } from "@/lib/supabase/server";

export type SignInState = { error?: string; email?: string };

const schema = z.object({ email: z.email(), password: z.string().min(1), next: z.string().optional() });

export async function signIn(_prev: SignInState, form: FormData): Promise<SignInState> {
  const parsed = schema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "メールアドレスとパスワードを入力してください", email: String(form.get("email") ?? "") };
  const supabase = await createSupabaseServer();
  const { error } = await supabase.auth.signInWithPassword({ email: parsed.data.email, password: parsed.data.password });
  if (error) return { error: "メールアドレスまたはパスワードが正しくありません", email: parsed.data.email };
  const h = await headers();
  await supabase.rpc("record_login", { p_event: "login", p_ip: h.get("x-forwarded-for"), p_ua: h.get("user-agent") });
  const next = parsed.data.next && parsed.data.next.startsWith("/") && !parsed.data.next.startsWith("//") ? parsed.data.next : "/dashboard";
  redirect(next);
}

export async function signOut(reason?: string) {
  const supabase = await createSupabaseServer();
  await supabase.rpc("record_login", { p_event: reason === "timeout" ? "timeout" : "logout" });
  await supabase.auth.signOut();
  redirect(reason === "timeout" ? "/login?reason=timeout" : "/login");
}
