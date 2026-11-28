"use client";
import { useEffect } from "react";

/**
 * Supabase の標準メール（招待・再設定）は Site URL にトークンを # 付きで戻す。
 * ログイン画面に転送されてきた場合は /auth/callback で受け取り直す。
 */
export function HashForward() {
  useEffect(() => {
    const h = window.location.hash;
    if (h.includes("access_token=") || h.includes("error_description=")) window.location.replace(`/auth/callback${h}`);
  }, []);
  return null;
}
