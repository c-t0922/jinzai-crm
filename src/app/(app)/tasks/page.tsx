import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/server/auth/session";
import { createSupabaseServer } from "@/lib/supabase/server";
import { PageBody, PageHeader } from "@/components/layout/page";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/states";
import { fmtDateTime } from "@/lib/format";
import { TaskCheckbox, NewTaskForm, MarkReadButton } from "@/features/appointments/task-controls";

export const metadata: Metadata = { title: "タスク管理" };

type TaskRow = { id: string; title: string; due_at: string | null; related_type: string | null; related_id: string | null; contacts: { id: string; full_name: string } | { id: string; full_name: string }[] | null };

export default async function TasksPage() {
  const me = await requireUser("appointments.view");
  const supabase = await createSupabaseServer();
  const now = new Date();
  const endToday = new Date(`${now.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" })}T23:59:59+09:00`);
  const [tasks, notes] = await Promise.all([
    supabase.from("tasks").select("*, contacts(id, full_name)").eq("assignee_id", me.id).eq("status", "open").order("due_at", { ascending: true, nullsFirst: false }).limit(200),
    supabase.from("notifications").select("*").eq("user_id", me.id).order("created_at", { ascending: false }).limit(30),
  ]);
  const list = (tasks.data ?? []) as TaskRow[];
  const overdue = list.filter((t) => t.due_at && new Date(t.due_at) < now);
  const today = list.filter((t) => t.due_at && new Date(t.due_at) >= now && new Date(t.due_at) <= endToday);
  const later = list.filter((t) => !t.due_at || new Date(t.due_at) > endToday);
  const unread = (notes.data ?? []).filter((n) => !n.read_at).length;

  return (
    <>
      <PageHeader title="タスク管理" description="自分に割り当てられたタスクと通知" />
      <PageBody className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <NewTaskForm />
          <Section title="期限切れ" items={overdue} tone="rose" />
          <Section title="本日" items={today} />
          <Section title="今後・期限なし" items={later} />
        </div>
        <Card className="self-start">
          <CardHeader><CardTitle>通知</CardTitle>{unread ? <MarkReadButton /> : null}</CardHeader>
          <CardContent className="p-0">
            {!notes.data?.length ? <EmptyState title="通知はありません" /> : (
              <ul className="divide-y divide-border">
                {notes.data.map((n) => (
                  <li key={n.id} className="px-4 py-2.5">
                    <p className="flex items-center gap-2 text-sm">{!n.read_at ? <span className="size-1.5 rounded-full bg-accent-blue" aria-label="未読" /> : null}{n.link ? <Link href={n.link} className="hover:text-accent-blue">{n.title}</Link> : n.title}</p>
                    {n.body ? <p className="text-xs text-slate-500">{n.body}</p> : null}
                    <p className="tabular text-[11px] text-slate-400">{fmtDateTime(n.created_at)}</p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </PageBody>
    </>
  );
}

function Section({ title, items, tone }: { title: string; items: TaskRow[]; tone?: "rose" }) {
  return (
    <Card>
      <CardHeader><CardTitle className={tone === "rose" ? "text-rose-700" : undefined}>{title}</CardTitle><Badge tone={tone ?? "slate"}>{items.length}</Badge></CardHeader>
      <CardContent className="p-0">
        {items.length === 0 ? <p className="px-4 py-6 text-center text-xs text-slate-400">ありません</p> : (
          <ul className="divide-y divide-border">
            {items.map((t) => {
              const c = Array.isArray(t.contacts) ? t.contacts[0] : t.contacts;
              return (
                <li key={t.id} className="flex items-center gap-3 px-4 py-2.5">
                  <TaskCheckbox id={t.id} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{t.title}</p>
                    <p className="text-xs text-slate-500">
                      {t.due_at ? <span className="tabular">期限 {fmtDateTime(t.due_at)}</span> : "期限なし"}
                      {c ? <> ・ <Link href={`/contacts/${c.id}`} className="text-accent-blue hover:underline">{c.full_name}</Link></> : null}
                      {t.related_type === "appointment" && t.related_id ? <> ・ <Link href={`/appointments/${t.related_id}`} className="text-accent-blue hover:underline">アポイント</Link></> : null}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
