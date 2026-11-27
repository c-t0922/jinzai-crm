import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * service_role クライアント。用途は「管理者によるユーザー招待（Auth Admin API）」と seed・同期ジョブに限定する。
 * 業務データの読み書きには使わない（RLS を迂回するため）。
 */
export function createSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_SERVICE_ROLE_KEY が未設定です");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
