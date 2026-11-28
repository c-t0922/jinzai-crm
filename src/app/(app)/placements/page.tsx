import type { Metadata } from "next";
import { requireUser } from "@/server/auth/session";
import { ComingSoon } from "@/features/placeholder/coming-soon";

export const metadata: Metadata = { title: "成約・売上管理" };

export default async function Page() {
  await requireUser("revenue.view");
  return <ComingSoon title="成約・売上管理" phase={3} items={["成約・入社・返金規定", "売上計上と KPI への反映"]} />;
}
