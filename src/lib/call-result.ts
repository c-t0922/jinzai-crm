import { z } from "zod";

export type ResultMaster = {
  code: string;
  label: string;
  category: string;
  is_connected: boolean;
  required_fields: string[];
  optional_fields: string[];
  auto_action: { type?: string; delay?: string; reason?: string; block_days?: number };
  shortcut_key: string | null;
  sort_order: number;
};

export const hearingSchema = z.object({
  currentJob: z.string().max(100).optional(),
  desiredTiming: z.string().max(50).optional(),
  desiredJob: z.string().max(100).optional(),
  desiredArea: z.string().max(100).optional(),
});

export const saveResultSchema = z.object({
  contactId: z.uuid(),
  callLogId: z.uuid().nullable(),
  resultCode: z.string().min(1),
  idempotencyKey: z.string().min(8).max(100),
  hearing: hearingSchema.default({}),
  memo: z.string().max(2000).optional().nullable(),
  nextCallAt: z.iso.datetime({ offset: true }).optional().nullable(),
  appointment: z
    .object({
      scheduledAt: z.iso.datetime({ offset: true }),
      method: z.enum(["online", "phone", "visit"]),
      meetingUrl: z.url().optional().or(z.literal("")),
      advisorUserId: z.uuid().optional().or(z.literal("")),
      note: z.string().max(500).optional(),
    })
    .optional()
    .nullable(),
});
export type SaveResultInput = z.infer<typeof saveResultSchema>;

/** 結果ごとに表示する入力欄（必須＋任意） */
export function fieldsFor(m: ResultMaster | undefined) {
  const all = new Set([...(m?.required_fields ?? []), ...(m?.optional_fields ?? [])]);
  return {
    hearing: all.has("hearing"),
    memo: all.has("memo"),
    nextCallAt: all.has("next_call_at"),
    appointment: all.has("appointment"),
    required: new Set(m?.required_fields ?? []),
  };
}

/** クライアント・サーバー共通の必須チェック。エラーがあればフィールド名→メッセージ */
export function validateResult(m: ResultMaster | undefined, input: Pick<SaveResultInput, "memo" | "nextCallAt" | "appointment">) {
  const errors: Record<string, string> = {};
  if (!m) {
    errors.result = "架電結果を選択してください";
    return errors;
  }
  const req = new Set(m.required_fields);
  if (req.has("next_call_at") && !input.nextCallAt) errors.nextCallAt = "次回架電日時を入力してください";
  if (req.has("memo") && !input.memo?.trim()) errors.memo = "内容を入力してください";
  if (req.has("appointment")) {
    if (!input.appointment?.scheduledAt) errors.appointment = "アポイント日時を入力してください";
    else if (new Date(input.appointment.scheduledAt).getTime() < Date.now() - 5 * 60_000) errors.appointment = "過去の日時は指定できません";
  }
  if (input.nextCallAt && new Date(input.nextCallAt).getTime() < Date.now() - 5 * 60_000) errors.nextCallAt = "過去の日時は指定できません";
  return errors;
}

export const BLOCK_REASON_LABEL: Record<string, string> = {
  consent_unknown: "利用許諾が確認できていないため発信できません",
  suppressed: "架電禁止リストに登録されているため発信できません",
  invalid_phone: "有効な電話番号がありません",
  outside_hours: "架電可能時間帯の外です",
  locked_by_other: "他の担当者が対応中です",
  closed: "対応が終了している顧客です",
  not_found: "顧客が見つかりません",
};
