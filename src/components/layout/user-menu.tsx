"use client";
import { useEffect, useRef } from "react";
import { DropdownMenu } from "radix-ui";
import { Bell, LogOut } from "lucide-react";
import Link from "next/link";
import { signOut } from "@/app/(auth)/login/actions";
import { ROLE_LABEL, type Role } from "@/lib/permissions";

export function UserMenu({ name, roles, unread }: { name: string; roles: Role[]; unread: number }) {
  return (
    <div className="flex items-center gap-1">
      <Link href="/tasks" className="relative rounded-md p-2 text-slate-500 hover:bg-slate-100" aria-label={`通知 ${unread}件`}>
        <Bell className="size-4" />
        {unread > 0 ? <span className="absolute right-1 top-1 grid min-w-4 place-items-center rounded-full bg-rose-600 px-1 text-[10px] font-medium leading-4 text-white">{unread}</span> : null}
      </Link>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger className="flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-slate-100" aria-label="ユーザーメニュー">
          <span className="grid size-7 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{name.slice(0, 1)}</span>
          <span className="hidden text-left sm:block">
            <span className="block text-[13px] font-medium leading-tight">{name}</span>
            <span className="block text-[11px] leading-tight text-slate-500">{roles.map((r) => ROLE_LABEL[r]).join("・")}</span>
          </span>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content align="end" sideOffset={6} className="z-50 min-w-40 rounded-md border border-border bg-white p-1 shadow-md">
            <DropdownMenu.Item
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-slate-100"
              onSelect={() => signOut()}
            >
              <LogOut className="size-4" /> ログアウト
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}

/** 無操作で自動ログアウト（通話中は操作扱い：架電センターが activity イベントを発火） */
export function IdleLogout({ minutes }: { minutes: number }) {
  const last = useRef(0);
  useEffect(() => {
    if (!(minutes > 0)) return; // 0 = 自動ログアウトしない（ログインを保持）
    last.current = Date.now();
    const bump = () => (last.current = Date.now());
    const events = ["mousemove", "keydown", "click", "scroll", "touchstart", "crm:activity"];
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    const t = setInterval(() => {
      if (Date.now() - last.current > minutes * 60_000) signOut("timeout");
    }, 30_000);
    return () => {
      events.forEach((e) => window.removeEventListener(e, bump));
      clearInterval(t);
    };
  }, [minutes]);
  return null;
}
