"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Ban, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { addSuppression, recordConsent } from "@/server/domain/contacts/actions";

export function ContactActions({ contactId, canConsent, suppressed }: { contactId: string; canConsent: boolean; suppressed: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState<null | "supp" | "consent">(null);
  const [pending, start] = useTransition();
  return (
    <>
      {canConsent ? (
        <Button variant="outline" onClick={() => setOpen("consent")}><ShieldCheck /> 利用許諾を記録</Button>
      ) : null}
      {!suppressed ? (
        <Button variant="outline" className="text-rose-700" onClick={() => setOpen("supp")}><Ban /> 架電禁止に登録</Button>
      ) : null}

      <Dialog open={open === "supp"} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent title="架電禁止に登録" description="同じ電話番号を持つ全ての顧客が架電対象外になります。解除はシステム管理者のみ可能です。">
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              start(async () => {
                const r = await addSuppression(contactId, String(f.get("reason")), String(f.get("note") ?? ""));
                if (!r.ok) return void toast.error(r.error);
                toast.success("架電禁止に登録しました");
                setOpen(null);
                router.refresh();
              });
            }}
          >
            <Field label="理由" htmlFor="reason">
              <Select id="reason" name="reason">
                <option value="request">本人からの依頼</option>
                <option value="refusal">架電拒否</option>
                <option value="complaint">クレーム</option>
                <option value="legal">法的要請</option>
                <option value="other">その他</option>
              </Select>
            </Field>
            <Field label="メモ" htmlFor="note"><Textarea id="note" name="note" rows={2} /></Field>
            <Button type="submit" variant="destructive" className="w-full" disabled={pending}>登録する</Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={open === "consent"} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent title="利用許諾を記録" description="人材事業での利用可否を記録します。許諾済にするには根拠の入力が必須です。履歴は削除されません。">
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              start(async () => {
                const r = await recordConsent(contactId, String(f.get("status")), String(f.get("basis") ?? ""), String(f.get("terms") ?? ""), String(f.get("note") ?? ""));
                if (!r.ok) return void toast.error(r.error);
                toast.success("利用許諾を記録しました");
                setOpen(null);
                router.refresh();
              });
            }}
          >
            <Field label="状態" htmlFor="status">
              <Select id="status" name="status">
                <option value="granted">許諾済</option>
                <option value="denied">不許諾</option>
                <option value="withdrawn">撤回</option>
                <option value="unknown">未確認に戻す</option>
              </Select>
            </Field>
            <Field label="根拠（取得方法）" htmlFor="basis"><Input id="basis" name="basis" placeholder="例：LP申込時のチェックボックス同意" /></Field>
            <Field label="規約・同意文の版" htmlFor="terms"><Input id="terms" name="terms" placeholder="例：v2024-01" /></Field>
            <Field label="メモ" htmlFor="cnote"><Textarea id="cnote" name="note" rows={2} /></Field>
            <Button type="submit" className="w-full" disabled={pending}>記録する</Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
