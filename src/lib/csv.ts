/** CSV の1セル。数式として解釈される先頭文字（= + - @ タブ CR）は ' を付けて無害化する（CSV インジェクション対策） */
export function csvCell(v: unknown) {
  const s = v === null || v === undefined ? "" : String(v);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** Excel で文字化けしないよう BOM 付き・CRLF */
export function toCsv(head: string[], rows: unknown[][]) {
  return "﻿" + [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
}
