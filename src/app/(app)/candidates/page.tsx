import type { Metadata } from "next";
import { requireUser } from "@/server/auth/session";
import { ComingSoon } from "@/features/placeholder/coming-soon";

export const metadata: Metadata = { title: "求職者管理" };

export default async function Page() {
  await requireUser("talent.view");
  return <ComingSoon title="求職者管理" phase={3} items={["アポイントから求職者への登録", "職歴・希望条件・書類の管理", "担当アドバイザーの割り当て"]} />;
}
