import type { Metadata } from "next";
import { requireUser } from "@/server/auth/session";
import { ComingSoon } from "@/features/placeholder/coming-soon";

export const metadata: Metadata = { title: "CTI連携" };

export default async function Page() {
  await requireUser("admin.integrations");
  return <ComingSoon title="CTI連携" phase={2} items={["Twilio 等の CTI 接続設定（現在はモック）", "録音は告知・同意の運用確定後に有効化"]} />;
}
