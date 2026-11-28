"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createSupabaseServer } from "@/lib/supabase/server";
import { authorize, AppError } from "@/server/auth/session";

/**
 * 顧客 CSV 取り込み。正規化はブラウザで行い、ここでは形式を再検証して RPC に渡す。
 * 個人情報を含むため、行の中身はログに出さない（件数・ジョブID のみ）。
 */
type R<T> = { ok: true; data: T } | { ok: false; error: string };

function fail(e: unknown): { ok: false; error: string } {
  if (e instanceof AppError) return { ok: false, error: e.message };
  if (e instanceof z.ZodError) return { ok: false, error: "取り込みデータの形式が正しくありません" };
  const m = e instanceof Error ? e.message : String(e);
  if (m.includes("FORBIDDEN")) return { ok: false, error: "権限がありません" };
  if (m.includes("JOB_CLOSED")) return { ok: false, error: "この取り込みは終了しています" };
  if (m.includes("NOT_FOUND")) return { ok: false, error: "取り込みが見つかりません" };
  if (m.includes("VALIDATION")) return { ok: false, error: "入力内容を確認してください" };
  console.error("[import] failed", m.slice(0, 80).replace(/[^\x20-\x7e]/g, "?"));
  return { ok: false, error: "取り込みに失敗しました" };
}

const startSchema = z.object({
  appId: z.string().trim().min(1).max(40),
  total: z.number().int().min(1).max(1_000_000),
  consentBasis: z.string().trim().min(5).max(300).nullable(),
});

export async function startImport(input: z.input<typeof startSchema>): Promise<R<string>> {
  try {
    await authorize("admin.integrations");
    const p = startSchema.parse(input);
    const supabase = await createSupabaseServer();
    const { data, error } = await supabase.rpc("import_start", { p_app: p.appId, p_total: p.total, p_consent_basis: p.consentBasis });
    if (error) throw new Error(error.message);
    return { ok: true, data: data as string };
  } catch (e) {
    return fail(e);
  }
}

const e164 = z.string().regex(/^\+81[1-9]\d{8,9}$/);
const str = (n: number) => z.string().max(n);
const rowSchema = z.object({
  recordId: z.string().trim().min(1).max(64),
  lastName: z.string().trim().min(1).max(50),
  firstName: str(50),
  lastKana: str(50).nullable(),
  firstKana: str(50).nullable(),
  phones: z.array(e164).max(3),
  email: z.email().max(200).nullable(),
  pref: str(10).nullable(),
  city: str(100).nullable(),
  inquiredAt: z.iso.datetime().nullable(),
  sourceDetail: str(100).nullable(),
  consent: z.enum(["granted", "denied"]).nullable(),
});
const errSchema = z.object({ recordId: str(64), code: z.string().max(40), message: str(100) });
const batchSchema = z.object({
  jobId: z.uuid(),
  rows: z.array(rowSchema).max(1000),
  errors: z.array(errSchema).max(1000),
});
export type ImportBatchResult = { inserted: number; updated: number; granted: number; denied: number; duplicates: number; errors: number };

export async function importBatch(input: z.input<typeof batchSchema>): Promise<R<ImportBatchResult>> {
  try {
    await authorize("admin.integrations");
    const p = batchSchema.parse(input);
    const supabase = await createSupabaseServer();
    const { data, error } = await supabase.rpc("import_contacts", { p_job: p.jobId, p_rows: p.rows, p_errors: p.errors });
    if (error) throw new Error(error.message);
    return { ok: true, data: data as ImportBatchResult };
  } catch (e) {
    return fail(e);
  }
}

export async function finishImport(jobId: string, status: "completed" | "canceled" | "failed"): Promise<R<null>> {
  try {
    await authorize("admin.integrations");
    const supabase = await createSupabaseServer();
    const { error } = await supabase.rpc("import_finish", { p_job: z.uuid().parse(jobId), p_status: status });
    if (error) throw new Error(error.message);
    revalidatePath("/admin/import");
    revalidatePath("/admin/consents");
    return { ok: true, data: null };
  } catch (e) {
    return fail(e);
  }
}
