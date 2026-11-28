import type { Metadata } from "next";
import { requireUser } from "@/server/auth/session";
import { ComingSoon } from "@/features/placeholder/coming-soon";

export const metadata: Metadata = { title: "求人管理" };

export default async function Page() {
  await requireUser("talent.view");
  return <ComingSoon title="求人管理" phase={3} items={["求人票の登録・公開状態", "求職者とのマッチング"]} />;
}
