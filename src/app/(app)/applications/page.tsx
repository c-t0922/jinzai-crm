import type { Metadata } from "next";
import { requireUser } from "@/server/auth/session";
import { ComingSoon } from "@/features/placeholder/coming-soon";

export const metadata: Metadata = { title: "選考進捗管理" };

export default async function Page() {
  await requireUser("talent.view");
  return <ComingSoon title="選考進捗管理" phase={3} items={["応募〜内定〜入社までのカンバン", "選考ステータスの履歴（マスタ化済み）"]} />;
}
