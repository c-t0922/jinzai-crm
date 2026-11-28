export type SP = Record<string, string | undefined>;

/** URL の絞り込み → 条件ビルダー形式（DB 側 compile_filter と同じ形式） */
export function filterFromParams(sp: SP) {
  const rules: { field: string; operator: string; value: unknown }[] = [];
  const list = (v?: string) => (v ? v.split(",").filter(Boolean) : []);
  if (list(sp.pref).length) rules.push({ field: "area_pref", operator: "in", value: list(sp.pref) });
  if (list(sp.source).length) rules.push({ field: "primary_source", operator: "in", value: list(sp.source) });
  if (list(sp.consent).length) rules.push({ field: "consent_status", operator: "in", value: list(sp.consent) });
  if (list(sp.state).length) rules.push({ field: "queue_state", operator: "in", value: list(sp.state) });
  if (list(sp.result).length) rules.push({ field: "last_call_result", operator: "in", value: list(sp.result) });
  if (sp.callable === "1") rules.push({ field: "callable", operator: "eq", value: true });
  if (sp.suppressed === "1") rules.push({ field: "is_suppressed", operator: "eq", value: true });
  if (sp.untouched === "1") rules.push({ field: "call_count", operator: "eq", value: 0 });
  if (sp.tag) rules.push({ field: "tags", operator: "contains_any", value: [sp.tag] });
  if (sp.from || sp.to) rules.push({ field: "first_inquiry_at", operator: "between", value: [sp.from || "2000-01-01", sp.to || "2100-01-01"] });
  return { op: "and", rules };
}

