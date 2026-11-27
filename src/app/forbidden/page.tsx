import Link from "next/link";
import { ShieldAlert } from "lucide-react";

export default function Forbidden() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 px-4 text-center">
      <ShieldAlert className="size-10 text-slate-300" aria-hidden />
      <h1 className="text-lg font-semibold">この画面を表示する権限がありません</h1>
      <p className="text-sm text-slate-500">必要な場合はシステム管理者にお問い合わせください。</p>
      <Link href="/dashboard" className="text-sm text-accent-blue hover:underline">ダッシュボードへ戻る</Link>
    </main>
  );
}
