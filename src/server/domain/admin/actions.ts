"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createSupabaseServer } from "@/lib/supabase/server";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { authorize, AppError } from "@/server/auth/session";
import { ROLES } from "@/lib/permissions";
import { RULE_SCHEMAS, type EditableRule } from "@/lib/admin-rules";

type R<T> = { ok: true; data: T } | { ok: false; error: string };

function fail(e: unknown): { ok: false; error: string } {
  if (e instanceof AppError) return { ok: false, error: e.message };
  if (e instanceof z.ZodError) return { ok: false, error: "入力内容を確認してください" };
  const m = e instanceof Error ? e.message : String(e);
  if (m.includes("SELF_LOCKOUT")) return { ok: false, error: "自分自身の管理者権限の削除・利用停止はできません" };
  if (m.includes("FORBIDDEN") || m.includes("row-level security")) return { ok: false, error: "権限がありません" };
  if (m.includes("VALIDATION")) return { ok: false, error: "入力内容を確認してください" };
  if (m.includes("duplicate key")) return { ok: false, error: "既に登録されています" };
  console.error("[admin] action failed", m.slice(0, 120));
  return { ok: false, error: "処理に失敗しました" };
}

const role = z.enum(ROLES);

// ---------- ユーザー ----------
const newUserSchema = z.object({
  name: z.string().trim().min(1).max(60),
  email: z.email().max(200),
  roles: z.array(role).min(1),
  teamId: z.uuid().optional(),
});

/** リンクの戻り先（招待・パスワード設定）。プロキシ経由でも本来のホスト名を使う */
async function siteOrigin() {
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
}

/**
 * 業務ユーザーを登録し、パスワード設定用の招待リンクを発行する。
 * Supabase 無料プランの標準メールは組織外に届かないため、リンクを管理者に返し、本人へ直接伝えてもらう。
 */
export async function createUser(input: z.input<typeof newUserSchema>): Promise<R<{ id: string; link: string }>> {
  try {
    await authorize("admin.users");
    const p = newUserSchema.parse(input);
    const admin = createSupabaseAdmin();
    const { data: invited, error: invErr } = await admin.auth.admin.generateLink({
      type: "invite", email: p.email, options: { redirectTo: `${await siteOrigin()}/auth/callback` },
    });
    if (invErr || !invited.user) throw new Error(invErr?.message.includes("already") ? "duplicate key" : "invite failed");
    const supabase = await createSupabaseServer();
    const { data, error } = await supabase.rpc("admin_create_user", {
      p_auth: invited.user.id, p_name: p.name, p_email: p.email, p_roles: p.roles, p_team: p.teamId ?? null,
    });
    if (error) {
      await admin.auth.admin.deleteUser(invited.user.id); // 業務側の登録に失敗したら認証ユーザーも戻す
      throw new Error(error.message);
    }
    revalidatePath("/admin/users");
    return { ok: true, data: { id: data as string, link: invited.properties.action_link } };
  } catch (e) {
    return fail(e);
  }
}

/** パスワード（再）設定リンクを発行する（パスワードを忘れた・招待リンクの期限切れ） */
export async function issuePasswordLink(userId: string): Promise<R<string>> {
  try {
    await authorize("admin.users");
    const supabase = await createSupabaseServer();
    const { data: u } = await supabase.from("users").select("email, status").eq("id", z.uuid().parse(userId)).maybeSingle();
    if (!u) throw new AppError("NOT_FOUND", "ユーザーが見つかりません");
    if (u.status !== "active") throw new AppError("VALIDATION", "利用停止中のユーザーには発行できません");
    const admin = createSupabaseAdmin();
    const { data, error } = await admin.auth.admin.generateLink({
      type: "recovery", email: u.email, options: { redirectTo: `${await siteOrigin()}/auth/callback` },
    });
    if (error) throw new Error("link failed");
    return { ok: true, data: data.properties.action_link };
  } catch (e) {
    return fail(e);
  }
}

const updUserSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).max(60),
  status: z.enum(["active", "suspended"]),
  roles: z.array(role).min(1),
  teams: z.array(z.uuid()),
  leaderTeams: z.array(z.uuid()),
});

export async function updateUser(input: z.input<typeof updUserSchema>): Promise<R<null>> {
  try {
    await authorize("admin.users");
    const p = updUserSchema.parse(input);
    const supabase = await createSupabaseServer();
    const { error } = await supabase.rpc("admin_update_user", {
      p_user: p.id, p_name: p.name, p_status: p.status, p_roles: p.roles, p_teams: p.teams,
      p_leader_teams: p.leaderTeams.filter((t) => p.teams.includes(t)),
    });
    if (error) throw new Error(error.message);
    revalidatePath("/admin/users");
    return { ok: true, data: null };
  } catch (e) {
    return fail(e);
  }
}

// ---------- チーム ----------
const teamSchema = z.object({ id: z.uuid().optional(), name: z.string().trim().min(1).max(60), baseLocation: z.string().trim().max(60).optional() });
export async function saveTeam(input: z.input<typeof teamSchema>): Promise<R<null>> {
  try {
    await authorize("admin.teams");
    const p = teamSchema.parse(input);
    const supabase = await createSupabaseServer();
    const row = { name: p.name, base_location: p.baseLocation || null, updated_at: new Date().toISOString() };
    const { error } = p.id ? await supabase.from("teams").update(row).eq("id", p.id) : await supabase.from("teams").insert(row);
    if (error) throw new Error(error.message);
    revalidatePath("/admin/teams");
    return { ok: true, data: null };
  } catch (e) {
    return fail(e);
  }
}

// ---------- 目標 ----------
const goalSchema = z.object({
  scope: z.enum(["org", "team", "user"]),
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  metric: z.enum(["calls", "connects", "appointments", "revenue"]),
  value: z.coerce.number().int().min(0).max(100_000_000),
  userId: z.uuid().optional(),
  teamId: z.uuid().optional(),
});
export async function setGoal(input: z.input<typeof goalSchema>): Promise<R<null>> {
  try {
    await authorize("admin.goals");
    const p = goalSchema.parse(input);
    const supabase = await createSupabaseServer();
    const { error } = await supabase.rpc("goal_set", { p_scope: p.scope, p_period: p.period, p_metric: p.metric, p_value: p.value, p_user: p.userId ?? null, p_team: p.teamId ?? null });
    if (error) throw new Error(error.message);
    revalidatePath("/admin/goals");
    return { ok: true, data: null };
  } catch (e) {
    return fail(e);
  }
}

// ---------- トークスクリプト ----------
const scriptSchema = z.object({ id: z.uuid().optional(), title: z.string().trim().min(1).max(80), body: z.string().trim().min(1).max(20000), active: z.boolean() });
export async function saveScript(input: z.input<typeof scriptSchema>): Promise<R<null>> {
  try {
    const me = await authorize("admin.scripts");
    const p = scriptSchema.parse(input);
    const supabase = await createSupabaseServer();
    const { error } = p.id
      ? await supabase.from("scripts").update({ title: p.title, body: p.body, active: p.active }).eq("id", p.id)
      : await supabase.from("scripts").insert({ title: p.title, body: p.body, active: p.active, created_by: me.id });
    if (error) throw new Error(error.message);
    revalidatePath("/admin/scripts");
    return { ok: true, data: null };
  } catch (e) {
    return fail(e);
  }
}

// ---------- 架電ルール（admin のみ編集。PM は閲覧） ----------


export async function updateRule(key: EditableRule, value: unknown): Promise<R<null>> {
  try {
    const me = await authorize("admin.rules");
    if (!me.roles.includes("admin")) throw new AppError("FORBIDDEN", "架電ルールの変更はシステム管理者のみ可能です");
    const schema = RULE_SCHEMAS[key];
    if (!schema) throw new AppError("VALIDATION", "変更できない設定です");
    const v = schema.parse(value);
    const supabase = await createSupabaseServer();
    const { error, count } = await supabase.from("call_rules").update({ value: v, updated_by: me.id, updated_at: new Date().toISOString() }, { count: "exact" }).eq("key", key);
    if (error) throw new Error(error.message);
    if (!count) throw new Error("FORBIDDEN");
    revalidatePath("/admin/call-rules");
    return { ok: true, data: null };
  } catch (e) {
    return fail(e);
  }
}

const masterSchema = z.object({
  code: z.string().min(1).max(40),
  label: z.string().trim().min(1).max(30),
  active: z.boolean(),
  shortcutKey: z.string().regex(/^[0-9a-z]$/).nullable(),
  sortOrder: z.number().int().min(0).max(9999),
});
export async function updateResultMaster(input: z.input<typeof masterSchema>): Promise<R<null>> {
  try {
    const me = await authorize("admin.rules");
    if (!me.roles.includes("admin")) throw new AppError("FORBIDDEN", "架電結果マスタの変更はシステム管理者のみ可能です");
    const p = masterSchema.parse(input);
    const supabase = await createSupabaseServer();
    if (p.shortcutKey) {
      const { data: dup } = await supabase.from("call_result_masters").select("code").eq("shortcut_key", p.shortcutKey).neq("code", p.code).eq("active", true).limit(1);
      if (dup?.length) throw new AppError("VALIDATION", `ショートカット「${p.shortcutKey}」は他の結果で使用中です`);
    }
    const { error, count } = await supabase.from("call_result_masters")
      .update({ label: p.label, active: p.active, shortcut_key: p.shortcutKey, sort_order: p.sortOrder }, { count: "exact" }).eq("code", p.code);
    if (error) throw new Error(error.message);
    if (!count) throw new Error("FORBIDDEN");
    revalidatePath("/admin/call-rules");
    return { ok: true, data: null };
  } catch (e) {
    return fail(e);
  }
}

// ---------- 個人情報・利用許諾 ----------
export async function releaseSuppression(id: string, reason: string): Promise<R<null>> {
  try {
    await authorize("suppression.release");
    const supabase = await createSupabaseServer();
    const { error } = await supabase.rpc("suppression_release", { p_id: z.uuid().parse(id), p_reason: z.string().trim().min(5).max(300).parse(reason) });
    if (error) throw new Error(error.message);
    revalidatePath("/admin/consents");
    return { ok: true, data: null };
  } catch (e) {
    return fail(e);
  }
}

const bulkSchema = z.object({
  source: z.enum(["kintone", "lp", "manual"]),
  pref: z.string().max(10).optional(),
  basis: z.string().trim().min(5).max(200),
  terms: z.string().trim().min(1).max(60),
  note: z.string().max(300).optional(),
  confirmCount: z.number().int().min(1),
});

function bulkFilter(p: { source: string; pref?: string }) {
  const rules: { field: string; operator: string; value: unknown }[] = [
    { field: "primary_source", operator: "eq", value: p.source },
    { field: "consent_status", operator: "eq", value: "unknown" },
  ];
  if (p.pref) rules.push({ field: "area_pref", operator: "eq", value: p.pref });
  return { op: "and", rules };
}

export async function countBulkGrant(source: string, pref?: string): Promise<R<number>> {
  try {
    await authorize("consent.bulk");
    const supabase = await createSupabaseServer();
    const p = bulkSchema.pick({ source: true, pref: true }).parse({ source, pref: pref || undefined });
    const { data, error } = await supabase.rpc("contacts_count", { p: { filter: bulkFilter(p) } });
    if (error) throw new Error(error.message);
    return { ok: true, data: Number(data) };
  } catch (e) {
    return fail(e);
  }
}

/** 一括許諾：根拠（同意取得方法）必須。件数を確認させてから実行し、監査ログに残る */
export async function bulkGrantConsent(input: z.input<typeof bulkSchema>): Promise<R<number>> {
  try {
    await authorize("consent.bulk");
    const p = bulkSchema.parse(input);
    const supabase = await createSupabaseServer();
    const filter = bulkFilter(p);
    const { data: cnt } = await supabase.rpc("contacts_count", { p: { filter } });
    if (Number(cnt) !== p.confirmCount) throw new AppError("VALIDATION", "対象件数が変わりました。もう一度件数を確認してください");
    const { data, error } = await supabase.rpc("consent_bulk_grant", { p_filter: filter, p_basis: p.basis, p_terms: p.terms, p_note: p.note ?? null });
    if (error) throw new Error(error.message);
    revalidatePath("/admin/consents");
    return { ok: true, data: data as number };
  } catch (e) {
    return fail(e);
  }
}
