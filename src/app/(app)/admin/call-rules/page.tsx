import type { Metadata } from "next";
import { requireUser } from "@/server/auth/session";
import { createSupabaseServer } from "@/lib/supabase/server";
import { PageBody, PageHeader } from "@/components/layout/page";
import { MastersTable, RulesForm } from "@/features/admin/rules-admin";

export const metadata: Metadata = { title: "架電ルール設定" };

export default async function CallRulesPage() {
  const me = await requireUser("admin.rules");
  const editable = me.roles.includes("admin");
  const supabase = await createSupabaseServer();
  const [rules, masters] = await Promise.all([
    supabase.from("call_rules").select("key, value"),
    supabase.from("call_result_masters").select("*").neq("code", "not_called").order("sort_order"),
  ]);
  const map = Object.fromEntries((rules.data ?? []).map((r) => [r.key, r.value]));
  return (
    <>
      <PageHeader title="架電ルール設定" description={editable ? "変更はすぐに架電センターへ反映され、操作ログに記録されます。" : "閲覧のみ（変更はシステム管理者が行います）"} />
      <PageBody className="space-y-6">
        <RulesForm rules={map} editable={editable} />
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">架電結果マスタ</h2>
          <p className="text-xs text-slate-500">結果の追加・自動処理の変更は業務フローに影響するため、Phase 1 では表示名・ショートカット・並び順・使用有無のみ変更できます。</p>
          <MastersTable masters={masters.data ?? []} editable={editable} />
        </section>
      </PageBody>
    </>
  );
}
