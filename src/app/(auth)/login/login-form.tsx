"use client";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { signIn, type SignInState } from "./actions";

export function LoginForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState<SignInState, FormData>(signIn, {});
  return (
    <form action={action} className="space-y-3" noValidate>
      <input type="hidden" name="next" value={next ?? ""} />
      <Field label="メールアドレス" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="username" required autoFocus defaultValue={state.email} />
      </Field>
      <Field label="パスワード" htmlFor="password">
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </Field>
      {state.error ? (
        <p role="alert" className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {state.error}
        </p>
      ) : null}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "ログイン中…" : "ログイン"}
      </Button>
    </form>
  );
}
