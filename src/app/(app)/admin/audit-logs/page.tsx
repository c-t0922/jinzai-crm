import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/server/auth/session";
import { createSupabaseServer } from "@/lib/supabase/server";
import { PageBody, PageHeader } from "@/components/layout/page";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/states";
import { fmtDateTime, fmtNum } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "操作ログ" };
const PAGE = 50;
const TABS = { audit: "操作ログ", export: "CSV出力ログ", login: "ログイン履歴" } as const;
type Tab = keyof typeof TABS;
const EVENT: Record<string, string> = { login: "ログイン", logout: "ログアウト", timeout: "自動ログアウト" };

/** 差分のうち変わった項目名だけを出す（個人情報の値はここでは表示しない） */
function changedKeys(diff: unknown): string {
  if (!diff || typeof diff !== "object") return "";
  const d = diff as { old?: Record<string, unknown> | null; new?: Record<string, unknown> | null };
  if (d.old && d.new) {
    const keys = Object.keys(d.new).filter((k) => k !== "updated_at" && JSON.stringify(d.old?.[k]) !== JSON.stringify(d.new?.[k]));
    return keys.length ? `変更：${keys.join(", ")}` : "";
  }
  if (d.new) return "新規作成";
  if (d.old) return "削除";
  return Object.entries(diff as Record<string, unknown>).filter(([k]) => k !== "filter").map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`).join(" / ").slice(0, 160);
}

export default async function AuditLogsPage({ searchParams }: { searchParams: Promise<{ tab?: string; before?: string; action?: string }> }) {
  const me = await requireUser("admin.audit");
  const sp = await searchParams;
  const tab: Tab = sp.tab && sp.tab in TABS ? (sp.tab as Tab) : "audit";
  const before = sp.before && !Number.isNaN(Date.parse(sp.before)) ? sp.before : null;
  const supabase = await createSupabaseServer();
  const one = <T,>(v: unknown) => (Array.isArray(v) ? v[0] : v) as T | null;

  let rows: { id: string; at: string; who: string; cols: React.ReactNode[] }[] = [];
  let heads: string[] = [];
  if (tab === "audit") {
    let q = supabase.from("audit_logs").select("id, occurred_at, action, target_type, target_id, diff, actor_id").order("occurred_at", { ascending: false }).limit(PAGE);
    if (before) q = q.lt("occurred_at", before);
    if (sp.action) q = q.ilike("action", `%${sp.action.replace(/[%_]/g, "")}%`);
    const { data } = await q;
    // audit_logs は追記専用で FK を持たないため、操作者名は別に引く
    const ids = [...new Set((data ?? []).map((r) => r.actor_id).filter(Boolean))] as string[];
    const { data: us } = ids.length ? await supabase.from("users").select("id, name").in("id", ids) : { data: [] };
    const names = new Map((us ?? []).map((u) => [u.id, u.name]));
    heads = ["日時", "操作者", "操作", "対象", "内容"];
    rows = (data ?? []).map((r) => ({
      id: r.id, at: r.occurred_at, who: (r.actor_id && names.get(r.actor_id)) || "システム",
      cols: [<code key="a" className="text-xs">{r.action}</code>, <span key="t" className="text-xs text-slate-500">{r.target_type}{r.target_type === "contact" && r.target_id ? <> <Link href={`/contacts/${r.target_id}`} className="text-accent-blue hover:underline">開く</Link></> : null}</span>, <span key="d" className="text-xs text-slate-600">{changedKeys(r.diff)}</span>],
    }));
  } else if (tab === "export") {
    let q = supabase.from("export_logs").select("id, exported_at, resource, row_count, reason, filter, actor:users!export_logs_actor_id_fkey(name)").order("exported_at", { ascending: false }).limit(PAGE);
    if (before) q = q.lt("exported_at", before);
    const { data } = await q;
    heads = ["日時", "出力者", "対象", "件数", "理由"];
    rows = (data ?? []).map((r) => ({ id: r.id, at: r.exported_at, who: one<{ name: string }>(r.actor)?.name ?? "—", cols: [r.resource, <span key="n" className="tabular">{fmtNum(r.row_count)}</span>, <span key="r" className="text-xs">{r.reason}</span>] }));
  } else {
    let q = supabase.from("login_history").select("id, occurred_at, event, ip, user_agent, u:users!login_history_user_id_fkey(name)").order("occurred_at", { ascending: false }).limit(PAGE);
    if (before) q = q.lt("occurred_at", before);
    const { data } = await q;
    heads = ["日時", "ユーザー", "種別", "IP", "ブラウザ"];
    rows = (data ?? []).map((r) => ({ id: r.id, at: r.occurred_at, who: one<{ name: string }>(r.u)?.name ?? "—", cols: [EVENT[r.event] ?? r.event, <span key="i" className="text-xs">{r.ip ?? "—"}</span>, <span key="u" className="block max-w-72 truncate text-xs text-slate-500">{r.user_agent ?? "—"}</span>] }));
  }
  const last = rows.at(-1)?.at;
  const base = (extra: Record<string, string>) => `/admin/audit-logs?${new URLSearchParams({ tab, ...(sp.action && tab === "audit" ? { action: sp.action } : {}), ...extra })}`;

  return (
    <>
      <PageHeader title="操作ログ" description={`設定変更・架電禁止・一括処理・CSV出力・ログインの記録（追記のみで削除・改ざんできません）${me.roles.includes("admin") ? "" : "。ログイン履歴は自分の分のみ表示されます"}`} />
      <PageBody className="space-y-3">
        <nav className="flex gap-1 border-b border-border" aria-label="ログの種類">
          {(Object.keys(TABS) as Tab[]).map((t) => (
            <Link key={t} href={`/admin/audit-logs?tab=${t}`} aria-current={t === tab ? "page" : undefined}
              className={cn("-mb-px border-b-2 px-3 py-2 text-sm", t === tab ? "border-accent-blue font-medium text-primary" : "border-transparent text-slate-500 hover:text-slate-800")}>{TABS[t]}</Link>
          ))}
        </nav>
        {tab === "audit" ? (
          <form className="flex gap-2" action="/admin/audit-logs">
            <input type="hidden" name="tab" value="audit" />
            <Input name="action" defaultValue={sp.action ?? ""} placeholder="操作名で絞り込み（例：suppression, update:call_rules）" className="w-96" aria-label="操作名で絞り込み" />
            <Button type="submit" variant="outline">絞り込み</Button>
          </form>
        ) : null}
        {!rows.length ? <EmptyState title="記録はありません" /> : (
          <div className="overflow-x-auto rounded-lg border border-border bg-white">
            <Table>
              <THead><TR>{heads.map((h) => <TH key={h}>{h}</TH>)}</TR></THead>
              <TBody>
                {rows.map((r) => (
                  <TR key={r.id}>
                    <TD className="tabular whitespace-nowrap text-xs">{fmtDateTime(r.at, { withYear: true })}</TD>
                    <TD className="whitespace-nowrap">{r.who}</TD>
                    {r.cols.map((c, i) => <TD key={i}>{c}</TD>)}
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        )}
        <div className="flex justify-between text-sm">
          {before ? <Link href={base({})} className="text-accent-blue hover:underline">最新に戻る</Link> : <span />}
          {rows.length === PAGE && last ? <Link href={base({ before: last })} className="text-accent-blue hover:underline">さらに古い記録</Link> : null}
        </div>
      </PageBody>
    </>
  );
}
