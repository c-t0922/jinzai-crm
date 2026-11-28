"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/** 集計の共有用テキスト（人数のみ・5人未満は伏せ字）。分析の依頼に貼り付けて使う */
export function ShareBox({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => setOpen((v) => !v)} aria-expanded={open} data-testid="share-toggle">
          {open ? "共有用テキストを閉じる" : "共有用テキストを表示"}
        </Button>
        <Button size="sm" onClick={() => navigator.clipboard?.writeText(text).then(() => toast.success("コピーしました"), () => toast.error("コピーできませんでした。表示して選択・コピーしてください"))}>
          集計をコピー
        </Button>
      </div>
      {open ? (
        <textarea readOnly value={text} data-testid="share-text" aria-label="共有用テキスト"
          className="h-64 w-full rounded-md border border-border bg-slate-50 p-2 font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
      ) : null}
    </div>
  );
}
