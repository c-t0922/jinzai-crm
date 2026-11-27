"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createSupabaseServer } from "@/lib/supabase/server";
import { authorize, AppError } from "@/server/auth/session";
import { toCsv } from "@/lib/csv";
import { displayPhone } from "@/lib/format";

type R<T> = { ok: true; data: T } | { ok: false; error: string };

function fail(e: unknown): { ok: false; error: string } {
  if (e instanceof AppError) return { ok: false, error: e.message };
  const m = e instanceof Error ? e.message : String(e);
  if (m.includes("FORBIDDEN")) return { ok: false, error: "権限がありません" };
  if (m.includes("VALIDATION")) return { ok: false, error: "入力内容を確認してください" };
  console.error("[contacts] action failed", m.slice(0, 120));
  return { ok: false, error: "処理に失敗しました" };
}

export async function reassignContacts(ids: string[], userId: string): Promise<R<number>> {
  try {
    await authorize("contacts.bulk");
    const supabase = await createSupabaseServer();
    const { data, error } = await supabase.rpc("contacts_reassign", { p_contacts: z.array(z.uuid()).min(1).max(1000).parse(ids), p_user: z.uuid().parse(userId) });
    if (error) throw new Error(error.message);
    revalidatePath("/contacts");
    return { ok: true, data };
  } catch (e) {
    return fail(e);
  }
}

export async function tagContacts(ids: string[], tag: string): Promise<R<number>> {
  try {
    await authorize("contacts.bulk");
    const supabase = await createSupabaseServer();
    const { data, error } = await supabase.rpc("contacts_add_tag", { p_contacts: z.array(z.uuid()).min(1).max(1000).parse(ids), p_tag: z.string().trim().min(1).max(30).parse(tag) });
    if (error) throw new Error(error.message);
    revalidatePath("/contacts");
    return { ok: true, data };
  } catch (e) {
    return fail(e);
  }
}

/** CSV 出力：権限・理由必須・件数上限・出力ログ（DB 側で記録） */
export async function exportContacts(filter: unknown, reason: string): Promise<R<string>> {
  try {
    await authorize("contacts.export");
    const supabase = await createSupabaseServer();
    const { data, error } = await supabase.rpc("contacts_export", { p: { filter }, p_reason: z.string().trim().min(2).max(200).parse(reason) });
    if (error) throw new Error(error.message);
    if (data.error === "TOO_MANY_ROWS") return { ok: false, error: `出力件数が上限（${data.limit}件）を超えています。条件を絞り込んでください。` };
    const rows = data.rows as Record<string, unknown>[];
    const cols = ["id", "name", "phone", "area_pref", "primary_source", "consent_status", "queue_state", "call_count", "last_called_at", "last_call_result", "first_inquiry_at"];
    const head = ["顧客ID", "氏名", "電話番号", "都道府県", "流入元", "利用許諾", "対応状況", "架電回数", "最終架電", "最終結果", "初回問合せ"];
    // 電話番号は E.164（+81…）のままだと数式扱い対策で ' が付くため、表示形式に変換する
    const csv = toCsv(head, rows.map((r) => cols.map((c) => (c === "phone" ? displayPhone(r[c] as string | null) : r[c]))));
    return { ok: true, data: csv };
  } catch (e) {
    return fail(e);
  }
}

export async function addSuppression(contactId: string, reason: string, note: string): Promise<R<null>> {
  try {
    await authorize("contacts.view");
    const supabase = await createSupabaseServer();
    const { error } = await supabase.rpc("suppression_add", {
      p_contact: z.uuid().parse(contactId),
      p_reason: z.enum(["refusal", "complaint", "legal", "request", "other"]).parse(reason),
      p_note: note || null,
    });
    if (error) throw new Error(error.message);
    revalidatePath(`/contacts/${contactId}`);
    return { ok: true, data: null };
  } catch (e) {
    return fail(e);
  }
}

export async function recordConsent(contactId: string, status: string, basis: string, terms: string, note: string): Promise<R<null>> {
  try {
    await authorize("admin.consents");
    const supabase = await createSupabaseServer();
    const { error } = await supabase.rpc("consent_record", {
      p_contact: z.uuid().parse(contactId),
      p_status: z.enum(["granted", "denied", "withdrawn", "unknown"]).parse(status),
      p_basis: basis,
      p_terms: terms || null,
      p_note: note || null,
    });
    if (error) throw new Error(error.message);
    revalidatePath(`/contacts/${contactId}`);
    return { ok: true, data: null };
  } catch (e) {
    return fail(e);
  }
}

export async function saveSearch(name: string, params: Record<string, string>): Promise<R<null>> {
  try {
    const me = await authorize("contacts.view");
    const supabase = await createSupabaseServer();
    const { error } = await supabase.from("saved_searches").insert({ user_id: me.id, name: z.string().trim().min(1).max(50).parse(name), params });
    if (error) throw new Error(error.message);
    revalidatePath("/contacts");
    return { ok: true, data: null };
  } catch (e) {
    return fail(e);
  }
}
