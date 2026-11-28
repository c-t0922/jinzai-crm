"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { ROLE_LABEL, ROLES, type Role } from "@/lib/permissions";
import { createUser, issuePasswordLink, updateUser } from "@/server/domain/admin/actions";
import { fmtDateTime } from "@/lib/format";

export type AdminUser = { id: string; name: string; email: string; status: string; last_login_at: string | null; roles: Role[]; teams: { id: string; isLeader: boolean }[] };
type Team = { id: string; name: string };

export function UsersAdmin({ users, teams, meId }: { users: AdminUser[]; teams: Team[]; meId: string }) {
  const [edit, setEdit] = useState<AdminUser | null>(null);
  const [creating, setCreating] = useState(false);
  const [q, setQ] = useState("");
  const teamName = (id: string) => teams.find((t) => t.id === id)?.name ?? "";
  const shown = users.filter((u) => !q || u.name.includes(q) || u.email.includes(q));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Input className="w-64" placeholder="氏名・メールで絞り込み" aria-label="絞り込み" value={q} onChange={(e) => setQ(e.target.value)} />
        <Button onClick={() => setCreating(true)}><UserPlus /> ユーザーを招待</Button>
      </div>
      <div className="overflow-x-auto rounded-lg border border-border bg-white">
        <Table>
          <THead><TR><TH>氏名</TH><TH>メール</TH><TH>ロール</TH><TH>チーム</TH><TH>状態</TH><TH>最終ログイン</TH><TH className="w-12"><span className="sr-only">操作</span></TH></TR></THead>
          <TBody>
            {shown.map((u) => (
              <TR key={u.id} className={u.status === "suspended" ? "text-slate-400" : undefined}>
                <TD className="font-medium">{u.name}{u.id === meId ? <span className="ml-1 text-xs text-slate-400">（自分）</span> : null}</TD>
                <TD className="text-xs">{u.email}</TD>
                <TD><div className="flex flex-wrap gap-1">{u.roles.map((r) => <Badge key={r} tone={r === "admin" ? "rose" : r === "pm" ? "violet" : "slate"}>{ROLE_LABEL[r]}</Badge>)}</div></TD>
                <TD className="text-xs">{u.teams.map((t) => `${teamName(t.id)}${t.isLeader ? "（リーダー）" : ""}`).join("、") || "—"}</TD>
                <TD>{u.status === "active" ? <Badge tone="emerald">有効</Badge> : <Badge tone="slate">利用停止</Badge>}</TD>
                <TD className="tabular text-xs">{fmtDateTime(u.last_login_at)}</TD>
                <TD><Button size="icon" variant="ghost" aria-label={`${u.name}を編集`} onClick={() => setEdit(u)}><Pencil /></Button></TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </div>
      {edit ? <EditUser key={edit.id} user={edit} teams={teams} self={edit.id === meId} onClose={() => setEdit(null)} /> : null}
      <CreateUser open={creating} teams={teams} onClose={() => setCreating(false)} />
    </div>
  );
}

function RolePicker({ value, onChange, lockAdmin }: { value: Role[]; onChange: (r: Role[]) => void; lockAdmin?: boolean }) {
  return (
    <fieldset className="grid grid-cols-2 gap-1.5">
      <legend className="mb-1 text-xs font-medium text-slate-600">ロール（複数可）</legend>
      {ROLES.map((r) => (
        <label key={r} className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4" checked={value.includes(r)} disabled={lockAdmin && r === "admin"}
            onChange={(e) => onChange(e.target.checked ? [...value, r] : value.filter((x) => x !== r))} />
          {ROLE_LABEL[r]}
        </label>
      ))}
    </fieldset>
  );
}

function EditUser({ user, teams, self, onClose }: { user: AdminUser; teams: Team[]; self: boolean; onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(user.name);
  const [status, setStatus] = useState(user.status as "active" | "suspended");
  const [roles, setRoles] = useState<Role[]>(user.roles);
  const [memb, setMemb] = useState<Record<string, "none" | "member" | "leader">>(
    Object.fromEntries(teams.map((t) => { const m = user.teams.find((x) => x.id === t.id); return [t.id, m ? (m.isLeader ? "leader" : "member") : "none"]; })),
  );
  const [pending, start] = useTransition();
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`${user.name} を編集`} description={user.email}>
        <form className="space-y-3" onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const r = await updateUser({
              id: user.id, name, status, roles,
              teams: Object.entries(memb).filter(([, v]) => v !== "none").map(([k]) => k),
              leaderTeams: Object.entries(memb).filter(([, v]) => v === "leader").map(([k]) => k),
            });
            if (!r.ok) return void toast.error(r.error);
            toast.success("保存しました");
            onClose();
            router.refresh();
          });
        }}>
          <Field label="氏名" htmlFor="u-name"><Input id="u-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} /></Field>
          <RolePicker value={roles} onChange={setRoles} lockAdmin={self} />
          <fieldset className="space-y-1.5">
            <legend className="mb-1 text-xs font-medium text-slate-600">所属チーム</legend>
            {teams.map((t) => (
              <div key={t.id} className="flex items-center justify-between gap-2 text-sm">
                <span>{t.name}</span>
                <Select aria-label={`${t.name}の所属`} className="w-36" value={memb[t.id]} onChange={(e) => setMemb({ ...memb, [t.id]: e.target.value as "none" })}>
                  <option value="none">所属なし</option><option value="member">メンバー</option><option value="leader">リーダー</option>
                </Select>
              </div>
            ))}
          </fieldset>
          <Field label="状態" htmlFor="u-status" hint={status === "suspended" ? "利用停止にすると即時ログイン不可になり、担当中の顧客の割り当ては解除されます" : undefined}>
            <Select id="u-status" value={status} disabled={self} onChange={(e) => setStatus(e.target.value as "active")}>
              <option value="active">有効</option><option value="suspended">利用停止</option>
            </Select>
          </Field>
          <Button type="submit" className="w-full" disabled={pending || !roles.length}>保存する</Button>
        </form>
        <PasswordLink userId={user.id} disabled={status !== "active"} />
      </DialogContent>
    </Dialog>
  );
}

function CreateUser({ open, teams, onClose }: { open: boolean; teams: Team[]; onClose: () => void }) {
  const router = useRouter();
  const [roles, setRoles] = useState<Role[]>(["caller"]);
  const [link, setLink] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const close = () => { setLink(null); onClose(); };
  if (link) {
    return (
      <Dialog open={open} onOpenChange={(o) => !o && close()}>
        <DialogContent title="招待リンクを発行しました" description="このリンクを本人に直接送ってください（LINE・社内チャット等）。本人がリンクを開いてパスワードを設定するとログインできます。">
          <LinkBox link={link} />
          <Button className="mt-3 w-full" onClick={close}>閉じる</Button>
        </DialogContent>
      </Dialog>
    );
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent title="ユーザーを招待" description="招待リンクを発行します。本人がリンクを開いてパスワードを設定します。管理者・PM は初回ログイン時に多要素認証の登録が必要です。">
        <form className="space-y-3" onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          start(async () => {
            const r = await createUser({ name: String(f.get("name")), email: String(f.get("email")), roles, teamId: String(f.get("team") || "") || undefined });
            if (!r.ok) return void toast.error(r.error);
            setLink(r.data.link);
            router.refresh();
          });
        }}>
          <Field label="氏名" htmlFor="n-name"><Input id="n-name" name="name" required maxLength={60} /></Field>
          <Field label="メールアドレス" htmlFor="n-email"><Input id="n-email" name="email" type="email" required /></Field>
          <RolePicker value={roles} onChange={setRoles} />
          <Field label="所属チーム" htmlFor="n-team">
            <Select id="n-team" name="team"><option value="">所属なし</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>
          </Field>
          <Button type="submit" className="w-full" disabled={pending || !roles.length}>招待リンクを発行する</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** 招待・パスワード設定リンクの表示（コピー用） */
function LinkBox({ link }: { link: string }) {
  return (
    <div className="space-y-2">
      <textarea readOnly value={link} rows={4} className="w-full rounded-md border border-border bg-slate-50 p-2 font-mono text-[11px]" onFocus={(e) => e.currentTarget.select()} aria-label="発行したリンク" data-testid="issued-link" />
      <Button variant="outline" size="sm" onClick={() => navigator.clipboard?.writeText(link).then(() => toast.success("コピーしました"), () => toast.error("コピーできませんでした"))}>リンクをコピー</Button>
      <p className="text-xs text-slate-500">リンクは一度だけ使えます。有効期限が切れたら「パスワード設定リンクを発行」から再発行してください。</p>
    </div>
  );
}

function PasswordLink({ userId, disabled }: { userId: string; disabled: boolean }) {
  const [link, setLink] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="mt-4 border-t border-border pt-3">
      {link ? <LinkBox link={link} /> : (
        <Button variant="outline" size="sm" disabled={disabled || pending} onClick={() => start(async () => {
          const r = await issuePasswordLink(userId);
          if (!r.ok) return void toast.error(r.error);
          setLink(r.data);
        })}>パスワード設定リンクを発行</Button>
      )}
    </div>
  );
}
