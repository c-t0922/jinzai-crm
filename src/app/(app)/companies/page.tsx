import type { Metadata } from "next";
import { requireUser } from "@/server/auth/session";
import { ComingSoon } from "@/features/placeholder/coming-soon";

export const metadata: Metadata = { title: "企業管理" };

export default async function Page() {
  await requireUser("talent.view");
  return <ComingSoon title="企業管理" phase={3} items={["取引企業・担当者・契約条件"]} />;
}
