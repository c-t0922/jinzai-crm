"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { updateResultMaster, updateRule } from "@/server/domain/admin/actions";
import type { EditableRule } from "@/lib/admin-rules";

const PRIORITY_LABEL: Record<string, string> = {
  recall_today: "本日の再架電予定", lp_new: "人材LPの新規反響", consult_wanted: "転職相談希望あり", untouched: "未架電", recall_absent: "不在の再架電",
};
const DOW = ["日", "月", "火", "水", "木", "金", "土"];

function useSave() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const save = (key: EditableRule, value: unknown) => start(async () => {
    const r = await updateRule(key, value);
    if (!r.ok) return void toast.error(r.error);
    toast.success("保存しました");
    router.refresh();
  });
  return { pending, save };
}

function Row({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-2 border-b border-border px-4 py-3 last:border-0 md:grid-cols-[260px_1fr]">
      <div><p className="text-sm font-medium">{title}</p>{desc ? <p className="text-xs text-slate-500">{desc}</p> : null}</div>
      <div>{children}</div>
    </div>
  );
}

export function RulesForm({ rules, editable }: { rules: Record<string, unknown>; editable: boolean }) {
  const { pending, save } = useSave();
  const ch = rules.calling_hours as { start: string; end: string; days: number[]; enforce: boolean };
  const [hours, setHours] = useState(ch);
  const [prio, setPrio] = useState(rules.assignment_priority as string[]);
  const nums = ["max_no_answer_attempts", "lock_ttl_minutes", "export_max_rows", "auto_logout_minutes"] as const;
  const [vals, setVals] = useState<Record<string, string>>(Object.fromEntries(nums.map((k) => [k, String(rules[k] ?? "")])));
  const NUM_META: Record<(typeof nums)[number], [string, string, string]> = {
    max_no_answer_attempts: ["不通の最大再架電回数", "到達すると自動でクローズ", "回"],
    lock_ttl_minutes: ["架電ロックの有効時間", "他の担当者が同じ顧客を開けない時間", "分"],
    export_max_rows: ["CSV出力の上限件数", "1回あたり", "件"],
    auto_logout_minutes: ["自動ログアウト", "無操作がこの時間続くとログアウト", "分"],
  };
  const dis = !editable || pending;
  return (
    <div className="rounded-lg border border-border bg-white">
      <Row title="架電可能時間帯" desc="時間外はサーバー側で発信をブロックします（仮仕様：月〜土 10〜20時）">
        <div className="flex flex-wrap items-center gap-2">
          <Input type="time" aria-label="開始時刻" className="w-28" value={hours.start} disabled={!editable} onChange={(e) => setHours({ ...hours, start: e.target.value })} />
          <span>〜</span>
          <Input type="time" aria-label="終了時刻" className="w-28" value={hours.end} disabled={!editable} onChange={(e) => setHours({ ...hours, end: e.target.value })} />
          <span className="ml-2 flex gap-1" role="group" aria-label="曜日">
            {DOW.map((d, i) => (
              <label key={d} className="flex items-center gap-0.5 text-sm">
                <input type="checkbox" className="size-4" disabled={!editable} checked={hours.days.includes(i)} onChange={(e) => setHours({ ...hours, days: e.target.checked ? [...hours.days, i].sort() : hours.days.filter((x) => x !== i) })} />{d}
              </label>
            ))}
          </span>
          <label className="ml-2 flex items-center gap-1 text-sm"><input type="checkbox" className="size-4" disabled={!editable} checked={hours.enforce} onChange={(e) => setHours({ ...hours, enforce: e.target.checked })} />時間外の発信をブロック</label>
          {editable ? <Button size="sm" variant="outline" disabled={dis} onClick={() => save("calling_hours", hours)}>保存</Button> : null}
        </div>
        {!hours.enforce ? <p className="mt-1 text-xs text-amber-700">現在、時間外の発信ブロックが無効です（開発環境用）。本番では必ず有効にしてください。</p> : null}
      </Row>
      <Row title="架電の優先順位" desc="架電センターのキュー・自動割り当ての順番">
        <ol className="space-y-1">
          {prio.map((k, i) => (
            <li key={k} className="flex items-center gap-2 text-sm">
              <span className="tabular w-5 text-right text-slate-400">{i + 1}.</span>
              <span className="w-44">{PRIORITY_LABEL[k] ?? k}</span>
              {editable ? (
                <>
                  <Button size="icon" variant="ghost" aria-label={`${PRIORITY_LABEL[k]}を上へ`} disabled={i === 0} onClick={() => { const p = [...prio]; [p[i - 1], p[i]] = [p[i], p[i - 1]]; setPrio(p); }}><ArrowUp /></Button>
                  <Button size="icon" variant="ghost" aria-label={`${PRIORITY_LABEL[k]}を下へ`} disabled={i === prio.length - 1} onClick={() => { const p = [...prio]; [p[i + 1], p[i]] = [p[i], p[i + 1]]; setPrio(p); }}><ArrowDown /></Button>
                </>
              ) : null}
            </li>
          ))}
        </ol>
        {editable ? <Button size="sm" variant="outline" className="mt-2" disabled={dis} onClick={() => save("assignment_priority", prio)}>保存</Button> : null}
      </Row>
      {nums.map((k) => (
        <Row key={k} title={NUM_META[k][0]} desc={NUM_META[k][1]}>
          <div className="flex items-center gap-2">
            <Input inputMode="numeric" aria-label={NUM_META[k][0]} className="tabular w-28 text-right" value={vals[k]} disabled={!editable} onChange={(e) => setVals({ ...vals, [k]: e.target.value.replace(/[^\d]/g, "") })} />
            <span className="text-sm text-slate-500">{NUM_META[k][2]}</span>
            {editable ? <Button size="sm" variant="outline" disabled={dis || vals[k] === String(rules[k])} onClick={() => save(k, Number(vals[k]))}>保存</Button> : null}
          </div>
        </Row>
      ))}
      <Row title="通話録音" desc="告知・同意の運用が確定するまで無効（設定変更は運用確定後にシステム管理者が実施）">
        <Badge tone={rules.recording_enabled ? "amber" : "slate"}>{rules.recording_enabled ? "有効" : "無効"}</Badge>
      </Row>
      <Row title="管理者・PM の多要素認証" desc="セキュリティ設定のため画面からは変更できません">
        <Badge tone={rules.mfa_required ? "emerald" : "amber"}>{rules.mfa_required ? "必須" : "ローカル開発のため無効"}</Badge>
      </Row>
    </div>
  );
}

type Master = { code: string; label: string; category: string; is_connected: boolean; shortcut_key: string | null; sort_order: number; active: boolean; required_fields: string[]; auto_action: { type?: string } };
const ACTION_LABEL: Record<string, string> = { recall: "再架電を予約", appointment: "アポ登録・引き継ぎ", suppress: "架電禁止に登録", close: "クローズ", invalid_phone: "電話番号を無効化", consent_review: "許諾の再確認", keep: "継続" };

export function MastersTable({ masters, editable }: { masters: Master[]; editable: boolean }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-white">
      <Table>
        <THead><TR><TH>表示名</TH><TH>コード</TH><TH>接続扱い</TH><TH>自動処理</TH><TH>必須項目</TH><TH>キー</TH><TH>順序</TH><TH>使用</TH>{editable ? <TH><span className="sr-only">保存</span></TH> : null}</TR></THead>
        <TBody>{masters.map((m) => <MasterRow key={m.code} m={m} editable={editable} />)}</TBody>
      </Table>
    </div>
  );
}

function MasterRow({ m, editable }: { m: Master; editable: boolean }) {
  const router = useRouter();
  const [label, setLabel] = useState(m.label);
  const [key, setKey] = useState(m.shortcut_key ?? "");
  const [order, setOrder] = useState(String(m.sort_order));
  const [active, setActive] = useState(m.active);
  const [pending, start] = useTransition();
  const dirty = label !== m.label || key !== (m.shortcut_key ?? "") || order !== String(m.sort_order) || active !== m.active;
  return (
    <TR>
      <TD><Input aria-label={`${m.code} 表示名`} className="h-8 w-40" value={label} disabled={!editable} onChange={(e) => setLabel(e.target.value)} maxLength={30} /></TD>
      <TD className="font-mono text-xs text-slate-500">{m.code}</TD>
      <TD>{m.is_connected ? "接続" : "—"}</TD>
      <TD className="text-xs">{ACTION_LABEL[m.auto_action?.type ?? ""] ?? "—"}</TD>
      <TD className="text-xs">{m.required_fields.join(", ") || "—"}</TD>
      <TD><Input aria-label={`${m.code} ショートカット`} className="h-8 w-12 text-center" value={key} disabled={!editable} maxLength={1} onChange={(e) => setKey(e.target.value.toLowerCase())} /></TD>
      <TD><Input aria-label={`${m.code} 順序`} inputMode="numeric" className="tabular h-8 w-16 text-right" value={order} disabled={!editable} onChange={(e) => setOrder(e.target.value.replace(/[^\d]/g, ""))} /></TD>
      <TD><input type="checkbox" className="size-4" aria-label={`${m.code} 使用`} checked={active} disabled={!editable} onChange={(e) => setActive(e.target.checked)} /></TD>
      {editable ? (
        <TD>
          <Button size="sm" variant="outline" disabled={!dirty || pending} onClick={() => start(async () => {
            const r = await updateResultMaster({ code: m.code, label, active, shortcutKey: key || null, sortOrder: Number(order) });
            if (!r.ok) return void toast.error(r.error);
            toast.success("保存しました");
            router.refresh();
          })}>保存</Button>
        </TD>
      ) : null}
    </TR>
  );
}
