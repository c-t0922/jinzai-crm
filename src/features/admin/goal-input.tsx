"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { setGoal } from "@/server/domain/admin/actions";
import { cn } from "@/lib/utils";

/** フォーカスを外した時点で保存（0 または空欄で目標を削除） */
export function GoalInput({ scope, period, metric, value, userId, teamId, label }: {
  scope: "org" | "team" | "user"; period: string; metric: "calls" | "connects" | "appointments" | "revenue"; value: number | null; userId?: string; teamId?: string; label: string;
}) {
  const router = useRouter();
  const [v, setV] = useState(value === null ? "" : String(value));
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(false);
  return (
    <Input
      inputMode="numeric" aria-label={label} className={cn("tabular h-8 w-24 text-right", saved && "border-emerald-400", pending && "opacity-60")}
      value={v} placeholder="—"
      onChange={(e) => { setSaved(false); setV(e.target.value.replace(/[^\d]/g, "")); }}
      onBlur={() => {
        const n = v === "" ? 0 : Number(v);
        if (n === (value ?? 0)) return;
        start(async () => {
          const r = await setGoal({ scope, period, metric, value: n, userId, teamId });
          if (!r.ok) return void toast.error(r.error);
          setSaved(true);
          router.refresh();
        });
      }}
    />
  );
}
