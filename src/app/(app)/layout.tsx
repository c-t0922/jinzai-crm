import { Sidebar } from "@/components/layout/sidebar";
import { IdleLogout, UserMenu } from "@/components/layout/user-menu";
import { requireUser } from "@/server/auth/session";
import { createSupabaseServer } from "@/lib/supabase/server";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createSupabaseServer();
  // ユーザー情報と設定を並行で取得（DB との往復を 1 回分減らす）
  const [me, { data: rule }] = await Promise.all([
    requireUser(),
    supabase.from("call_rules").select("value").eq("key", "auto_logout_minutes").maybeSingle(),
  ]);
  const idle = Number(rule?.value ?? 0);
  return (
    <div className="flex h-dvh overflow-hidden">
      <Sidebar roles={me.roles} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-white pl-12 pr-3 md:pl-4">
          <div id="page-header-slot" className="min-w-0 flex-1" />
          {process.env.NODE_ENV !== "production" ? (
            <span className="mr-3 hidden rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 lg:inline">
              開発環境・架空データ
            </span>
          ) : null}
          <UserMenu name={me.name} roles={me.roles} unread={me.unreadNotifications} />
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
      </div>
      <IdleLogout minutes={idle} />
    </div>
  );
}
