import { z } from "zod";

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const PRIORITY_KEYS = ["recall_today", "lp_new", "consult_wanted", "untouched", "recall_absent"] as const;
export const RULE_SCHEMAS = {
  calling_hours: z.object({ start: hhmm, end: hhmm, days: z.array(z.number().int().min(0).max(6)).min(1), enforce: z.boolean() }).refine((v) => v.start < v.end, "開始は終了より前にしてください"),
  assignment_priority: z.array(z.enum(PRIORITY_KEYS)).length(PRIORITY_KEYS.length).refine((v) => new Set(v).size === v.length),
  max_no_answer_attempts: z.number().int().min(1).max(30),
  lock_ttl_minutes: z.number().int().min(1).max(60),
  export_max_rows: z.number().int().min(1).max(50000),
  auto_logout_minutes: z.number().int().min(5).max(480),
} as const;
export type EditableRule = keyof typeof RULE_SCHEMAS;
