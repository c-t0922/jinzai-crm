import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createSupabaseServer } from "@/lib/supabase/server";
import { MfaForm } from "./mfa-form";

export const metadata: Metadata = { title: "多要素認証" };

export default async function MfaPage() {
  const supabase = await createSupabaseServer();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) redirect("/login");
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const verified = factors?.totp?.find((f) => f.status === "verified");
  return (
    <main className="flex min-h-dvh items-center justify-center bg-surface px-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-white p-6">
        <h1 className="text-lg font-semibold">多要素認証</h1>
        <p className="mb-4 mt-1 text-xs text-slate-500">
          管理者・PM のアカウントは、認証アプリ（Google Authenticator など）による確認が必須です。
        </p>
        <MfaForm mode={verified ? "verify" : "enroll"} factorId={verified?.id} />
      </div>
    </main>
  );
}
