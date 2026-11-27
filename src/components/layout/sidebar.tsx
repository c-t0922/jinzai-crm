"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  LayoutDashboard, PhoneCall, Users, ListChecks, CalendarCheck, CalendarDays, CheckSquare, UserRound, MessagesSquare, Briefcase, Building2, KanbanSquare, JapaneseYen, LineChart, Trophy, ListOrdered, Clock, Route, UserCog, UsersRound, Target, Database, Globe, Headphones, FileText, SlidersHorizontal, ShieldCheck, ScrollText, Circle,
} from "lucide-react";
import { ChevronsLeft, ChevronsRight, Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { can, type Role } from "@/lib/permissions";
import { NAV } from "./nav";

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  LayoutDashboard, PhoneCall, Users, ListChecks, CalendarCheck, CalendarDays, CheckSquare, UserRound, MessagesSquare, Briefcase, Building2, KanbanSquare, JapaneseYen, LineChart, Trophy, ListOrdered, Clock, Route, UserCog, UsersRound, Target, Database, Globe, Headphones, FileText, SlidersHorizontal, ShieldCheck, ScrollText, Circle,
};

function Icon({ name, className }: { name: string; className?: string }) {
  const C = ICONS[name] ?? Circle;
  return <C className={className} aria-hidden />;
}

function NavList({ roles, collapsed, onNavigate }: { roles: Role[]; collapsed: boolean; onNavigate?: () => void }) {
  const path = usePathname();
  return (
    <nav aria-label="メインメニュー" className="flex-1 overflow-y-auto px-2 py-3">
      {NAV.map((g) => {
        const items = g.items.filter((i) => can(roles, i.perm));
        if (!items.length) return null;
        return (
          <div key={g.label} className="mb-4">
            {!collapsed ? <p className="mb-1 px-2 text-[11px] font-medium tracking-wide text-slate-400">{g.label}</p> : <div className="mx-2 mb-1 border-t border-white/10" />}
            <ul className="space-y-0.5">
              {items.map((i) => {
                const active = path === i.href || path.startsWith(i.href + "/");
                return (
                  <li key={i.href}>
                    <Link
                      href={i.href}
                      onClick={onNavigate}
                      title={collapsed ? i.label : undefined}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] text-slate-300 transition-colors hover:bg-white/10 hover:text-white",
                        active && "bg-white/15 font-medium text-white",
                        collapsed && "justify-center px-0",
                      )}
                    >
                      <Icon name={i.icon} className="size-4 shrink-0" />
                      {!collapsed ? (
                        <>
                          <span className="truncate">{i.label}</span>
                          {i.phase && i.phase > 1 ? <span className="ml-auto rounded bg-white/10 px-1 text-[10px] text-slate-400">準備中</span> : null}
                        </>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

export function Sidebar({ roles }: { roles: Role[] }) {
  const path = usePathname();
  const [collapsed, setCollapsed] = useState(path.startsWith("/call-center"));
  const [open, setOpen] = useState(false);
  return (
    <>
      <aside
        className={cn(
          "hidden shrink-0 flex-col bg-[#0f1f4b] text-white transition-[width] md:flex",
          collapsed ? "w-14" : "w-56",
        )}
      >
        <div className={cn("flex h-12 items-center gap-2 border-b border-white/10 px-3", collapsed && "justify-center px-0")}>
          <div className="grid size-7 shrink-0 place-items-center rounded bg-white text-xs font-bold text-primary">人</div>
          {!collapsed ? <span className="text-sm font-semibold">人材CRM</span> : null}
        </div>
        <NavList roles={roles} collapsed={collapsed} />
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="flex h-10 items-center justify-center border-t border-white/10 text-slate-400 hover:text-white"
          aria-label={collapsed ? "メニューを広げる" : "メニューを折りたたむ"}
        >
          {collapsed ? <ChevronsRight className="size-4" /> : <ChevronsLeft className="size-4" />}
        </button>
      </aside>

      {/* スマートフォン */}
      <button type="button" className="fixed left-3 top-2.5 z-30 rounded-md p-1.5 text-slate-700 md:hidden" aria-label="メニューを開く" onClick={() => setOpen(true)}>
        <Menu className="size-5" />
      </button>
      {open ? (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col bg-[#0f1f4b] text-white">
            <div className="flex h-12 items-center justify-between border-b border-white/10 px-3">
              <span className="text-sm font-semibold">人材CRM</span>
              <button type="button" aria-label="メニューを閉じる" onClick={() => setOpen(false)}>
                <X className="size-5" />
              </button>
            </div>
            <NavList roles={roles} collapsed={false} onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      ) : null}
    </>
  );
}
