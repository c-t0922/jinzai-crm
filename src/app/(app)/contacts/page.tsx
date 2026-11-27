import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/server/auth/session";
import { createSupabaseServer } from "@/lib/supabase/server";
import { PageBody, PageHeader } from "@/components/layout/page";
import { ErrorState } from "@/components/states";
import { can } from "@/lib/permissions";
import { ContactsTable, type ContactRow } from "@/features/contacts/contacts-table";
import { ContactsFilters } from "@/features/contacts/contacts-filters";
import { filterFromParams, type SP } from "@/lib/contact-filter";

export const metadata: Metadata = { title: "顧客一覧" };

export default async function ContactsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const me = await requireUser("contacts.view");
  const sp = await searchParams;
  const supabase = await createSupabaseServer();
  const filter = filterFromParams(sp);
  const [res, saved, users] = await Promise.all([
    supabase.rpc("contacts_search", {
      p: { q: sp.q, phone: sp.phone, email: sp.email, filter, sort: sp.sort ?? "created_desc", cursor: sp.cursor, limit: 50 },
    }),
    supabase.from("saved_searches").select("id,name,params").order("created_at"),
    can(me.roles, "contacts.bulk") ? supabase.from("user_roles").select("user_id, users!inner(id,name)").in("role", ["caller", "team_leader"]) : Promise.resolve({ data: [] }),
  ]);
  const rows = (res.data?.rows ?? []) as ContactRow[];
  const last = rows.at(-1);
  const sortKey = sp.sort ?? "created_desc";
  const cursorKey = last
    ? { created_desc: last.created_at, inquiry_desc: last.first_inquiry_at, last_called_desc: last.last_called_at, name_asc: last.name }[sortKey] ?? last.created_at
    : null;
  const nextCursor = res.data?.hasMore && last ? Buffer.from(JSON.stringify({ k: cursorKey, id: last.id })).toString("base64") : null;
  const qs = (patch: SP) => {
    const p = new URLSearchParams(Object.entries({ ...sp, ...patch }).filter(([, v]) => v) as [string, string][]);
    return `/contacts?${p.toString()}`;
  };
  const assignees = ((users.data ?? []) as { users: { id: string; name: string } | { id: string; name: string }[] }[])
    .map((r) => (Array.isArray(r.users) ? r.users[0] : r.users))
    .filter((u, i, a) => u && a.findIndex((x) => x.id === u.id) === i);

  return (
    <>
      <PageHeader title="顧客一覧" description="検索・絞り込みはサーバー側で行います（最大 50 件ずつ表示）" />
      <PageBody className="space-y-3">
        <ContactsFilters params={sp} saved={(saved.data ?? []) as { id: string; name: string; params: Record<string, string> }[]} />
        {res.error ? (
          <ErrorState description="検索条件を見直して、もう一度お試しください。" />
        ) : (
          <ContactsTable
            rows={rows}
            filter={filter}
            canBulk={can(me.roles, "contacts.bulk")}
            canExport={can(me.roles, "contacts.export")}
            showFullPhone={can(me.roles, "contacts.viewAllPhones")}
            assignees={assignees}
            sort={sortKey}
            sortHrefs={Object.fromEntries(["created_desc", "inquiry_desc", "last_called_desc", "name_asc"].map((k) => [k, qs({ sort: k, cursor: undefined })]))}
          />
        )}
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>{rows.length ? `${rows.length} 件を表示` : ""}</span>
          <div className="flex gap-2">
            {sp.cursor ? <Link className="rounded border border-border bg-white px-3 py-1.5 hover:bg-slate-50" href={qs({ cursor: undefined })}>最初へ</Link> : null}
            {nextCursor ? <Link className="rounded border border-border bg-white px-3 py-1.5 hover:bg-slate-50" href={qs({ cursor: nextCursor })}>次の 50 件</Link> : null}
          </div>
        </div>
      </PageBody>
    </>
  );
}
