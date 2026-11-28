"use client";
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowDownUp, Columns3, Download, Tag, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, Input, Select } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { EmptyState } from "@/components/states";
import { ConsentBadge, QueueBadge, ResultBadge, SOURCE_LABEL } from "@/components/status";
import { displayPhone, fmtDate, fmtDateTime, maskPhone } from "@/lib/format";
import { exportContacts, reassignContacts, tagContacts } from "@/server/domain/contacts/actions";

export type ContactRow = {
  id: string; name: string; area_pref: string | null; primary_source: string; consent_status: string; is_suppressed: boolean;
  callable: boolean; queue_state: string; call_count: number; last_called_at: string | null; last_call_result: string | null;
  next_call_at: string | null; first_inquiry_at: string | null; tags: string[]; created_at: string; phone: string | null; assignee: string | null;
};

const COLUMNS = [
  { key: "phone", label: "電話番号" },
  { key: "area", label: "エリア" },
  { key: "source", label: "流入元" },
  { key: "consent", label: "利用許諾" },
  { key: "state", label: "対応状況" },
  { key: "last", label: "最終結果" },
  { key: "calls", label: "架電回数" },
  { key: "lastAt", label: "最終架電" },
  { key: "inquiry", label: "初回問合せ" },
  { key: "assignee", label: "担当" },
] as const;
type ColKey = (typeof COLUMNS)[number]["key"];

const SORTS: Record<string, string> = { created_desc: "登録日（新しい順）", inquiry_desc: "問い合わせ日（新しい順）", last_called_desc: "最終架電（新しい順）", name_asc: "氏名（昇順）" };

export function ContactsTable(props: {
  rows: ContactRow[]; filter: unknown; canBulk: boolean; canExport: boolean; showFullPhone: boolean;
  assignees: { id: string; name: string }[]; sort: string; sortHrefs: Record<string, string>;
}) {
  const { rows, canBulk, canExport, showFullPhone } = props;
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [cols, setCols] = useState<Set<ColKey>>(() => {
    try {
      const v = window.localStorage.getItem("crm:contacts-cols");
      if (v) return new Set(JSON.parse(v));
    } catch {}
    return new Set(COLUMNS.map((c) => c.key));
  });
  const [showCols, setShowCols] = useState(false);
  const [dialog, setDialog] = useState<null | "assign" | "tag" | "export">(null);
  const [pending, start] = useTransition();
  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const has = (k: ColKey) => cols.has(k);
  const ids = useMemo(() => [...selected], [selected]);

  const toggleCol = (k: ColKey) => {
    const n = new Set(cols);
    if (n.has(k)) n.delete(k);
    else n.add(k);
    setCols(n);
    try {
      window.localStorage.setItem("crm:contacts-cols", JSON.stringify([...n]));
    } catch {}
  };

  return (
    <div className="rounded-lg border border-border bg-white">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        {canBulk && selected.size > 0 ? (
          <>
            <span className="text-xs font-medium">{selected.size} 件選択中</span>
            <Button size="sm" variant="outline" onClick={() => setDialog("assign")}><UserCheck /> 担当者変更</Button>
            <Button size="sm" variant="outline" onClick={() => setDialog("tag")}><Tag /> タグ付け</Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>選択解除</Button>
          </>
        ) : (
          <span className="text-xs text-slate-500">行をクリックすると顧客詳細を表示します</span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <label className="flex items-center gap-1 text-xs text-slate-500">
            <ArrowDownUp className="size-3.5" />
            <select className="rounded border border-border bg-white px-1.5 py-1 text-xs" value={props.sort} onChange={(e) => router.push(props.sortHrefs[e.target.value])} aria-label="並び順">
              {Object.entries(SORTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <div className="relative">
            <Button size="sm" variant="outline" onClick={() => setShowCols((v) => !v)} aria-expanded={showCols}><Columns3 /> 表示項目</Button>
            {showCols ? (
              <div className="absolute right-0 z-20 mt-1 w-44 rounded-md border border-border bg-white p-2 shadow-md">
                {COLUMNS.map((c) => (
                  <label key={c.key} className="flex items-center gap-2 py-0.5 text-xs">
                    <input type="checkbox" checked={has(c.key)} onChange={() => toggleCol(c.key)} /> {c.label}
                  </label>
                ))}
              </div>
            ) : null}
          </div>
          {canExport ? <Button size="sm" variant="outline" onClick={() => setDialog("export")}><Download /> CSV出力</Button> : null}
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState title="該当する顧客はいません" description="検索条件を変更してください" />
      ) : (
        <Table>
          <THead>
            <tr>
              {canBulk ? (
                <TH className="w-8">
                  <input type="checkbox" aria-label="すべて選択" checked={allChecked} onChange={() => setSelected(allChecked ? new Set() : new Set(rows.map((r) => r.id)))} />
                </TH>
              ) : null}
              <TH>氏名</TH>
              {COLUMNS.filter((c) => has(c.key)).map((c) => <TH key={c.key}>{c.label}</TH>)}
            </tr>
          </THead>
          <TBody>
            {rows.map((r) => (
              <TR key={r.id} className="cursor-pointer" onClick={() => router.push(`/contacts/${r.id}`)}>
                {canBulk ? (
                  <TD onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      aria-label={`${r.name}を選択`}
                      checked={selected.has(r.id)}
                      onChange={() => {
                        const n = new Set(selected);
                        if (n.has(r.id)) n.delete(r.id);
                        else n.add(r.id);
                        setSelected(n);
                      }}
                    />
                  </TD>
                ) : null}
                <TD>
                  <Link href={`/contacts/${r.id}`} className="font-medium text-slate-900 hover:text-accent-blue" onClick={(e) => e.stopPropagation()}>{r.name}</Link>
                  {r.is_suppressed ? <Badge tone="rose" className="ml-1.5">架電禁止</Badge> : null}
                  {r.tags?.map((t) => <Badge key={t} className="ml-1">{t}</Badge>)}
                </TD>
                {has("phone") ? <TD className="tabular">{showFullPhone ? displayPhone(r.phone) : maskPhone(r.phone)}</TD> : null}
                {has("area") ? <TD>{r.area_pref ?? "—"}</TD> : null}
                {has("source") ? <TD className="text-xs text-slate-600">{SOURCE_LABEL[r.primary_source] ?? r.primary_source}</TD> : null}
                {has("consent") ? <TD><ConsentBadge status={r.consent_status} /></TD> : null}
                {has("state") ? <TD><QueueBadge state={r.queue_state} /></TD> : null}
                {has("last") ? <TD><ResultBadge code={r.last_call_result} /></TD> : null}
                {has("calls") ? <TD className="tabular text-right">{r.call_count}</TD> : null}
                {has("lastAt") ? <TD className="tabular text-xs">{fmtDateTime(r.last_called_at)}</TD> : null}
                {has("inquiry") ? <TD className="tabular text-xs">{fmtDate(r.first_inquiry_at)}</TD> : null}
                {has("assignee") ? <TD className="text-xs">{r.assignee ?? "—"}</TD> : null}
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      <Dialog open={dialog === "assign"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent title="担当者を変更" description={`${selected.size} 件の担当者を変更します（架電可能な顧客のみ対象）`}>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              const uid = String(new FormData(e.currentTarget).get("user"));
              start(async () => {
                const r = await reassignContacts(ids, uid);
                if (r.ok) {
                  toast.success(`${r.data} 件の担当者を変更しました`);
                  setDialog(null);
                  setSelected(new Set());
                  router.refresh();
                } else toast.error(r.error);
              });
            }}
          >
            <Field label="新しい担当者" htmlFor="user">
              <Select id="user" name="user" required>
                {props.assignees.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </Select>
            </Field>
            <Button type="submit" disabled={pending} className="w-full">変更する</Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "tag"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent title="タグを付ける" description={`${selected.size} 件にタグを追加します`}>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              const tag = String(new FormData(e.currentTarget).get("tag"));
              start(async () => {
                const r = await tagContacts(ids, tag);
                if (r.ok) {
                  toast.success("タグを追加しました");
                  setDialog(null);
                  router.refresh();
                } else toast.error(r.error);
              });
            }}
          >
            <Field label="タグ" htmlFor="tag"><Input id="tag" name="tag" required maxLength={30} /></Field>
            <Button type="submit" disabled={pending} className="w-full">追加する</Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "export"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent title="CSV出力" description="現在の絞り込み条件で出力します。出力者・条件・件数は記録されます。">
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              const reason = String(new FormData(e.currentTarget).get("reason"));
              start(async () => {
                const r = await exportContacts(props.filter, reason);
                if (!r.ok) return void toast.error(r.error);
                const url = URL.createObjectURL(new Blob([r.data], { type: "text/csv;charset=utf-8" }));
                const a = document.createElement("a");
                a.href = url;
                a.download = `contacts_${new Date().toISOString().slice(0, 10)}.csv`;
                a.click();
                URL.revokeObjectURL(url);
                toast.success("CSVを出力しました");
                setDialog(null);
              });
            }}
          >
            <Field label="出力理由（必須）" htmlFor="reason"><Input id="reason" name="reason" required minLength={2} placeholder="例：週次の架電結果確認" /></Field>
            <Button type="submit" disabled={pending} className="w-full"><Download /> 出力する</Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
