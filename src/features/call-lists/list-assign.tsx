"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pause, Play, RefreshCw, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { assignEven, refreshList, setListStatus } from "@/server/domain/call-lists/actions";

export function ListAssign({ listId, status, type, users }: { listId: string; status: string; type: string; users: { id: string; name: string }[] }) {
  const router = useRouter();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [max, setMax] = useState("");
  const [pending, start] = useTransition();
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle>担当者へ均等割当</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-slate-500">未割当の架電可能な顧客を、優先順位の高い順に選択した担当者へ順番に割り当てます。</p>
          <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border border-border p-2">
            <label className="flex items-center gap-2 border-b border-border pb-1 text-xs font-medium">
              <input type="checkbox" checked={sel.size === users.length && users.length > 0} onChange={() => setSel(sel.size === users.length ? new Set() : new Set(users.map((u) => u.id)))} /> 全員
            </label>
            {users.map((u) => (
              <label key={u.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={sel.has(u.id)} onChange={() => { const n = new Set(sel); if (n.has(u.id)) n.delete(u.id); else n.add(u.id); setSel(n); }} /> {u.name}
              </label>
            ))}
          </div>
          <Field label="1人あたりの上限件数（任意）" htmlFor="max"><Input id="max" type="number" min={1} value={max} onChange={(e) => setMax(e.target.value)} placeholder="空欄なら全件" /></Field>
          <Button className="w-full" disabled={pending || sel.size === 0} onClick={() => start(async () => {
            const r = await assignEven(listId, [...sel], max ? Number(max) : null);
            if (!r.ok) return void toast.error(r.error);
            const total = Object.values(r.data).reduce((s, n) => s + n, 0);
            toast.success(total ? `${total} 件を ${Object.keys(r.data).length} 名に割り当てました` : "割り当て可能な顧客がいませんでした");
            router.refresh();
          })}>
            <Users /> {sel.size} 名に均等割当
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>操作</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {status === "active" ? (
            <Button variant="outline" disabled={pending} onClick={() => start(async () => { const r = await setListStatus(listId, "paused"); if (r.ok) { toast.success("一時停止しました。架電キューに表示されなくなります"); router.refresh(); } else toast.error(r.error); })}><Pause /> 一時停止</Button>
          ) : (
            <Button variant="outline" disabled={pending} onClick={() => start(async () => { const r = await setListStatus(listId, "active"); if (r.ok) { toast.success("再開しました"); router.refresh(); } else toast.error(r.error); })}><Play /> 再開</Button>
          )}
          {type === "dynamic" ? (
            <Button variant="outline" disabled={pending} onClick={() => start(async () => { const r = await refreshList(listId); if (r.ok) { toast.success(`${r.data} 件を追加しました`); router.refresh(); } else toast.error(r.error); })}><RefreshCw /> 条件を再評価</Button>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
