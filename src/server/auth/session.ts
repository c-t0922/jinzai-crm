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

/**
 * ログイン中の JWT を検証して claims を返す（リクエスト内で 1 回だけ）。
 * 非対称鍵（ES256）の本番では公開鍵でローカル検証するため、Auth サーバーへの往復が発生しない。
 * （サーバー関数は米国、DB は東京にあり、往復 1 回あたり約 0.15 秒かかるため）
 */
export const getAuthClaims = cache(async () => {
  const supabase = await createSupabaseServer();
  const { data } = await supabase.auth.getClaims();
  return data?.claims ?? null;
});

export const getMe = cache(async (): Promise<Me | null> => {
  const claims = await getAuthClaims();
  if (!claims) return null;
  const supabase = await createSupabaseServer();
  const { data, error } = await supabase.rpc("me");
  if (error || !data) return null;
  return data as Me;
});

/** ページ・Server Action の先頭で呼ぶ。未ログイン→/login、MFA 未完了→/mfa、権限なし→/forbidden */
export async function requireUser(perm?: Permission): Promise<Me> {
  const me = await getMe();
  if (!me) redirect("/login");
  if (mfaEnforced() && requiresMfa(me.roles)) {
    if ((await getAuthClaims())?.aal !== "aal2") redirect("/mfa");
  }
  if (perm && !can(me.roles, perm)) redirect("/forbidden");
  return me;
}

/** Server Action 用：リダイレクトせず例外を投げる */
export async function authorize(perm: Permission): Promise<Me> {
  const me = await getMe();
  if (!me) throw new AppError("UNAUTHENTICATED", "ログインが必要です");
  if (mfaEnforced() && requiresMfa(me.roles)) {
    if ((await getAuthClaims())?.aal !== "aal2") throw new AppError("MFA_REQUIRED", "多要素認証が必要です");
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
