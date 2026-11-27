"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Loader2 } from "lucide-react";
import { Input, Select } from "@/components/ui/input";

type Opt = { id: string; name: string };
const PRESETS: [string, string][] = [["today", "本日"], ["yesterday", "昨日"], ["7d", "直近7日"], ["30d", "直近30日"], ["month", "今月"], ["lastMonth", "先月"], ["custom", "期間指定"]];
const SOURCES: [string, string][] = [["kintone", "kintone（住宅）"], ["lp", "人材LP"], ["manual", "手動登録"]];

/** 期間・担当者・チーム・リスト・流入経路の絞り込み（URL に保持し、共有・再読込で同じ条件を再現） */
export function KpiFilters({ preset, from, to, users, teams, lists, show }: {
  preset: string; from: string; to: string; users: Opt[]; teams: Opt[]; lists: Opt[];
  show: { user: boolean; team: boolean };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const set = (patch: Record<string, string | null>) => {
    const q = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) (v ? q.set(k, v) : q.delete(k));
    start(() => router.replace(`${pathname}?${q.toString()}`, { scroll: false }));
  };
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="集計条件">
      <Select aria-label="期間" className="w-32" value={preset} onChange={(e) => set(e.target.value === "custom" ? { period: "custom", from, to } : { period: e.target.value, from: null, to: null })}>
        {PRESETS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </Select>
      {preset === "custom" ? (
        <>
          <Input type="date" aria-label="開始日" className="w-40" defaultValue={from} max={to} onBlur={(e) => e.target.value && e.target.value !== from && set({ from: e.target.value })} />
          <span className="text-slate-400">〜</span>
          <Input type="date" aria-label="終了日" className="w-40" defaultValue={to} min={from} onBlur={(e) => e.target.value && e.target.value !== to && set({ to: e.target.value })} />
        </>
      ) : null}
      {show.team && teams.length ? (
        <Select aria-label="チーム" className="w-36" value={sp.get("team") ?? ""} onChange={(e) => set({ team: e.target.value || null, user: null })}>
          <option value="">全チーム</option>
          {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </Select>
      ) : null}
      {show.user && users.length ? (
        <Select aria-label="担当者" className="w-36" value={sp.get("user") ?? ""} onChange={(e) => set({ user: e.target.value || null })}>
          <option value="">全担当者</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </Select>
      ) : null}
      <Select aria-label="架電リスト" className="w-40" value={sp.get("list") ?? ""} onChange={(e) => set({ list: e.target.value || null })}>
        <option value="">全リスト</option>
        {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
      </Select>
      <Select aria-label="流入経路" className="w-36" value={sp.get("source") ?? ""} onChange={(e) => set({ source: e.target.value || null })}>
        <option value="">全流入経路</option>
        {SOURCES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </Select>
      {pending ? <Loader2 className="size-4 animate-spin text-slate-400" aria-label="更新中" /> : null}
    </div>
  );
}
