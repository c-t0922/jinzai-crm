"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createSupabaseServer } from "@/lib/supabase/server";
import { authorize, AppError } from "@/server/auth/session";

type R<T> = { ok: true; data: T } | { ok: false; error: string };
function fail(e: unknown): { ok: false; error: string } {
  if (e instanceof AppError) return { ok: false, error: e.message };
  const m = e instanceof Error ? e.message : String(e);
  if (m.includes("FORBIDDEN")) return { ok: false, error: "権限がありません" };
  console.error("[appointments] action failed", m.slice(0, 120));
  return { ok: false, error: "処理に失敗しました" };
}

export async function updateAppointment(input: { id: string; status: string; scheduledAt?: string | null; note?: string | null; advisorId?: string | null }): Promise<R<null>> {
  try {
    await authorize("appointments.view");
    const p = z.object({
      id: z.uuid(),
      status: z.enum(["scheduled", "rescheduled", "canceled", "done", "no_show"]),
      scheduledAt: z.iso.datetime({ offset: true }).nullish(),
      note: z.string().max(500).nullish(),
      advisorId: z.uuid().nullish(),
    }).parse(input);
    const supabase = await createSupabaseServer();
    const { error } = await supabase.rpc("appt_update", { p_id: p.id, p_status: p.status, p_scheduled_at: p.scheduledAt ?? null, p_note: p.note ?? null, p_advisor: p.advisorId ?? null });
    if (error) throw new Error(error.message);
    revalidatePath("/appointments");
    revalidatePath(`/appointments/${p.id}`);
    return { ok: true, data: null };
  } catch (e) {
    return fail(e);
  }
}

export async function acknowledgeHandoff(appointmentId: string): Promise<R<null>> {
  try {
    await authorize("appointments.view");
    const supabase = await createSupabaseServer();
    const { error } = await supabase.rpc("handoff_ack", { p_appointment: z.uuid().parse(appointmentId) });
    if (error) throw new Error(error.message);
    revalidatePath(`/appointments/${appointmentId}`);
    return { ok: true, data: null };
  } catch (e) {
    return fail(e);
  }
}

export async function completeTask(id: string, done: boolean): Promise<R<null>> {
  try {
    await authorize("appointments.view");
    const supabase = await createSupabaseServer();
    const { error } = await supabase.from("tasks").update({ status: done ? "done" : "open", completed_at: done ? new Date().toISOString() : null }).eq("id", z.uuid().parse(id));
    if (error) throw new Error(error.message);
    revalidatePath("/tasks");
    return { ok: true, data: null };
  } catch (e) {
    return fail(e);
  }
}

export async function createTask(input: { title: string; dueAt?: string | null; contactId?: string | null }): Promise<R<null>> {
  try {
    const me = await authorize("appointments.view");
    const p = z.object({ title: z.string().trim().min(1).max(120), dueAt: z.iso.datetime({ offset: true }).nullish(), contactId: z.uuid().nullish() }).parse(input);
    const supabase = await createSupabaseServer();
    const { error } = await supabase.from("tasks").insert({ title: p.title, due_at: p.dueAt ?? null, contact_id: p.contactId ?? null, assignee_id: me.id, created_by: me.id });
    if (error) throw new Error(error.message);
    revalidatePath("/tasks");
    return { ok: true, data: null };
  } catch (e) {
    return fail(e);
  }
}

export async function markNotificationsRead(): Promise<R<null>> {
  try {
    const me = await authorize("dashboard.view");
    const supabase = await createSupabaseServer();
    await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", me.id).is("read_at", null);
    revalidatePath("/tasks");
    return { ok: true, data: null };
  } catch (e) {
    return fail(e);
  }
}
