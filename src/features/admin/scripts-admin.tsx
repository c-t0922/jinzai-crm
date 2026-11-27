"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { saveScript } from "@/server/domain/admin/actions";
import { fmtDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

type Script = { id: string; title: string; body: string; version: number; active: boolean; updated_at: string };

export function ScriptsAdmin({ scripts }: { scripts: Script[] }) {
  const router = useRouter();
  const [sel, setSel] = useState<string | "new">(scripts[0]?.id ?? "new");
  const cur = scripts.find((s) => s.id === sel);
  const [title, setTitle] = useState(cur?.title ?? "");
  const [body, setBody] = useState(cur?.body ?? "");
  const [active, setActive] = useState(cur?.active ?? true);
  const [pending, start] = useTransition();
  const pick = (id: string | "new") => {
    const s = scripts.find((x) => x.id === id);
    setSel(id); setTitle(s?.title ?? ""); setBody(s?.body ?? ""); setActive(s?.active ?? true);
  };
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_1fr]">
      <div className="space-y-1">
        <Button variant="outline" className="w-full" onClick={() => pick("new")}><Plus /> 新規スクリプト</Button>
        <ul className="mt-2 space-y-1">
          {scripts.map((s) => (
            <li key={s.id}>
              <button type="button" onClick={() => pick(s.id)} aria-current={s.id === sel}
                className={cn("w-full rounded-md border px-3 py-2 text-left text-sm", s.id === sel ? "border-accent-blue bg-blue-50" : "border-border bg-white hover:bg-slate-50")}>
                <span className="flex items-center justify-between gap-2"><span className="truncate font-medium">{s.title}</span>{s.active ? <Badge tone="emerald">使用中</Badge> : <Badge>停止</Badge>}</span>
                <span className="tabular text-xs text-slate-500">v{s.version}・{fmtDateTime(s.updated_at)}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <form className="space-y-3 rounded-lg border border-border bg-white p-4" onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await saveScript({ id: sel === "new" ? undefined : sel, title, body, active });
          if (!r.ok) return void toast.error(r.error);
          toast.success("保存しました（架電センターに即時反映されます）");
          router.refresh();
        });
      }}>
        <Field label="タイトル" htmlFor="s-title"><Input id="s-title" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={80} /></Field>
        <Field label="本文" htmlFor="s-body" hint="{顧客名} {担当者名} は架電センターで実際の名前に置き換えて表示されます。">
          <Textarea id="s-body" rows={16} value={body} onChange={(e) => setBody(e.target.value)} required maxLength={20000} className="font-mono text-[13px] leading-relaxed" />
        </Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" checked={active} onChange={(e) => setActive(e.target.checked)} /> 架電センターで使用する</label>
        <Button type="submit" disabled={pending}>保存する</Button>
      </form>
    </div>
  );
}
