"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, FolderPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { fmtNum } from "@/lib/format";
import { RESULT_LABEL } from "@/components/status";
import { createList, previewList, type FilterNode, type Preview } from "@/server/domain/call-lists/actions";

type Rule = { field: string; operator: string; value: unknown };
type Group = { op: "and" | "or"; rules: (Rule | Group)[] };
const isGroup = (r: Rule | Group): r is Group => "rules" in r;

/** 指示書 09 の絞り込み条件。住宅ローン・借入・資産などの項目は存在しない（ターゲティング禁止） */
const FIELDS: Record<string, { label: string; ops: { op: string; label: string }[]; input: "date2" | "multi" | "number" | "days" | "none"; options?: [string, string][] }> = {
  first_inquiry_at: { label: "問い合わせ時期", ops: [{ op: "between", label: "期間内" }], input: "date2" },
  area_pref: { label: "居住エリア（都道府県）", ops: [{ op: "in", label: "いずれか" }, { op: "not_in", label: "以外" }], input: "multi", options: ["東京都", "神奈川県", "埼玉県", "千葉県", "大阪府", "愛知県", "福岡県", "兵庫県", "北海道", "静岡県"].map((x) => [x, x]) },
  primary_source: { label: "流入元", ops: [{ op: "in", label: "いずれか" }], input: "multi", options: [["kintone", "kintone（住宅）"], ["lp", "人材LP"], ["manual", "手動登録"]] },
  call_count: { label: "過去の架電回数", ops: [{ op: "eq", label: "＝" }, { op: "gte", label: "以上" }, { op: "lte", label: "以下" }], input: "number" },
  last_called_at: { label: "最終架電日時", ops: [{ op: "older_than_days", label: "N日以上前（未架電含む）" }, { op: "within_days", label: "N日以内" }, { op: "is_null", label: "架電なし" }], input: "days" },
  last_call_result: { label: "過去の架電結果", ops: [{ op: "in", label: "いずれか" }, { op: "not_in", label: "以外" }], input: "multi", options: Object.entries(RESULT_LABEL).filter(([k]) => k !== "not_called") },
  job_change_intent: { label: "本人申告の転職意向", ops: [{ op: "in", label: "いずれか" }], input: "multi", options: [["consult_wanted", "転職相談希望"], ["yes", "意向あり"], ["future", "将来検討"], ["no", "意向なし"]] },
  queue_state: { label: "対応状況", ops: [{ op: "in", label: "いずれか" }], input: "multi", options: [["new", "未対応"], ["recall", "再架電"]] },
  consent_status: { label: "利用許諾状況", ops: [{ op: "in", label: "いずれか" }], input: "multi", options: [["granted", "許諾済"], ["unknown", "未確認"]] },
};

const DEFAULT_RULE = (): Rule => ({ field: "area_pref", operator: "in", value: [] });

function RuleRow({ rule, onChange, onRemove }: { rule: Rule; onChange: (r: Rule) => void; onRemove: () => void }) {
  const f = FIELDS[rule.field];
  const values = Array.isArray(rule.value) ? (rule.value as string[]) : [];
  return (
    <div className="flex flex-wrap items-start gap-2 rounded-md border border-border bg-white p-2">
      <Select className="w-48" value={rule.field} aria-label="項目" onChange={(e) => {
        const nf = FIELDS[e.target.value];
        onChange({ field: e.target.value, operator: nf.ops[0].op, value: nf.input === "multi" ? [] : nf.input === "date2" ? ["", ""] : "" });
      }}>
        {Object.entries(FIELDS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
      </Select>
      <Select className="w-44" value={rule.operator} aria-label="条件" onChange={(e) => onChange({ ...rule, operator: e.target.value })}>
        {f.ops.map((o) => <option key={o.op} value={o.op}>{o.label}</option>)}
      </Select>
      <div className="min-w-48 flex-1">
        {f.input === "multi" ? (
          <div className="flex flex-wrap gap-1">
            {f.options!.map(([v, l]) => {
              const on = values.includes(v);
              return (
                <button key={v} type="button" aria-pressed={on}
                  onClick={() => onChange({ ...rule, value: on ? values.filter((x) => x !== v) : [...values, v] })}
                  className={cn("rounded-full border px-2 py-0.5 text-xs", on ? "border-accent-blue bg-blue-50 text-blue-700" : "border-border text-slate-600 hover:bg-slate-50")}>
                  {l}
                </button>
              );
            })}
          </div>
        ) : f.input === "date2" ? (
          <div className="flex items-center gap-1">
            <Input type="date" aria-label="開始日" value={(rule.value as string[])?.[0] ?? ""} onChange={(e) => onChange({ ...rule, value: [e.target.value, (rule.value as string[])?.[1] ?? ""] })} />
            <span className="text-xs text-slate-400">〜</span>
            <Input type="date" aria-label="終了日" value={(rule.value as string[])?.[1] ?? ""} onChange={(e) => onChange({ ...rule, value: [(rule.value as string[])?.[0] ?? "", e.target.value] })} />
          </div>
        ) : f.input === "number" || (f.input === "days" && rule.operator !== "is_null") ? (
          <div className="flex items-center gap-1">
            <Input type="number" min={0} className="w-28" aria-label="値" value={String(rule.value ?? "")} onChange={(e) => onChange({ ...rule, value: e.target.value })} />
            <span className="text-xs text-slate-500">{f.input === "days" ? "日" : "回"}</span>
          </div>
        ) : null}
      </div>
      <Button type="button" variant="ghost" size="icon" onClick={onRemove} aria-label="条件を削除"><Trash2 /></Button>
    </div>
  );
}

function GroupEditor({ group, onChange, depth = 0, onRemove }: { group: Group; onChange: (g: Group) => void; depth?: number; onRemove?: () => void }) {
  const setRule = (i: number, r: Rule | Group) => onChange({ ...group, rules: group.rules.map((x, j) => (j === i ? r : x)) });
  return (
    <div className={cn("space-y-2 rounded-lg p-2", depth > 0 ? "border border-dashed border-slate-300 bg-slate-50" : "")}>
      <div className="flex items-center gap-2 text-xs">
        <span className="text-slate-500">次の条件の</span>
        <div className="inline-flex rounded-md border border-border bg-white p-0.5" role="radiogroup" aria-label="結合条件">
          {(["and", "or"] as const).map((op) => (
            <button key={op} type="button" role="radio" aria-checked={group.op === op} onClick={() => onChange({ ...group, op })}
              className={cn("rounded px-2 py-0.5", group.op === op ? "bg-primary text-white" : "text-slate-600")}>
              {op === "and" ? "すべて（AND）" : "いずれか（OR）"}
            </button>
          ))}
        </div>
        <span className="text-slate-500">に一致</span>
        {onRemove ? <Button type="button" variant="ghost" size="sm" className="ml-auto" onClick={onRemove}><Trash2 /> グループを削除</Button> : null}
      </div>
      {group.rules.map((r, i) =>
        isGroup(r) ? (
          <GroupEditor key={i} group={r} depth={depth + 1} onChange={(g) => setRule(i, g)} onRemove={() => onChange({ ...group, rules: group.rules.filter((_, j) => j !== i) })} />
        ) : (
          <RuleRow key={i} rule={r} onChange={(nr) => setRule(i, nr)} onRemove={() => onChange({ ...group, rules: group.rules.filter((_, j) => j !== i) })} />
        ),
      )}
      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => onChange({ ...group, rules: [...group.rules, DEFAULT_RULE()] })}><Plus /> 条件を追加</Button>
        {depth === 0 ? (
          <Button type="button" variant="outline" size="sm" onClick={() => onChange({ ...group, rules: [...group.rules, { op: group.op === "and" ? "or" : "and", rules: [DEFAULT_RULE()] }] })}><FolderPlus /> グループを追加</Button>
        ) : null}
      </div>
    </div>
  );
}

/** 空の値の条件は除外して送る */
function clean(g: Group): FilterNode {
  return {
    op: g.op,
    rules: g.rules
      .map((r) => (isGroup(r) ? clean(r) : r))
      .filter((r) => {
        if ("rules" in r) return r.rules.length > 0;
        const v = r.value;
        if (r.operator === "is_null") return true;
        if (Array.isArray(v)) return v.some((x) => x !== "");
        return v !== "" && v !== undefined && v !== null;
      })
      .map((r) => ("rules" in r ? r : { ...r, value: r.operator === "between" ? [(r.value as string[])[0] || "2000-01-01", (r.value as string[])[1] || "2100-12-31"] : r.value })),
  } as FilterNode;
}

export function ListBuilder({ teams }: { teams: { id: string; name: string }[] }) {
  const router = useRouter();
  const [group, setGroup] = useState<Group>({ op: "and", rules: [{ field: "consent_status", operator: "in", value: ["granted"] }, DEFAULT_RULE()] });
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [type, setType] = useState<"static" | "dynamic">("static");
  const [teamId, setTeamId] = useState("");
  const [priority, setPriority] = useState(100);
  const [pending, start] = useTransition();
  const json = JSON.stringify(clean(group));

  // 条件変更から 500ms 後に件数を自動プレビュー
  useEffect(() => {
    const t = setTimeout(async () => {
      setLoading(true);
      const r = await previewList(JSON.parse(json));
      setLoading(false);
      if (r.ok) {
        setPreview(r.data);
        setError(null);
      } else setError(r.error);
    }, 500);
    return () => clearTimeout(t);
  }, [json]);

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_320px]">
      <Card>
        <CardHeader><CardTitle>抽出条件</CardTitle><span className="text-xs text-slate-500">住宅ローン・借入・資産情報は条件に使用できません</span></CardHeader>
        <CardContent><GroupEditor group={group} onChange={setGroup} /></CardContent>
      </Card>
      <div className="space-y-4">
        <Card>
          <CardHeader><CardTitle>抽出件数</CardTitle>{loading ? <Loader2 className="size-4 animate-spin text-slate-400" /> : null}</CardHeader>
          <CardContent>
            {error ? <p role="alert" className="text-sm text-rose-600">{error}</p> : (
              <>
                <p className="text-xs text-slate-500">リストに追加される件数（架電可能・未割当）</p>
                <p className="tabular text-3xl font-semibold text-primary" data-testid="preview-callable">{fmtNum(preview?.callable)}</p>
                <dl className="mt-3 grid grid-cols-[1fr_auto] gap-y-1 text-xs">
                  <dt className="text-slate-500">条件に一致</dt><dd className="tabular text-right">{fmtNum(preview?.matched)}</dd>
                  <dt className="text-slate-500">除外：架電禁止</dt><dd className="tabular text-right text-rose-700">{fmtNum(preview?.excludedSuppressed)}</dd>
                  <dt className="text-slate-500">除外：利用許諾未確認・不許諾</dt><dd className="tabular text-right text-violet-700">{fmtNum(preview?.excludedConsent)}</dd>
                  <dt className="text-slate-500">除外：電話番号なし・不通</dt><dd className="tabular text-right">{fmtNum(preview?.excludedInvalidPhone)}</dd>
                  <dt className="text-slate-500">除外：対応終了・アポ済</dt><dd className="tabular text-right">{fmtNum(preview?.excludedClosed)}</dd>
                  <dt className="text-slate-500">除外：他の担当者が対応中</dt><dd className="tabular text-right">{fmtNum(preview?.excludedAssigned)}</dd>
                </dl>
              </>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>リストを保存</CardTitle></CardHeader>
          <CardContent>
            <form className="space-y-3" onSubmit={(e) => {
              e.preventDefault();
              start(async () => {
                const r = await createList({ name, type, teamId: teamId || null, priority, filter: JSON.parse(json) });
                if (!r.ok) return void toast.error(r.error);
                toast.success("リストを作成しました");
                router.push(`/call-lists/${r.data}`);
              });
            }}>
              <Field label="リスト名" htmlFor="name"><Input id="name" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="例：関東・許諾済・2024年以降" /></Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="種類" htmlFor="type">
                  <Select id="type" value={type} onChange={(e) => setType(e.target.value as "static" | "dynamic")}>
                    <option value="static">固定リスト</option>
                    <option value="dynamic">動的リスト（新規該当者を追加）</option>
                  </Select>
                </Field>
                <Field label="優先度（小さいほど優先）" htmlFor="prio"><Input id="prio" type="number" min={1} max={999} value={priority} onChange={(e) => setPriority(Number(e.target.value))} /></Field>
              </div>
              <Field label="担当チーム" htmlFor="team">
                <Select id="team" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
                  <option value="">指定なし</option>
                  {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </Select>
              </Field>
              <Button type="submit" className="w-full" disabled={pending || !name.trim() || !preview?.callable}>
                {pending ? <Loader2 className="animate-spin" /> : null} {fmtNum(preview?.callable ?? 0)} 件でリストを作成
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
