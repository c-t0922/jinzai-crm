import type { Metadata } from "next";
import { requireUser } from "@/server/auth/session";
import { createSupabaseServer } from "@/lib/supabase/server";
import { PageBody, PageHeader } from "@/components/layout/page";
import { ListBuilder } from "@/features/call-lists/list-builder";

export const metadata: Metadata = { title: "架電リスト作成" };

export default async function NewListPage() {
  await requireUser("calllists.manage");
  const supabase = await createSupabaseServer();
  const { data: teams } = await supabase.from("teams").select("id,name").order("name");
  return (
    <>
      <PageHeader title="架電リストを作成" description="架電禁止・利用許諾未確認・他の担当者が対応中の顧客は自動で除外されます" />
      <PageBody><ListBuilder teams={teams ?? []} /></PageBody>
    </>
  );
}
