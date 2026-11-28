"use client";
import { useEffect, useState } from "react";
import { createSupabaseBrowser } from "@/lib/supabase/client";

/**
 * 招待・パスワード設定リンクの戻り先。Supabase がトークンを URL の # 以降に付けて戻すため、
 * ブラウザで受け取ってセッションにし、パスワード設定画面へ進む。
 */
export default function AuthCallbackPage() {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const query = new URLSearchParams(window.location.search);
    const code = query.get("code");
    if (code) {
      window.location.replace(`/auth/confirm?code=${encodeURIComponent(code)}`);
      return;
    }
    const access_token = hash.get("access_token");
    const refresh_token = hash.get("refresh_token");
    if (!access_token || !refresh_token) {
      window.location.replace("/login?reason=link");
      return;
    }
    createSupabaseBrowser().auth.setSession({ access_token, refresh_token }).then(({ error }) => {
      if (error) setFailed(true);
      else window.location.replace("/set-password");
    });
  }, []);
  return (
    <main className="flex min-h-dvh items-center justify-center bg-surface px-4 text-sm text-slate-600">
      {failed ? <a href="/login?reason=link" className="text-accent-blue underline">リンクが無効です。ログイン画面へ</a> : "確認しています…"}
    </main>
  );
}
