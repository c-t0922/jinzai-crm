"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { saveTeam } from "@/server/domain/admin/actions";

export function TeamForm({ team }: { team?: { id: string; name: string; base_location: string | null } }) {
  const router = useRouter();
  const [name, setName] = useState(team?.name ?? "");
  const [base, setBase] = useState(team?.base_location ?? "");
  const [pending, start] = useTransition();
  const dirty = !team || name !== team.name || base !== (team.base_location ?? "");
  return (
    <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => {
      e.preventDefault();
      start(async () => {
        const r = await saveTeam({ id: team?.id, name, baseLocation: base });
        if (!r.ok) return void toast.error(r.error);
        toast.success(team ? "保存しました" : "チームを追加しました");
        if (!team) { setName(""); setBase(""); }
        router.refresh();
      });
    }}>
      <Input aria-label="チーム名" placeholder="チーム名" className="w-48" value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} />
      <Input aria-label="拠点" placeholder="拠点（任意）" className="w-40" value={base} onChange={(e) => setBase(e.target.value)} maxLength={60} />
      <Button type="submit" size="sm" variant={team ? "outline" : "default"} disabled={pending || !dirty || !name.trim()}>{team ? "保存" : <><Plus /> 追加</>}</Button>
    </form>
  );
}
