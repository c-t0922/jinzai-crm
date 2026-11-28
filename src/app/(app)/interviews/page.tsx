import type { Metadata } from "next";
import { requireUser } from "@/server/auth/session";
import { ComingSoon } from "@/features/placeholder/coming-soon";

export const metadata: Metadata = { title: "キャリア面談管理" };

export default async function Page() {
  await requireUser("talent.view");
  return <ComingSoon title="キャリア面談管理" phase={3} items={["面談記録（ヒアリングシート）", "面談結果から求人提案へ"]} />;
}
