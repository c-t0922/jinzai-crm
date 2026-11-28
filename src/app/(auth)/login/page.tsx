import type { Metadata } from "next";
import Link from "next/link";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "ログイン" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; reason?: string }> }) {
  const sp = await searchParams;
  return (
    <main className="flex min-h-dvh items-center justify-center bg-surface px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2">
          <div className="grid size-8 place-items-center rounded-md bg-primary text-sm font-bold text-white">人</div>
          <div>
            <p className="text-base font-semibold leading-tight">人材CRM</p>
            <p className="text-xs text-slate-500">IEGAO 人材事業</p>
          </div>
        </div>
        <div className="rounded-lg border border-border bg-white p-6">
          <h1 className="mb-4 text-lg font-semibold">ログイン</h1>
          {sp.reason === "timeout" ? (
            <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">一定時間操作がなかったため、自動でログアウトしました。</p>
          ) : null}
          {sp.reason === "link" ? (
            <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">リンクが無効か、有効期限が切れています。管理者に再招待を依頼するか、パスワードの再設定を行ってください。</p>
          ) : null}
          {sp.reason === "unregistered" ? (
            <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">このアカウントは CRM に登録されていません。管理者にお問い合わせください。</p>
          ) : null}
          <LoginForm next={sp.next} />
          <p className="mt-3 text-right text-xs"><Link href="/login/forgot" className="text-accent-blue hover:underline">パスワードを忘れた方</Link></p>
        </div>
        {process.env.NODE_ENV !== "production" ? <p className="mt-4 text-center text-xs text-slate-400">開発環境：架空データのみを表示しています</p> : null}
      </div>
    </main>
  );
}
