import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createSupabaseServer } from "@/lib/supabase/server";

/**
 * 招待・パスワード再設定メールのリンク先。
 * メールテンプレートは `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite`（再設定は type=recovery）。
 * 確認できたらパスワード設定画面へ進む。
 */
const TYPES: EmailOtpType[] = ["invite", "recovery", "email", "signup", "magiclink"];

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const tokenHash = sp.get("token_hash");
  const type = sp.get("type") as EmailOtpType | null;
  if (tokenHash && type && TYPES.includes(type)) {
    const supabase = await createSupabaseServer();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return go("/set-password");
  }
  return go("/login?reason=link");
}

/** 相対パスでリダイレクト（プロキシ経由でもホスト名が変わらないように） */
function go(path: string) {
  return new NextResponse(null, { status: 303, headers: { Location: path } });
}
