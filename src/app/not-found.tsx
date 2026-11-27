import Link from "next/link";

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center bg-slate-50 p-6">
      <div className="text-center">
        <p className="text-sm text-slate-500">404</p>
        <h1 className="mt-1 text-lg font-semibold">ページが見つかりません</h1>
        <p className="mt-1 text-sm text-slate-500">削除されたか、閲覧権限のないデータの可能性があります。</p>
        <Link href="/dashboard" className="mt-4 inline-block text-sm text-accent-blue hover:underline">ダッシュボードへ戻る</Link>
      </div>
    </main>
  );
}
