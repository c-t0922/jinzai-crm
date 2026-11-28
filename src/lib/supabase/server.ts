import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

/** ユーザーのセッション（JWT）で DB にアクセスするクライアント。RLS が必ず適用される。 */
export async function createSupabaseServer() {
  const cookieStore = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server Component からの呼び出しでは set できない（proxy 側で更新される）
        }
      },
    },
  });
}
