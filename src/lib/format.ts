const TZ = "Asia/Tokyo";

export function fmtDateTime(v: string | null | undefined, opts: { withYear?: boolean } = {}) {
  if (!v) return "—";
  const d = new Date(v);
  return d.toLocaleString("ja-JP", {
    timeZone: TZ,
    year: opts.withYear ? "numeric" : undefined,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function fmtDate(v: string | null | undefined) {
  if (!v) return "—";
  return new Date(v).toLocaleDateString("ja-JP", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
}

export function fmtNum(n: number | null | undefined) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toLocaleString("ja-JP");
}

/** 分母 0・データなしは null（未計測）を返す */
export function ratio(num: number | null | undefined, den: number | null | undefined): number | null {
  if (num === null || num === undefined || !den) return null;
  return num / den;
}

export function fmtPct(r: number | null) {
  if (r === null) return "未計測";
  return `${(r * 100).toFixed(1)}%`;
}

export function fmtDuration(sec: number | null | undefined) {
  if (sec === null || sec === undefined) return "—";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** 日本の電話番号表示（E.164 → 090-1234-5678） */
export function displayPhone(e164: string | null | undefined) {
  if (!e164) return "—";
  const d = e164.replace(/^\+81/, "0");
  if (/^0[789]0\d{8}$/.test(d)) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  if (/^0\d{9}$/.test(d)) return `${d.slice(0, 2)}-${d.slice(2, 6)}-${d.slice(6)}`;
  return d;
}

/** マスキング表示：090-****-5678 */
export function maskPhone(e164: string | null | undefined) {
  const p = displayPhone(e164);
  if (p === "—") return p;
  const parts = p.split("-");
  if (parts.length === 3) return `${parts[0]}-****-${parts[2]}`;
  return p.slice(0, 3) + "****" + p.slice(-4);
}

export function todayJst() {
  return new Date().toLocaleDateString("sv-SE", { timeZone: TZ });
}

export function addDaysJst(base: string, days: number) {
  const d = new Date(`${base}T00:00:00+09:00`);
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString("sv-SE", { timeZone: TZ });
}
