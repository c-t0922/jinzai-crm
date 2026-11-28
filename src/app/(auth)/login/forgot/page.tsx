import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "../../auth-shell";
import { ForgotForm } from "./forgot-form";

export const metadata: Metadata = { title: "パスワードの再設定" };

export default function ForgotPage() {
  return (
    <AuthShell title="パスワードの再設定" footer={<p className="mt-4 text-center text-xs"><Link href="/login" className="text-accent-blue hover:underline">ログイン画面へ戻る</Link></p>}>
      <ForgotForm />
    </AuthShell>
  );
}
