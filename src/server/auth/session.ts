import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createSupabaseServer } from "@/lib/supabase/server";
import { can, requiresMfa, type Permission, type Role } from "@/lib/permissions";

export type Me = {
  id: string;
  name: string;
  email: string;
  roles: Role[];
  teams: { id: string; name: string; isLeader: boolean }[];
  unreadNotifications: number;
};

export const getMe = cache(async (): Promise<Me | null> => {
  const supabase = await createSupabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const { data, error } = await supabase.rpc("me");
  if (error || !data) return null;
  return data as Me;
});

/** ページ・Server Action の先頭で呼ぶ。未ログイン→/login、MFA 未完了→/mfa、権限なし→/forbidden */
export async function requireUser(perm?: Permission): Promise<Me> {
  const me = await getMe();
  if (!me) redirect("/login");
  if (mfaEnforced() && requiresMfa(me.roles)) {
    const supabase = await createSupabaseServer();
    const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (data?.currentLevel !== "aal2") redirect("/mfa");
  }
  if (perm && !can(me.roles, perm)) redirect("/forbidden");
  return me;
}

/** Server Action 用：リダイレクトせず例外を投げる */
export async function authorize(perm: Permission): Promise<Me> {
  const me = await getMe();
  if (!me) throw new AppError("UNAUTHENTICATED", "ログインが必要です");
  if (mfaEnforced() && requiresMfa(me.roles)) {
    const supabase = await createSupabaseServer();
    const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (data?.currentLevel !== "aal2") throw new AppError("MFA_REQUIRED", "多要素認証が必要です");
  }
  if (!can(me.roles, perm)) throw new AppError("FORBIDDEN", "この操作を行う権限がありません");
  return me;
}

export function mfaEnforced() {
  return process.env.MFA_ENFORCE !== "false";
}

export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
