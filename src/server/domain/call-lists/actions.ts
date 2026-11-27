"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createSupabaseServer } from "@/lib/supabase/server";
import { authorize, AppError } from "@/server/auth/session";

type R<T> = { ok: true; data: T } | { ok: false; error: string };

const ruleSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.object({ op: z.enum(["and", "or"]), rules: z.array(ruleSchema).max(30) }),
    z.object({
      field: z.enum(["first_inquiry_at", "area_pref", "primary_source", "call_count", "last_called_at", "last_call_result", "job_change_intent", "queue_state", "consent_status", "is_suppressed", "callable", "assigned_user", "tags"]),
      operator: z.enum(["in", "not_in", "eq", "gte", "lte", "between", "older_than_days", "within_days", "is_null", "not_null", "contains_any"]),
      value: z.unknown(),
    }),
  ]),
);
export type FilterNode = { op: "and" | "or"; rules: (FilterNode | { field: string; operator: string; value: unknown })[] };

function fail(e: unknown): { ok: false; error: string } {
  if (e instanceof AppError) return { ok: false, error: e.message };
  const m = e instanceof Error ? e.message : String(e);
  if (m.includes("FORBIDDEN")) return { ok: false, error: "権限がありません" };
  if (m.includes("VALIDATION") || m.includes("INVALID_FILTER")) return { ok: false, error: "条件または入力内容を確認してください" };
  console.error("[call-lists] action failed", m.slice(0, 160));
  return { ok: false, error: "処理に失敗しました" };
}

export type Preview = { matched: number; callable: number; excludedSuppressed: number; excludedConsent: number; excludedInvalidPhone: number; excludedClosed: number; excludedAssigned: number };

export async function previewList(filter: FilterNode): Promise<R<Preview>> {
  try {
    await authorize("calllists.manage");
    const supabase = await createSupabaseServer();
    const { data, error } = await supabase.rpc("cl_preview", { p_filter: ruleSchema.parse(filter) });
    if (error) throw new Error(error.message);
    return { ok: true, data };
  } catch (e) {
    return fail(e);
  }
}

export async function createList(input: { name: string; description?: string; type: "static" | "dynamic"; teamId?: string | null; priority: number; filter: FilterNode }): Promise<R<string>> {
  try {
    await authorize("calllists.manage");
    const p = z
      .object({ name: z.string().trim().min(1).max(80), description: z.string().max(300).optional(), type: z.enum(["static", "dynamic"]), teamId: z.uuid().nullish(), priority: z.number().int().min(1).max(999), filter: ruleSchema })
      .parse(input);
    const supabase = await createSupabaseServer();
    const { data, error } = await supabase.rpc("cl_create", { p_name: p.name, p_filter: p.filter, p_type: p.type, p_team: p.teamId ?? null, p_priority: p.priority, p_description: p.description ?? null });
    if (error) throw new Error(error.message);
    revalidatePath("/call-lists");
    return { ok: true, data };
  } catch (e) {
    return fail(e);
  }
}

export async function assignEven(listId: string, userIds: string[], maxPerUser?: number | null): Promise<R<Record<string, number>>> {
  try {
    await authorize("calllists.manage");
    const supabase = await createSupabaseServer();
    const { data, error } = await supabase.rpc("cl_assign_even", {
      p_list: z.uuid().parse(listId),
      p_users: z.array(z.uuid()).min(1).parse(userIds),
      p_max_per_user: maxPerUser ? z.number().int().min(1).max(10000).parse(maxPerUser) : null,
    });
    if (error) throw new Error(error.message);
    revalidatePath(`/call-lists/${listId}`);
    return { ok: true, data };
  } catch (e) {
    return fail(e);
  }
}

export async function setListStatus(listId: string, status: "active" | "paused" | "archived"): Promise<R<null>> {
  try {
    await authorize("calllists.manage");
    const supabase = await createSupabaseServer();
    const { error } = await supabase.rpc("cl_set_status", { p_list: z.uuid().parse(listId), p_status: status });
    if (error) throw new Error(error.message);
    revalidatePath(`/call-lists/${listId}`);
    revalidatePath("/call-lists");
    return { ok: true, data: null };
  } catch (e) {
    return fail(e);
  }
}

export async function refreshList(listId: string): Promise<R<number>> {
  try {
    await authorize("calllists.manage");
    const supabase = await createSupabaseServer();
    const { data, error } = await supabase.rpc("cl_refresh", { p_list: z.uuid().parse(listId) });
    if (error) throw new Error(error.message);
    revalidatePath(`/call-lists/${listId}`);
    return { ok: true, data };
  } catch (e) {
    return fail(e);
  }
}
