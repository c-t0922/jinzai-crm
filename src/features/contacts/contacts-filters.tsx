"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Search, Bookmark, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { saveSearch } from "@/server/domain/contacts/actions";

const PREFS = ["東京都", "神奈川県", "埼玉県", "千葉県", "大阪府", "愛知県", "福岡県", "兵庫県", "北海道", "静岡県"];

export function ContactsFilters({ params, saved }: { params: Record<string, string | undefined>; saved: { id: string; name: string; params: Record<string, string> }[] }) {
  const router = useRouter();
  const [v, setV] = useState<Record<string, string>>(Object.fromEntries(Object.entries(params).filter(([k, x]) => x && k !== "cursor")) as Record<string, string>);
  const set = (k: string, x: string) => setV((o) => ({ ...o, [k]: x }));
  const apply = (next = v) => {
    const p = new URLSearchParams(Object.entries(next).filter(([, x]) => x));
    router.push(`/contacts?${p.toString()}`);
  };
  const active = Object.keys(v).filter((k) => k !== "sort").length;

  return (
    <form
      className="space-y-2 rounded-lg border border-border bg-white p-3"
      onSubmit={(e) => {
        e.preventDefault();
        apply();
      }}
    >
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Input aria-label="氏名・カナ" placeholder="氏名・カナで検索" value={v.q ?? ""} onChange={(e) => set("q", e.target.value)} />
        <Input aria-label="電話番号" placeholder="電話番号（一部可）" inputMode="tel" value={v.phone ?? ""} onChange={(e) => set("phone", e.target.value)} />
        <Input aria-label="メールアドレス" placeholder="メールアドレス（前方一致）" value={v.email ?? ""} onChange={(e) => set("email", e.target.value)} />
        <div className="flex gap-2">
          <Button type="submit" className="flex-1">
            <Search /> 検索
          </Button>
          {active ? (
            <Button type="button" variant="ghost" onClick={() => { setV({}); router.push("/contacts"); }} aria-label="条件をクリア">
              <X />
            </Button>
          ) : null}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
        <Select aria-label="都道府県" value={v.pref ?? ""} onChange={(e) => set("pref", e.target.value)}>
          <option value="">都道府県：すべて</option>
          {PREFS.map((p) => <option key={p}>{p}</option>)}
        </Select>
        <Select aria-label="流入元" value={v.source ?? ""} onChange={(e) => set("source", e.target.value)}>
          <option value="">流入元：すべて</option>
          <option value="kintone">kintone（住宅）</option>
          <option value="lp">人材LP</option>
          <option value="manual">手動登録</option>
        </Select>
        <Select aria-label="利用許諾" value={v.consent ?? ""} onChange={(e) => set("consent", e.target.value)}>
          <option value="">利用許諾：すべて</option>
          <option value="granted">許諾済</option>
          <option value="unknown">未確認</option>
          <option value="denied,withdrawn">不許諾・撤回</option>
        </Select>
        <Select aria-label="対応状況" value={v.state ?? ""} onChange={(e) => set("state", e.target.value)}>
          <option value="">対応状況：すべて</option>
          <option value="new">未対応</option>
          <option value="recall">再架電</option>
          <option value="appointed">アポ獲得</option>
          <option value="closed">クローズ</option>
        </Select>
        <Select aria-label="架電可否" value={v.callable ?? (v.suppressed ? "s" : "")} onChange={(e) => setV((o) => ({ ...o, callable: e.target.value === "1" ? "1" : "", suppressed: e.target.value === "s" ? "1" : "" }))}>
          <option value="">架電可否：すべて</option>
          <option value="1">架電可能のみ</option>
          <option value="s">架電禁止のみ</option>
        </Select>
        <Input aria-label="問い合わせ日（から）" type="date" value={v.from ?? ""} onChange={(e) => set("from", e.target.value)} />
        <Input aria-label="問い合わせ日（まで）" type="date" value={v.to ?? ""} onChange={(e) => set("to", e.target.value)} />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-slate-500">保存済み：</span>
        {saved.length === 0 ? <span className="text-slate-400">なし</span> : null}
        {saved.map((s) => (
          <button key={s.id} type="button" className="rounded-full border border-border px-2.5 py-0.5 hover:bg-slate-50" onClick={() => { setV(s.params); apply(s.params); }}>
            {s.name}
          </button>
        ))}
        <button
          type="button"
          className="ml-auto inline-flex items-center gap-1 text-accent-blue hover:underline"
          onClick={async () => {
            const name = window.prompt("この検索条件の名前");
            if (!name) return;
            const r = await saveSearch(name, v);
            if (r.ok) toast.success("検索条件を保存しました");
            else toast.error(r.error);
          }}
        >
          <Bookmark className="size-3.5" /> 条件を保存
        </button>
      </div>
    </form>
  );
}
