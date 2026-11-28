"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowser } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";

export function MfaForm({ mode, factorId: initialFactor }: { mode: "enroll" | "verify"; factorId?: string }) {
  const router = useRouter();
  const [factorId, setFactorId] = useState(initialFactor);
  const [qr, setQr] = useState<string>();
  const [secret, setSecret] = useState<string>();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (mode !== "enroll") return;
    const supabase = createSupabaseBrowser();
    supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `crm-${Date.now()}` }).then(({ data, error }) => {
      if (error || !data) return setError("登録の準備に失敗しました。再読み込みしてください。");
      setFactorId(data.id);
      setQr(data.totp.qr_code);
      setSecret(data.totp.secret);
    });
  }, [mode]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!factorId) return;
    setPending(true);
    setError(undefined);
    const supabase = createSupabaseBrowser();
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.trim() });
    setPending(false);
    if (error) return setError("確認コードが正しくありません");
    router.replace("/dashboard");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      {mode === "enroll" ? (
        <div className="space-y-2 rounded-md bg-slate-50 p-3 text-xs text-slate-600">
          <p>1. 認証アプリで QR コードを読み取ってください。</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {qr ? <img src={qr} alt="認証アプリ登録用 QR コード" className="mx-auto size-40 bg-white" /> : <div className="mx-auto size-40 animate-pulse bg-slate-200" />}
          {secret ? (
            <p>
              読み取れない場合のキー：<code data-testid="mfa-secret" className="break-all font-mono">{secret}</code>
            </p>
          ) : null}
          <p>2. 表示された 6 桁のコードを入力してください。</p>
        </div>
      ) : null}
      <Field label="確認コード（6桁）" htmlFor="code" error={error}>
        <Input id="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} autoFocus />
      </Field>
      <Button type="submit" className="w-full" disabled={pending || code.length < 6 || !factorId}>
        {pending ? "確認中…" : "確認する"}
      </Button>
    </form>
  );
}
