import type { Metadata } from "next";
import { requireUser } from "@/server/auth/session";
import { ComingSoon } from "@/features/placeholder/coming-soon";

export const metadata: Metadata = { title: "kintone連携" };

export default async function Page() {
  await requireUser("admin.integrations");
  return <ComingSoon title="kintone連携" phase={2} items={["kintone からの読み取り専用同期（更新・削除はしない）", "項目マッピング（住宅ローン・資産情報はマッピング不可）", "同期エラーの確認と再実行"]} />;
}
