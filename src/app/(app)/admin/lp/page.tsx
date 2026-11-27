import type { Metadata } from "next";
import { requireUser } from "@/server/auth/session";
import { ComingSoon } from "@/features/placeholder/coming-soon";

export const metadata: Metadata = { title: "LP連携" };

export default async function Page() {
  await requireUser("admin.integrations");
  return <ComingSoon title="LP連携" phase={4} items={["人材LPからの反響の自動取り込み（Webhook・冪等）"]} />;
}
