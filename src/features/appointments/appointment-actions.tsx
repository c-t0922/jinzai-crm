"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { fromLocalInput, toLocalInput } from "@/lib/datetime-local";
import { acknowledgeHandoff, updateAppointment } from "@/server/domain/appointments/actions";

export function AppointmentActions(props: { id: string; status: string; scheduledAt: string; advisorId: string | null; acknowledged: boolean; advisors: { id: string; name: string }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [at, setAt] = useState(toLocalInput(props.scheduledAt));
  const [advisor, setAdvisor] = useState(props.advisorId ?? "");
  const [note, setNote] = useState("");
  const run = (status: string, extra: { scheduledAt?: string | null; advisorId?: string | null } = {}) =>
    start(async () => {
      const r = await updateAppointment({ id: props.id, status, note: note || null, ...extra });
      if (!r.ok) return void toast.error(r.error);
      toast.success("更新しました");
      router.refresh();
    });
  const open = props.status === "scheduled" || props.status === "rescheduled";
  return (
    <Card>
      <CardHeader><CardTitle>操作</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {!props.acknowledged ? (
          <Button variant="outline" className="w-full" disabled={pending} onClick={() => start(async () => { const r = await acknowledgeHandoff(props.id); if (r.ok) { toast.success("引き継ぎを確認しました"); router.refresh(); } else toast.error(r.error); })}>
            引き継ぎ内容を確認した
          </Button>
        ) : null}
        {open ? (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="success" disabled={pending} onClick={() => run("done")}>面談実施</Button>
              <Button variant="outline" disabled={pending} onClick={() => run("no_show")}>未実施</Button>
            </div>
            <Field label="日程変更" htmlFor="at">
              <div className="flex gap-2">
                <Input id="at" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
                <Button variant="outline" disabled={pending || !at} onClick={() => run("rescheduled", { scheduledAt: fromLocalInput(at) })}>変更</Button>
              </div>
            </Field>
            <Field label="面談担当（CA）" htmlFor="adv">
              <div className="flex gap-2">
                <Select id="adv" value={advisor} onChange={(e) => setAdvisor(e.target.value)}>
                  <option value="">未定</option>
                  {props.advisors.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </Select>
                <Button variant="outline" disabled={pending || !advisor || advisor === props.advisorId} onClick={() => run(props.status, { advisorId: advisor })}>割当</Button>
              </div>
            </Field>
            <Field label="メモ・キャンセル理由" htmlFor="note"><Textarea id="note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
            <Button variant="ghost" className="w-full text-rose-700" disabled={pending} onClick={() => { if (window.confirm("このアポイントをキャンセルしますか？")) run("canceled"); }}>キャンセル</Button>
          </>
        ) : <p className="text-xs text-slate-500">このアポイントは完了しています。</p>}
      </CardContent>
    </Card>
  );
}
