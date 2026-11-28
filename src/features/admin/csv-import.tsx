"use client";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Papa from "papaparse";
import { toast } from "sonner";
import { Ban, FileUp, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { convertRow, guessMapping, isBlockedColumn, TARGET_FIELDS, type ConsentRule, type ImportRow, type Mapping, type TargetField } from "@/lib/import/normalize";
import { finishImport, importBatch, startImport, type ImportBatchResult } from "@/server/domain/import/actions";
import { maskPhone, fmtNum } from "@/lib/format";
import { toCsv } from "@/lib/csv";

const BATCH = 500; // Server Action の本文上限（1MB）に収まる件数
const SAMPLE = 30;

type Parsed = { name: string; headers: string[]; rows: string[][]; encoding: string };
type Totals = ImportBatchResult & { processed: number };
const ZERO: Totals = { processed: 0, inserted: 0, updated: 0, granted: 0, denied: 0, duplicates: 0, errors: 0 };

/** UTF-8（BOM 可）を優先し、不正なら Shift_JIS（kintone・Excel の既定）として読む */
function decode(buf: ArrayBuffer): { text: string; encoding: string } {
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(buf).replace(/^﻿/, ""), encoding: "UTF-8" };
  } catch {
    return { text: new TextDecoder("shift_jis").decode(buf), encoding: "Shift_JIS" };
  }
}

export function CsvImport() {
  const router = useRouter();
  const [file, setFile] = useState<Parsed | null>(null);
  const [appId, setAppId] = useState("");
  const [map, setMap] = useState<Mapping>({});
  const [consentCol, setConsentCol] = useState<number | null>(null);
  const [consentValues, setConsentValues] = useState<Record<string, "granted" | "denied" | "">>({});
  const [basis, setBasis] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [running, setRunning] = useState(false);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [failures, setFailures] = useState<{ line: number; recordId: string; reason: string }[]>([]);
  const cancelRef = useRef(false);

  async function onFile(f: File | undefined) {
    if (!f) return;
    if (f.size > 300 * 1024 * 1024) return void toast.error("ファイルが大きすぎます（300MB まで）");
    const { text, encoding } = decode(await f.arrayBuffer());
    const res = Papa.parse<string[]>(text, { skipEmptyLines: "greedy" });
    const [headers, ...rows] = res.data;
    if (!headers?.length || !rows.length) return void toast.error("CSV を読み取れませんでした（1行目に項目名が必要です）");
    setFile({ name: f.name, headers: headers.map((h) => h.trim()), rows, encoding });
    setMap(guessMapping(headers));
    setConsentCol(null);
    setConsentValues({});
    setTotals(null);
    setFailures([]);
    setConfirmed(false);
  }

  const blocked = useMemo(() => file?.headers.filter(isBlockedColumn) ?? [], [file]);
  const distinctConsent = useMemo(() => {
    if (!file || consentCol === null) return [];
    const counts = new Map<string, number>();
    for (const r of file.rows) {
      const v = (r[consentCol] ?? "").trim();
      counts.set(v, (counts.get(v) ?? 0) + 1);
      if (counts.size > 50) break;
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [file, consentCol]);

  const consentRule: ConsentRule | null = useMemo(() => {
    if (consentCol === null) return null;
    const g = Object.entries(consentValues).filter(([, v]) => v === "granted").map(([k]) => k);
    const d = Object.entries(consentValues).filter(([, v]) => v === "denied").map(([k]) => k);
    return g.length || d.length ? { column: consentCol, grantedValues: g, deniedValues: d } : null;
  }, [consentCol, consentValues]);

  // 全行を検証（25万行で 1 秒前後）
  const check = useMemo(() => {
    if (!file) return null;
    let ok = 0, bad = 0, noPhone = 0, granted = 0, denied = 0;
    const reasons = new Map<string, number>();
    const sample: ImportRow[] = [];
    for (const r of file.rows) {
      const c = convertRow(r, map, consentRule);
      if (!c.ok) {
        bad++;
        reasons.set(c.reason, (reasons.get(c.reason) ?? 0) + 1);
        continue;
      }
      ok++;
      if (!c.row.phones.length) noPhone++;
      if (c.row.consent === "granted") granted++;
      if (c.row.consent === "denied") denied++;
      for (const w of c.warnings) if (!w.startsWith("有効な電話番号なし")) reasons.set(w, (reasons.get(w) ?? 0) + 1);
      if (sample.length < 5) sample.push(c.row);
    }
    return { ok, bad, noPhone, granted, denied, reasons: [...reasons.entries()].sort((a, b) => b[1] - a[1]), sample };
  }, [file, map, consentRule]);

  const nameMapped = map.fullName !== undefined || map.lastName !== undefined;
  const needsBasis = consentRule !== null;
  const ready = !!file && !!check && check.ok > 0 && map.recordId !== undefined && nameMapped && appId.trim().length > 0
    && (!needsBasis || basis.trim().length >= 5) && confirmed && !running;

  async function run() {
    if (!file || !check) return;
    cancelRef.current = false;
    setRunning(true);
    setFailures([]);
    const t: Totals = { ...ZERO };
    setTotals(t);
    const fails: { line: number; recordId: string; reason: string }[] = [];
    const s = await startImport({ appId: appId.trim(), total: file.rows.length, consentBasis: needsBasis ? basis.trim() : null });
    if (!s.ok) {
      setRunning(false);
      return void toast.error(s.error);
    }
    const jobId = s.data;
    let status: "completed" | "canceled" | "failed" = "completed";
    for (let i = 0; i < file.rows.length; i += BATCH) {
      if (cancelRef.current) {
        status = "canceled";
        break;
      }
      const rows: ImportRow[] = [];
      const errors: { recordId: string; code: string; message: string }[] = [];
      file.rows.slice(i, i + BATCH).forEach((r, k) => {
        const c = convertRow(r, map, consentRule);
        if (c.ok) rows.push(c.row);
        else {
          const rid = map.recordId !== undefined ? (r[map.recordId] ?? "").trim().slice(0, 64) : "";
          errors.push({ recordId: rid, code: "invalid_row", message: c.reason });
          fails.push({ line: i + k + 2, recordId: rid, reason: c.reason });
        }
      });
      let res = await importBatch({ jobId, rows, errors });
      if (!res.ok) res = await importBatch({ jobId, rows, errors }); // 通信の一時的な失敗に 1 回だけ再試行（冪等）
      if (!res.ok) {
        status = "failed";
        toast.error(`${fmtNum(i + 1)} 行目付近で停止しました：${res.error}（同じファイルで再実行すると続きから反映されます）`);
        break;
      }
      for (const k of Object.keys(res.data) as (keyof ImportBatchResult)[]) t[k] += res.data[k];
      t.processed = Math.min(i + BATCH, file.rows.length);
      setTotals({ ...t });
    }
    await finishImport(jobId, status);
    setFailures(fails);
    setRunning(false);
    if (status === "completed") toast.success("取り込みが完了しました");
    if (status === "canceled") toast("取り込みを中止しました（反映済みの分はそのまま残ります）");
    router.refresh();
  }

  function downloadFailures() {
    // レコード番号と理由のみ（氏名・電話は含めない）
    const blob = new Blob(["﻿" + toCsv(["行番号", "レコード番号", "理由"], failures.map((f) => [f.line, f.recordId, f.reason]))], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "取り込みエラー.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const headerOptions = (field: TargetField) => (
    <Select
      id={`map-${field}`}
      value={map[field] ?? ""}
      disabled={running}
      onChange={(e) => setMap((m) => {
        const n = { ...m };
        if (e.target.value === "") delete n[field];
        else n[field] = Number(e.target.value);
        return n;
      })}
    >
      <option value="">（使わない）</option>
      {file?.headers.map((h, i) => (
        <option key={i} value={i} disabled={isBlockedColumn(h)}>{h}{isBlockedColumn(h) ? "（取り込み不可）" : ""}</option>
      ))}
    </Select>
  );

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h2 className="text-sm font-semibold">1. CSV ファイルを選ぶ</h2>
        <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-5 hover:border-accent-blue/60 focus-within:ring-2 focus-within:ring-ring">
          <FileUp className="size-6 text-slate-500" aria-hidden />
          <span className="text-sm">
            {file ? <><span className="font-medium">{file.name}</span>（{fmtNum(file.rows.length)} 行・{file.encoding}）</> : "kintone から出力した CSV を選択（UTF-8 / Shift_JIS）"}
            <span className="block text-xs text-slate-500">ファイルはこのブラウザで読み取り、必要な項目だけを送信します。</span>
          </span>
          <input type="file" accept=".csv,text/csv" className="sr-only" disabled={running} onChange={(e) => onFile(e.target.files?.[0])} data-testid="csv-file" />
        </label>
      </section>

      {file && check ? (
        <>
          <section className="space-y-3">
            <h2 className="text-sm font-semibold">2. 項目の対応付け</h2>
            {blocked.length ? (
              <p className="flex items-start gap-2 rounded-md bg-amber-50 p-3 text-xs text-amber-900">
                <Ban className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>次の列は住宅ローン・借入・資産等に関わるため取り込みません：{blocked.join("、")}</span>
              </p>
            ) : null}
            <Field label="kintone アプリ（取り込み元の識別名・番号）" htmlFor="app-id" hint="同じアプリ名で再取り込みすると、レコード番号で照合して更新します（二重登録しません）。">
              <Input id="app-id" value={appId} onChange={(e) => setAppId(e.target.value)} placeholder="例：123（kintone のアプリ番号）" maxLength={40} disabled={running} className="max-w-xs" />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {(Object.keys(TARGET_FIELDS) as TargetField[]).filter((f) => f !== "consent").map((f) => (
                <Field key={f} label={`${TARGET_FIELDS[f].label}${f === "recordId" ? "（必須）" : ""}`} htmlFor={`map-${f}`}>{headerOptions(f)}</Field>
              ))}
            </div>
            {!nameMapped ? <p className="text-xs text-rose-600" role="alert">「氏名」または「姓」を対応付けてください。</p> : null}
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold">3. 人材事業の利用許諾（任意）</h2>
            <p className="text-xs text-slate-600">対応付けない場合、全員「未確認」で登録され架電できません。許諾は後から「個人情報・利用許諾管理」でも登録できます。</p>
            <Field label="利用許諾の列" htmlFor="consent-col" className="max-w-xs">
              <Select id="consent-col" value={consentCol ?? ""} disabled={running} onChange={(e) => { setConsentCol(e.target.value === "" ? null : Number(e.target.value)); setConsentValues({}); }}>
                <option value="">（使わない）</option>
                {file.headers.map((h, i) => <option key={i} value={i} disabled={isBlockedColumn(h)}>{h}</option>)}
              </Select>
            </Field>
            {consentCol !== null ? (
              <div className="space-y-3">
                <table className="text-sm">
                  <thead><tr className="text-left text-xs text-slate-500"><th className="py-1 pr-6 font-medium">値</th><th className="pr-6 font-medium">件数</th><th className="font-medium">扱い</th></tr></thead>
                  <tbody>
                    {distinctConsent.map(([v, n]) => (
                      <tr key={v}>
                        <td className="py-1 pr-6">{v || "（空欄）"}</td>
                        <td className="tabular pr-6">{fmtNum(n)}{distinctConsent.length > 50 ? "+" : ""}</td>
                        <td>
                          <Select aria-label={`${v || "空欄"} の扱い`} value={consentValues[v] ?? ""} disabled={running || v === ""} className="h-8 w-40"
                            onChange={(e) => setConsentValues((m) => ({ ...m, [v]: e.target.value as "granted" | "denied" | "" }))}>
                            <option value="">未確認（架電不可）</option>
                            <option value="granted">許諾あり</option>
                            <option value="denied">許諾なし</option>
                          </Select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {needsBasis ? (
                  <Field label="許諾の根拠（必須・監査ログと各顧客の許諾履歴に残ります）" htmlFor="basis" className="max-w-xl">
                    <Textarea id="basis" rows={2} value={basis} onChange={(e) => setBasis(e.target.value)} maxLength={300} disabled={running}
                      placeholder="例：2024年4月以降の問合せフォームで「キャリア相談の案内を受け取る」に同意（規約 v3）" />
                  </Field>
                ) : null}
                <p className="text-xs text-slate-500">「許諾あり」は未確認の顧客にだけ反映し、拒否・撤回済みの顧客を許諾に戻すことはありません。</p>
              </div>
            ) : null}
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold">4. 確認</h2>
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-6" data-testid="import-check">
              {[
                ["取り込み可能", check.ok], ["取り込めない行", check.bad], ["電話番号なし", check.noPhone],
                ["許諾あり", check.granted], ["許諾なし", check.denied], ["未確認（架電不可）", check.ok - check.granted - check.denied],
              ].map(([l, v]) => (
                <div key={l as string} className="rounded-md border border-border p-3"><dt className="text-xs text-slate-500">{l}</dt><dd className="tabular text-lg font-semibold">{fmtNum(v as number)}</dd></div>
              ))}
            </dl>
            {check.reasons.length ? (
              <ul className="text-xs text-slate-600">{check.reasons.slice(0, 8).map(([r, n]) => <li key={r}>{r}：{fmtNum(n)} 件</li>)}</ul>
            ) : null}
            {check.sample.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <caption className="mb-1 text-left text-slate-500">変換結果の例（先頭 {check.sample.length} 件・電話は一部伏せ字）</caption>
                  <thead><tr className="text-left text-slate-500"><th className="py-1 pr-3">レコード番号</th><th className="pr-3">氏名</th><th className="pr-3">カナ</th><th className="pr-3">電話</th><th className="pr-3">都道府県</th><th className="pr-3">問合せ日</th><th>許諾</th></tr></thead>
                  <tbody>
                    {check.sample.slice(0, SAMPLE).map((r) => (
                      <tr key={r.recordId} className="border-t border-border">
                        <td className="py-1 pr-3">{r.recordId}</td>
                        <td className="pr-3">{r.lastName} {r.firstName}</td>
                        <td className="pr-3">{[r.lastKana, r.firstKana].filter(Boolean).join(" ") || "—"}</td>
                        <td className="tabular pr-3">{r.phones.map(maskPhone).join(" / ") || "—"}</td>
                        <td className="pr-3">{r.pref ?? "—"}</td>
                        <td className="pr-3">{r.inquiredAt ? r.inquiredAt.slice(0, 10) : "—"}</td>
                        <td>{r.consent === "granted" ? "許諾あり" : r.consent === "denied" ? "許諾なし" : "未確認"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} disabled={running} />
              <span>このファイルは人材事業での利用目的に沿って取り込めるデータであり、住宅ローン審査・借入・資産情報の列を含めていないことを確認しました。</span>
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="accent" onClick={run} disabled={!ready} data-testid="import-run">
                {running ? <Loader2 className="animate-spin" aria-hidden /> : null}
                {fmtNum(check.ok)} 件を取り込む
              </Button>
              {running ? <Button variant="outline" onClick={() => { cancelRef.current = true; }}>中止</Button> : null}
            </div>
          </section>
        </>
      ) : null}

      {totals ? (
        <section className="space-y-2" aria-live="polite" data-testid="import-result">
          <h2 className="text-sm font-semibold">{running ? "取り込み中…" : "取り込み結果"}</h2>
          <div className="h-2 w-full overflow-hidden rounded bg-slate-100" role="progressbar" aria-valuemin={0} aria-valuemax={file?.rows.length ?? 0} aria-valuenow={totals.processed}>
            <div className="h-full bg-accent-blue transition-all" style={{ width: `${file?.rows.length ? (totals.processed / file.rows.length) * 100 : 0}%` }} />
          </div>
          <p className="tabular text-sm">
            {fmtNum(totals.processed)} / {fmtNum(file?.rows.length)} 行　新規 {fmtNum(totals.inserted)}・更新 {fmtNum(totals.updated)}・エラー {fmtNum(totals.errors)}・
            許諾反映 {fmtNum(totals.granted)}・拒否反映 {fmtNum(totals.denied)}・重複候補 {fmtNum(totals.duplicates)}
          </p>
          {!running && failures.length ? <Button size="sm" variant="outline" onClick={downloadFailures}>取り込めなかった行（{fmtNum(failures.length)} 件）を CSV で保存</Button> : null}
        </section>
      ) : null}
    </div>
  );
}
