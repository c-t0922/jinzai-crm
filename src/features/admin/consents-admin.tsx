"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { bulkGrantConsent, countBulkGrant, releaseSuppression } from "@/server/domain/admin/actions";

export function ReleaseButton({ id, label }: { id: string; label: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>解除</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="架電禁止を解除" description={`${label} の架電禁止を解除します。同じ電話番号の顧客も解除されます。理由は監査ログに残ります。`}>
          <form className="space-y-3" onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const r = await releaseSuppression(id, reason);
              if (!r.ok) return void toast.error(r.error);
              toast.success("解除しました");
              setOpen(false);
              router.refresh();
            });
          }}>
            <Field label="解除理由（必須・5文字以上）" htmlFor="rel-reason"><Textarea id="rel-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} required minLength={5} maxLength={300} /></Field>
            <Button type="submit" variant="destructive" className="w-full" disabled={pending || reason.trim().length < 5}>解除する</Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

const PREFS = ["東京都", "神奈川県", "埼玉県", "千葉県"];

export function BulkGrantForm() {
  const router = useRouter();
  const [source, setSource] = useState("lp");
  const [pref, setPref] = useState("");
  const [count, setCount] = useState<number | null>(null);
  const [basis, setBasis] = useState("");
  const [terms, setTerms] = useState("");
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const reset = () => setCount(null);
  return (
    <form className="space-y-3" onSubmit={(e) => {
      e.preventDefault();
      if (count === null) return;
      start(async () => {
        const r = await bulkGrantConsent({ source: source as "lp", pref: pref || undefined, basis, terms, note: note || undefined, confirmCount: count });
        if (!r.ok) return void toast.error(r.error);
        toast.success(`${r.data.toLocaleString("ja-JP")}件を許諾済に更新しました`);
        setCount(null); setBasis(""); setTerms(""); setNote("");
        router.refresh();
      });
    }}>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label="流入経路" htmlFor="bg-src">
          <Select id="bg-src" value={source} onChange={(e) => { setSource(e.target.value); reset(); }}>
            <option value="lp">人材LP</option><option value="kintone">kintone（住宅）</option><option value="manual">手動登録</option>
          </Select>
        </Field>
        <Field label="都道府県（任意）" htmlFor="bg-pref">
          <Select id="bg-pref" value={pref} onChange={(e) => { setPref(e.target.value); reset(); }}>
            <option value="">指定しない</option>{PREFS.map((p) => <option key={p}>{p}</option>)}
          </Select>
        </Field>
      </div>
      <Field label="同意の根拠（取得方法）・必須" htmlFor="bg-basis" hint="例：人材LP申込フォームの利用目的同意チェック（2026年4月版）">
        <Input id="bg-basis" value={basis} onChange={(e) => setBasis(e.target.value)} required minLength={5} maxLength={200} />
      </Field>
      <Field label="規約・同意文の版" htmlFor="bg-terms"><Input id="bg-terms" value={terms} onChange={(e) => setTerms(e.target.value)} required maxLength={60} /></Field>
      <Field label="メモ" htmlFor="bg-note"><Input id="bg-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} /></Field>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" disabled={pending} onClick={() => start(async () => {
          const r = await countBulkGrant(source, pref);
          if (!r.ok) return void toast.error(r.error);
          setCount(r.data);
        })}>対象件数を確認</Button>
        {count !== null ? <span className="text-sm">利用許諾「未確認」の対象：<strong className="tabular">{count.toLocaleString("ja-JP")}</strong>件（架電禁止は除外）</span> : null}
        <Button type="submit" className="ml-auto" disabled={pending || !count || basis.trim().length < 5 || !terms.trim()}>
          {count ? `${count.toLocaleString("ja-JP")}件を許諾済にする` : "許諾済にする"}
        </Button>
      </div>
      <p className="text-xs text-slate-500">同意が確認できた範囲のみ実行してください。kintone（住宅）由来のデータは、人材事業での利用に同意した根拠がある場合に限ります。</p>
    </form>
  );
}
