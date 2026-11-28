import { Construction } from "lucide-react";
import { PageBody, PageHeader } from "@/components/layout/page";

/** Phase 2 以降の画面。メニュー構成を先に固めるための仮ページ */
export function ComingSoon({ title, phase, items }: { title: string; phase: number; items: string[] }) {
  return (
    <>
      <PageHeader title={title} description={`Phase ${phase} で実装予定です`} />
      <PageBody>
        <div className="rounded-lg border border-dashed border-border bg-white p-8 text-center">
          <Construction className="mx-auto size-8 text-slate-400" aria-hidden />
          <p className="mt-3 font-medium">この画面は準備中です</p>
          <ul className="mx-auto mt-3 max-w-md space-y-1 text-left text-sm text-slate-600">
            {items.map((i) => <li key={i}>・{i}</li>)}
          </ul>
          <p className="mt-4 text-xs text-slate-500">詳細は docs/09_task_list.md を参照してください。</p>
        </div>
      </PageBody>
    </>
  );
}
