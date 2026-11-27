"use server";
/**
 * 架電センターの Server Actions（docs/07 架電センター）。
 * 権限チェック：authorize()（API層）→ RPC 内の can_call_role()/can_view_contact()（DB層）
 */
import { z } from "zod";
import { createSupabaseServer } from "@/lib/supabase/server";
import { authorize, AppError } from "@/server/auth/session";
import { getCtiProvider } from "@/server/integrations/cti";
import { saveResultSchema, type SaveResultInput } from "@/lib/call-result";
import { can } from "@/lib/permissions";
import { displayPhone, maskPhone } from "@/lib/format";

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string; reason?: string; field?: string };

export type ContactCard = {
  id: string;
  name: string;
  kana: string;
  email: string | null;
  area: string;
  firstInquiryAt: string | null;
  source: string;
  sourceDetail: string | null;
  consentStatus: string;
  isSuppressed: boolean;
  callable: boolean;
  jobChangeIntent: string | null;
  tags: string[];
  queueState: string;
  callCount: number;
  lastCalledAt: string | null;
  lastCallResult: string | null;
  nextCallAt: string | null;
  phones: { id: string; display: string; isValid: boolean; isPrimary: boolean }[];
  history: { at: string; result: string; label: string; category: string; memo: string | null; user: string; durationSec: number | null }[];
  draft: Record<string, unknown> | null;
};

type RawCard = Omit<ContactCard, "phones"> & { phones: { id: string; e164: string; isValid: boolean; isPrimary: boolean }[] };

function wrapError(e: unknown): { ok: false; error: string } {
  if (e instanceof AppError) return { ok: false, error: e.code };
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes("FORBIDDEN")) return { ok: false, error: "FORBIDDEN" };
  // 個人情報をログに出さない：コードのみ
  console.error("[call-center] action failed", msg.slice(0, 120));
  return { ok: false, error: "SERVER_ERROR" };
}

async function toCard(raw: RawCard | null, rolesCanSeeFull: boolean): Promise<ContactCard | null> {
  if (!raw) return null;
  return {
    ...raw,
    // 架電担当者には発信前はマスク表示（発信時にサーバー側で番号を解決する）
    phones: raw.phones.map((p) => ({
      id: p.id,
      display: rolesCanSeeFull ? displayPhone(p.e164) : maskPhone(p.e164),
      isValid: p.isValid,
      isPrimary: p.isPrimary,
    })),
  };
}

export async function getQueue(tab: string): Promise<ActionResult<unknown>> {
  try {
    await authorize("callcenter.use");
    const supabase = await createSupabaseServer();
    const { data, error } = await supabase.rpc("cc_queue", { p_tab: z.enum(["today", "recall", "new", "untouched"]).parse(tab), p_limit: 100 });
    if (error) throw new Error(error.message);
    return { ok: true, data };
  } catch (e) {
    return wrapError(e);
  }
}

export async function nextContact(skipId?: string | null): Promise<ActionResult<{ contact: ContactCard | null; lockExpiresAt?: string }>> {
  try {
    const me = await authorize("callcenter.use");
    const supabase = await createSupabaseServer();
    const { data, error } = await supabase.rpc("cc_next", { p_skip: skipId ?? null });
    if (error) throw new Error(error.message);
    return { ok: true, data: { contact: await toCard(data.contact, can(me.roles, "contacts.viewAllPhones")), lockExpiresAt: data.lockExpiresAt } };
  } catch (e) {
    return wrapError(e);
  }
}

export async function openContact(contactId: string): Promise<ActionResult<{ contact: ContactCard | null; blockReason?: string | null }>> {
  try {
    const me = await authorize("callcenter.use");
    const supabase = await createSupabaseServer();
    const { data, error } = await supabase.rpc("cc_open", { p_contact: z.uuid().parse(contactId) });
    if (error) throw new Error(error.message);
    if (data.error) return { ok: false, error: data.error };
    return { ok: true, data: { contact: await toCard(data.contact, can(me.roles, "contacts.viewAllPhones")), blockReason: data.blockReason } };
  } catch (e) {
    return wrapError(e);
  }
}

export async function heartbeat(contactId: string): Promise<ActionResult<string | null>> {
  try {
    await authorize("callcenter.use");
    const supabase = await createSupabaseServer();
    const { data, error } = await supabase.rpc("cc_heartbeat", { p_contact: z.uuid().parse(contactId) });
    if (error) throw new Error(error.message);
    return { ok: true, data };
  } catch (e) {
    return wrapError(e);
  }
}

export async function releaseContact(contactId: string): Promise<ActionResult<null>> {
  try {
    await authorize("callcenter.use");
    const supabase = await createSupabaseServer();
    await supabase.rpc("cc_release", { p_contact: z.uuid().parse(contactId) });
    return { ok: true, data: null };
  } catch (e) {
    return wrapError(e);
  }
}

/** 発信：DB で直前チェック（許諾・架電禁止・ロック・時間帯・二重発信）→ CTI で発信 */
export async function startCall(input: { contactId: string; idempotencyKey: string; phoneId?: string | null; scriptId?: string | null }): Promise<
  ActionResult<{ callLogId: string; startedAt: string; isDemo: boolean; provider: string; displayNumber: string }>
> {
  try {
    await authorize("callcenter.use");
    const p = z
      .object({ contactId: z.uuid(), idempotencyKey: z.string().min(8), phoneId: z.uuid().nullish(), scriptId: z.uuid().nullish() })
      .parse(input);
    const cti = getCtiProvider();
    const supabase = await createSupabaseServer();
    const { data, error } = await supabase.rpc("cc_start_call", {
      p_contact: p.contactId,
      p_idempotency_key: p.idempotencyKey,
      p_phone_id: p.phoneId ?? null,
      p_script: p.scriptId ?? null,
      p_provider: cti.name,
      p_is_demo: cti.isDemo,
    });
    if (error) throw new Error(error.message);
    if (data.error) return { ok: false, error: data.error, reason: data.reason };
    try {
      const { providerCallId } = await cti.dial({ callLogId: data.callLogId, toE164: data.toE164 });
      await supabase.rpc("cc_update_call", { p_call: data.callLogId, p_status: "ringing", p_provider_call_id: providerCallId });
    } catch (dialErr) {
      await supabase.rpc("cc_update_call", { p_call: data.callLogId, p_status: "failed", p_error: "dial_failed" });
      throw dialErr;
    }
    return {
      ok: true,
      data: { callLogId: data.callLogId, startedAt: data.startedAt, isDemo: cti.isDemo, provider: cti.name, displayNumber: displayPhone(data.toE164) },
    };
  } catch (e) {
    return wrapError(e);
  }
}

const statusSchema = z.enum(["ringing", "in_progress", "completed", "failed", "no_answer", "busy", "canceled"]);

/** モック端末からの通話ステータス報告（本番 CTI では Webhook が source of truth） */
export async function reportCallStatus(callLogId: string, status: string): Promise<ActionResult<{ status: string; durationSec: number | null }>> {
  try {
    await authorize("callcenter.use");
    const supabase = await createSupabaseServer();
    const { data, error } = await supabase.rpc("cc_update_call", { p_call: z.uuid().parse(callLogId), p_status: statusSchema.parse(status) });
    if (error) throw new Error(error.message);
    return { ok: true, data };
  } catch (e) {
    return wrapError(e);
  }
}

export async function saveResult(input: SaveResultInput): Promise<ActionResult<{ actions: { type: string; at?: string; appointmentId?: string }[] }>> {
  try {
    await authorize("callcenter.use");
    const parsed = saveResultSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION_ERROR", field: String(parsed.error.issues[0]?.path?.[0] ?? "") };
    const p = parsed.data;
    const supabase = await createSupabaseServer();
    const { data, error } = await supabase.rpc("cc_save_result", {
      p_contact: p.contactId,
      p_call: p.callLogId,
      p_result: p.resultCode,
      p_idempotency_key: p.idempotencyKey,
      p_hearing: p.hearing,
      p_memo: p.memo ?? null,
      p_next_call_at: p.nextCallAt ?? null,
      p_appointment: p.appointment
        ? { ...p.appointment, meetingUrl: p.appointment.meetingUrl || null, advisorUserId: p.appointment.advisorUserId || null }
        : null,
      p_handoff_to: null,
    });
    if (error) throw new Error(error.message);
    if (data.error) return { ok: false, error: data.error, field: data.field };
    return { ok: true, data: { actions: data.actions } };
  } catch (e) {
    return wrapError(e);
  }
}

export async function saveDraft(contactId: string, payload: Record<string, unknown>): Promise<ActionResult<null>> {
  try {
    await authorize("callcenter.use");
    const supabase = await createSupabaseServer();
    const { error } = await supabase.rpc("cc_save_draft", { p_contact: z.uuid().parse(contactId), p_payload: payload });
    if (error) throw new Error(error.message);
    return { ok: true, data: null };
  } catch (e) {
    return wrapError(e);
  }
}

export async function todayStats(): Promise<ActionResult<{ calls: number; connects: number; appointments: number; goalAppointments: number | null; monthAppointments: number }>> {
  try {
    await authorize("callcenter.use");
    const supabase = await createSupabaseServer();
    const { data, error } = await supabase.rpc("cc_today_stats");
    if (error) throw new Error(error.message);
    return { ok: true, data };
  } catch (e) {
    return wrapError(e);
  }
}
