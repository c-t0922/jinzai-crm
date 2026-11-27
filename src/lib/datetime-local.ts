/** <input type="datetime-local"> の値（JST）⇔ ISO 文字列 */
export function toLocalInput(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  const jst = new Date(d.getTime() + 9 * 3600_000);
  return jst.toISOString().slice(0, 16);
}

export function fromLocalInput(v: string | null | undefined) {
  if (!v) return null;
  return new Date(`${v}:00+09:00`).toISOString().replace("Z", "+00:00");
}

export function presetJst(kind: "1h" | "tomorrow" | "3d" | "1w", now = new Date()) {
  const ms = { "1h": 3600_000, tomorrow: 86400_000, "3d": 3 * 86400_000, "1w": 7 * 86400_000 }[kind];
  const d = new Date(now.getTime() + ms);
  d.setSeconds(0, 0);
  return toLocalInput(d.toISOString());
}
