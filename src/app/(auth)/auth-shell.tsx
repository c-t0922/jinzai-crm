/** ログイン系画面の共通枠 */
export function AuthShell({ title, children, footer }: { title: string; children: React.ReactNode; footer?: React.ReactNode }) {
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
          <h1 className="mb-4 text-lg font-semibold">{title}</h1>
          {children}
        </div>
        {footer}
      </div>
    </main>
  );
}
