import * as React from "react";
import { AlertTriangle, Inbox } from "lucide-react";
import { cn } from "@/lib/utils";

export function EmptyState({ title, description, action, className }: { title: string; description?: string; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 px-6 py-12 text-center", className)}>
      <Inbox className="size-8 text-slate-300" aria-hidden />
      <p className="text-sm font-medium text-slate-700">{title}</p>
      {description ? <p className="max-w-sm text-xs text-slate-500">{description}</p> : null}
      {action}
    </div>
  );
}

export function ErrorState({ title = "読み込みに失敗しました", description, action }: { title?: string; description?: string; action?: React.ReactNode }) {
  return (
    <div role="alert" className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <AlertTriangle className="size-8 text-rose-400" aria-hidden />
      <p className="text-sm font-medium text-slate-800">{title}</p>
      {description ? <p className="max-w-sm text-xs text-slate-500">{description}</p> : null}
      {action}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded bg-slate-100", className)} />;
}

export function PageSkeleton() {
  return (
    <div className="space-y-4 p-6" aria-busy="true" aria-label="読み込み中">
      <Skeleton className="h-7 w-48" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-64" />
    </div>
  );
}
