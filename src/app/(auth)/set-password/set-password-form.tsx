"use client";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { setPassword, type SetPasswordState } from "./actions";

export function SetPasswordForm() {
  const [state, action, pending] = useActionState<SetPasswordState, FormData>(setPassword, {});
  return (
    <form action={action} className="space-y-3">
      <Field label="新しいパスワード（10文字以上）" htmlFor="password">
        <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={10} maxLength={72} autoFocus />
      </Field>
      <Field label="確認のためもう一度" htmlFor="confirm">
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required minLength={10} maxLength={72} />
      </Field>
      {state.error ? <p role="alert" className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700">{state.error}</p> : null}
      <Button type="submit" className="w-full" disabled={pending}>{pending ? "設定中…" : "設定してログイン"}</Button>
    </form>
  );
}
