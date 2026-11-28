/**
 * kintone 等から出力した顧客 CSV の正規化（ブラウザ・サーバー共通、純粋関数）。
 * 個人情報を含むため、ここでログ出力はしない。
 */

/** 取り込み先の項目 */
export const TARGET_FIELDS = {
  recordId: { label: "レコード番号（kintone）", required: true, hints: ["レコード番号", "$id", "レコードID", "record_id", "id", "顧客番号", "顧客ID"] },
  fullName: { label: "氏名（姓名まとめて）", required: false, hints: ["氏名", "お名前", "名前", "顧客名", "契約者名"] },
  lastName: { label: "姓", required: false, hints: ["姓", "苗字", "名字"] },
  firstName: { label: "名", required: false, hints: ["名"] },
  fullKana: { label: "フリガナ（まとめて）", required: false, hints: ["フリガナ", "ふりがな", "氏名カナ", "カナ", "氏名（カナ）", "氏名(カナ)"] },
  lastKana: { label: "セイ", required: false, hints: ["セイ", "姓カナ", "姓（カナ）"] },
  firstKana: { label: "メイ", required: false, hints: ["メイ", "名カナ", "名（カナ）"] },
  phone1: { label: "電話番号1", required: false, hints: ["携帯電話", "携帯", "携帯番号", "電話番号", "TEL", "電話"] },
  phone2: { label: "電話番号2", required: false, hints: ["自宅電話", "固定電話", "電話番号2", "TEL2", "自宅"] },
  email: { label: "メールアドレス", required: false, hints: ["メールアドレス", "メール", "Email", "E-mail", "mail"] },
  pref: { label: "都道府県", required: false, hints: ["都道府県", "住所（都道府県）", "県"] },
  city: { label: "市区町村", required: false, hints: ["市区町村", "住所（市区町村）", "市町村"] },
  inquiredAt: { label: "初回問合せ日", required: false, hints: ["問合せ日", "問い合わせ日", "反響日", "初回問合せ日", "登録日", "作成日時"] },
  sourceDetail: { label: "流入元の詳細（媒体・LP名）", required: false, hints: ["流入元", "媒体", "反響媒体", "問合せ経路", "流入経路"] },
  consent: { label: "人材事業の利用許諾", required: false, hints: ["人材", "利用許諾", "同意", "キャリア案内"] },
} as const;
export type TargetField = keyof typeof TARGET_FIELDS;
export type Mapping = Partial<Record<TargetField, number>>;

/**
 * 取り込み禁止の列（指示書：住宅ローン審査結果・借入状況・資産情報をターゲティングに使わない）。
 * 列名にこれらの語を含む列は対応付けできず、データも送信しない。
 */
const BLOCKED = ["ローン", "借入", "借り入れ", "審査", "年収", "資産", "預金", "貯金", "収入", "融資", "返済", "債務", "与信", "勤続", "自己資金", "頭金", "金利", "銀行", "保証"];
export function isBlockedColumn(header: string) {
  return BLOCKED.some((w) => header.includes(w));
}

/** 全角英数・記号を半角へ */
export function toHalfWidth(s: string) {
  return s.replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/　/g, " ");
}

/** 日本の電話番号 → E.164（+81…）。判定できなければ null */
export function normalizePhoneJp(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = toHalfWidth(String(raw)).replace(/[^\d+]/g, "");
  if (d.startsWith("+81")) d = "0" + d.slice(3);
  else if (d.startsWith("81") && (d.length === 11 || d.length === 12)) d = "0" + d.slice(2);
  d = d.replace(/\D/g, "");
  // 先頭の 0 が Excel で落ちたもの（例：9012345678）
  if (/^[1-9]\d{8,9}$/.test(d)) d = "0" + d;
  if (/^0[789]0\d{8}$/.test(d)) return "+81" + d.slice(1); // 携帯
  if (/^0[1-9]\d{8}$/.test(d) && !/^0120|^0800|^0570|^0990/.test(d)) return "+81" + d.slice(1); // 固定
  return null;
}

export function isMobileE164(e164: string) {
  return /^\+81[789]0/.test(e164);
}

export function splitName(full: string): [string, string] {
  const s = toHalfWidth(full).trim().replace(/\s+/g, " ");
  const i = s.indexOf(" ");
  return i < 0 ? [s, ""] : [s.slice(0, i), s.slice(i + 1).replace(/ /g, "")];
}

/** 2024/1/5、2024-01-05 10:00、2024年1月5日、20240105 → ISO（JST） */
export function parseDateJst(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = toHalfWidth(String(raw)).trim();
  let m = s.match(/^(\d{4})[/\-.年](\d{1,2})[/\-.月](\d{1,2})日?(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) {
    const c = s.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (c) m = [s, c[1], c[2], c[3]] as unknown as RegExpMatchArray;
  }
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) return null;
  const hh = m[4] ? Number(m[4]) : 0, mm = m[5] ? Number(m[5]) : 0;
  const iso = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00+09:00`;
  return Number.isNaN(Date.parse(iso)) ? null : new Date(iso).toISOString();
}

const PREFS = ["北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県", "茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県", "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県", "岐阜県", "静岡県", "愛知県", "三重県", "滋賀県", "京都府", "大阪府", "兵庫県", "奈良県", "和歌山県", "鳥取県", "島根県", "岡山県", "広島県", "山口県", "徳島県", "香川県", "愛媛県", "高知県", "福岡県", "佐賀県", "長崎県", "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県"];
/** 「東京」「東京都港区…」→「東京都」 */
export function normalizePref(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();
  const hit = PREFS.find((p) => s.startsWith(p)) ?? PREFS.find((p) => s.startsWith(p.replace(/[都府県]$/, "")));
  return hit ?? null;
}

export type ConsentRule = { column: number; grantedValues: string[]; deniedValues: string[] };

export type ImportRow = {
  recordId: string;
  lastName: string;
  firstName: string;
  lastKana: string | null;
  firstKana: string | null;
  phones: string[];
  email: string | null;
  pref: string | null;
  city: string | null;
  inquiredAt: string | null;
  sourceDetail: string | null;
  consent: "granted" | "denied" | null;
};

export type RowResult = { ok: true; row: ImportRow; warnings: string[] } | { ok: false; reason: string };

const cell = (r: string[], i: number | undefined) => (i === undefined ? "" : (r[i] ?? "").trim());

/** CSV の 1 行を取り込み形式に変換する。必須：レコード番号・氏名 */
export function convertRow(r: string[], map: Mapping, consent?: ConsentRule | null): RowResult {
  const recordId = toHalfWidth(cell(r, map.recordId));
  if (!recordId) return { ok: false, reason: "レコード番号がありません" };
  let last = cell(r, map.lastName), first = cell(r, map.firstName);
  if (!last && map.fullName !== undefined) [last, first] = splitName(cell(r, map.fullName));
  if (!last) return { ok: false, reason: "氏名がありません" };
  let lk: string | null = cell(r, map.lastKana) || null, fk: string | null = cell(r, map.firstKana) || null;
  if (!lk && map.fullKana !== undefined && cell(r, map.fullKana)) {
    const [a, b] = splitName(cell(r, map.fullKana));
    lk = a || null;
    fk = b || null;
  }
  const warnings: string[] = [];
  const phones: string[] = [];
  for (const k of ["phone1", "phone2"] as const) {
    const raw = cell(r, map[k]);
    if (!raw) continue;
    const p = normalizePhoneJp(raw);
    if (p) {
      if (!phones.includes(p)) phones.push(p);
    } else warnings.push(`電話番号の形式が不正（${TARGET_FIELDS[k].label}）`);
  }
  phones.sort((a, b) => Number(isMobileE164(b)) - Number(isMobileE164(a)));
  if (!phones.length) warnings.push("有効な電話番号なし（架電対象外になります）");
  const emailRaw = toHalfWidth(cell(r, map.email)).toLowerCase();
  const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw) ? emailRaw : null;
  if (emailRaw && !email) warnings.push("メールアドレスの形式が不正");
  const inqRaw = cell(r, map.inquiredAt);
  const inquiredAt = parseDateJst(inqRaw);
  if (inqRaw && !inquiredAt) warnings.push("問合せ日の形式が不正");
  let c: ImportRow["consent"] = null;
  if (consent) {
    const v = cell(r, consent.column);
    if (v && consent.grantedValues.includes(v)) c = "granted";
    else if (v && consent.deniedValues.includes(v)) c = "denied";
  }
  const prefRaw = cell(r, map.pref);
  return {
    ok: true,
    warnings,
    row: {
      recordId,
      lastName: toHalfWidth(last).slice(0, 50),
      firstName: toHalfWidth(first).slice(0, 50),
      lastKana: lk?.slice(0, 50) ?? null,
      firstKana: fk?.slice(0, 50) ?? null,
      phones: phones.slice(0, 3),
      email,
      pref: normalizePref(prefRaw) ?? normalizePref(cell(r, map.city)),
      city: cell(r, map.city).slice(0, 100) || null,
      inquiredAt,
      sourceDetail: cell(r, map.sourceDetail).slice(0, 100) || null,
      consent: c,
    },
  };
}

/** 列名から対応付けを推測（取り込み禁止列は除外） */
export function guessMapping(headers: string[]): Mapping {
  const map: Mapping = {};
  const used = new Set<number>();
  const norm = (h: string) => toHalfWidth(h).replace(/\s/g, "");
  for (const [field, def] of Object.entries(TARGET_FIELDS) as [TargetField, (typeof TARGET_FIELDS)[TargetField]][]) {
    if (field === "consent") continue; // 許諾は必ず人が選ぶ
    for (const hint of def.hints) {
      const i = headers.findIndex((h, idx) => !used.has(idx) && !isBlockedColumn(h) && norm(h) === norm(hint));
      if (i >= 0) {
        map[field] = i;
        used.add(i);
        break;
      }
    }
  }
  if (map.fullName === undefined && map.lastName === undefined) {
    const i = headers.findIndex((h, idx) => !used.has(idx) && !isBlockedColumn(h) && /氏名|名前/.test(h) && !/カナ|フリガナ/.test(h));
    if (i >= 0) map.fullName = i;
  }
  return map;
}
