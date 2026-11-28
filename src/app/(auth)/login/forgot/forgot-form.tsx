"use client";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { requestReset, type ForgotState } from "./actions";

export function ForgotForm() {
  const [state, action, pending] = useActionState<ForgotState, FormData>(requestReset, {});
  if (state.sent) return <p className="text-sm text-slate-700">登録されているメールアドレスであれば、再設定用のメールを送りました。メールのリンクから新しいパスワードを設定してください。</p>;
  return (
    <form action={action} className="space-y-3">
      <Field label="メールアドレス" htmlFor="email"><Input id="email" name="email" type="email" autoComplete="username" required autoFocus /></Field>
      {state.error ? <p role="alert" className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700">{state.error}</p> : null}
      <Button type="submit" className="w-full" disabled={pending}>{pending ? "送信中…" : "再設定メールを送る"}</Button>
    </form>
  );
}
