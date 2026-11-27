import Link from "next/link";
import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

/** KPI タイル：主値・補足・前期間比・目標進捗。未計測は「未計測」と表示し 0 にしない。 */
export function StatTile({ label, value, sub, prev, current, goal, href, testId }: {
  label: string; value: string; sub?: string; prev?: number | null; current?: number | null; goal?: number | null; href?: string; testId?: string;
}) {
  const unmeasured = value === "未計測";
  let delta: React.ReactNode = null;
  if (prev !== undefined && current !== undefined && current !== null) {
    if (!prev) delta = <span className="text-slate-400">前期間 実績なし</span>;
    else {
      const r = (current - prev) / prev;
      const Icon = r > 0.005 ? ArrowUpRight : r < -0.005 ? ArrowDownRight : ArrowRight;
      delta = (
        <span className={cn("inline-flex items-center gap-0.5", r > 0.005 ? "text-emerald-700" : r < -0.005 ? "text-rose-700" : "text-slate-500")}>
          <Icon className="size-3.5" aria-hidden />前期間比 {r > 0 ? "+" : ""}{(r * 100).toFixed(1)}%
        </span>
      );
    }
  }
  const progress = goal && current !== undefined && current !== null ? Math.min(current / goal, 1) : null;
  const body = (
    <>
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className={cn("tabular mt-1 text-2xl font-semibold tracking-tight", unmeasured && "text-base font-medium text-slate-400")}>{value}</p>
      {sub ? <p className="tabular mt-0.5 text-xs text-slate-500">{sub}</p> : null}
      {delta ? <p className="tabular mt-1.5 text-xs">{delta}</p> : null}
      {progress !== null && goal ? (
        <div className="mt-2">
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={`${label} 目標進捗`}>
            <div className="h-full rounded-full bg-accent-blue" style={{ width: `${progress * 100}%` }} />
          </div>
          <p className="tabular mt-1 text-[11px] text-slate-500">月間目標 {goal.toLocaleString("ja-JP")}（{(progress * 100).toFixed(0)}%）</p>
        </div>
      ) : null}
    </>
  );
  const cls = "block rounded-lg border border-border bg-white p-4";
  return href ? (
    <Link href={href} data-testid={testId} className={cn(cls, "transition-colors hover:border-accent-blue/50 hover:bg-blue-50/30 focus-visible:outline-2 focus-visible:outline-accent-blue")}>{body}</Link>
  ) : (
    <div data-testid={testId} className={cls}>{body}</div>
  );
}
