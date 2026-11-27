import type { Metadata } from "next";
import { requireUser } from "@/server/auth/session";
import { createSupabaseServer } from "@/lib/supabase/server";
import { PageBody, PageHeader } from "@/components/layout/page";
import { ScriptsAdmin } from "@/features/admin/scripts-admin";

export const metadata: Metadata = { title: "トークスクリプト管理" };

export default async function ScriptsPage() {
  await requireUser("admin.scripts");
  const supabase = await createSupabaseServer();
  const { data } = await supabase.from("scripts").select("id, title, body, version, active, updated_at").order("active", { ascending: false }).order("updated_at", { ascending: false });
  return (
    <>
      <PageHeader title="トークスクリプト管理" description="架電センターに表示するトークスクリプト。本文を変更すると版が上がり、変更履歴は操作ログに残ります。" />
      <PageBody><ScriptsAdmin scripts={data ?? []} /></PageBody>
    </>
  );
}
