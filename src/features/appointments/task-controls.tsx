"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fromLocalInput } from "@/lib/datetime-local";
import { completeTask, createTask, markNotificationsRead } from "@/server/domain/appointments/actions";

export function TaskCheckbox({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <input type="checkbox" className="size-4" aria-label="完了にする" disabled={pending}
      onChange={(e) => { const done = e.target.checked; start(async () => { const r = await completeTask(id, done); if (r.ok) router.refresh(); else toast.error(r.error); }); }} />
  );
}

export function NewTaskForm() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [pending, start] = useTransition();
  return (
    <form className="flex flex-wrap gap-2 rounded-lg border border-border bg-white p-3" onSubmit={(e) => {
      e.preventDefault();
      start(async () => {
        const r = await createTask({ title, dueAt: fromLocalInput(due) });
        if (!r.ok) return void toast.error(r.error);
        setTitle(""); setDue("");
        router.refresh();
      });
    }}>
      <Input className="min-w-48 flex-1" placeholder="新しいタスク" aria-label="タスク名" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={120} />
      <Input className="w-52" type="datetime-local" aria-label="期限" value={due} onChange={(e) => setDue(e.target.value)} />
      <Button type="submit" disabled={pending || !title.trim()}><Plus /> 追加</Button>
    </form>
  );
}

export function MarkReadButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(async () => { await markNotificationsRead(); router.refresh(); })}>すべて既読</Button>;
}
