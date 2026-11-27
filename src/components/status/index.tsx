import { Badge, type Tone } from "@/components/ui/badge";

/** ステータス色の一元定義（docs/03 §4） */
export const CATEGORY_TONE: Record<string, Tone> = {
  untouched: "slate",
  unreachable: "amber",
  progress: "blue",
  success: "emerald",
  stop: "rose",
  review: "violet",
};

export const RESULT_CATEGORY: Record<string, string> = {
  not_called: "untouched",
  no_answer: "unreachable",
  voicemail: "unreachable",
  busy: "unreachable",
  other_person: "unreachable",
  invalid_number: "stop",
  connected: "progress",
  intent_yes: "progress",
  intent_future: "progress",
  callback: "progress",
  appointment: "success",
  intent_no: "stop",
  out_of_scope: "stop",
  complaint: "stop",
  refused: "stop",
  consent_unknown: "review",
};

export const RESULT_LABEL: Record<string, string> = {
  not_called: "未架電",
  no_answer: "不在",
  voicemail: "留守番電話",
  busy: "話し中",
  other_person: "本人以外が応答",
  connected: "接続・ヒアリング済み",
  intent_yes: "転職意向あり",
  intent_future: "将来的に転職を検討",
  callback: "再架電希望",
  appointment: "アポイント獲得",
  intent_no: "転職意向なし",
  invalid_number: "電話番号不通",
  out_of_scope: "対象外",
  complaint: "クレーム",
  refused: "架電拒否",
  consent_unknown: "利用許諾未確認",
};

export function ResultBadge({ code }: { code: string | null | undefined }) {
  if (!code) return <Badge tone="slate">未架電</Badge>;
  return <Badge tone={CATEGORY_TONE[RESULT_CATEGORY[code] ?? "untouched"]}>{RESULT_LABEL[code] ?? code}</Badge>;
}

const CONSENT: Record<string, [string, Tone]> = {
  granted: ["許諾済", "emerald"],
  unknown: ["許諾未確認", "violet"],
  denied: ["不許諾", "rose"],
  withdrawn: ["撤回", "rose"],
};
export function ConsentBadge({ status }: { status: string }) {
  const [label, tone] = CONSENT[status] ?? [status, "slate"];
  return <Badge tone={tone}>{label}</Badge>;
}

const QUEUE: Record<string, [string, Tone]> = {
  new: ["未対応", "slate"],
  recall: ["再架電", "amber"],
  appointed: ["アポ獲得", "emerald"],
  closed: ["クローズ", "rose"],
};
export function QueueBadge({ state }: { state: string }) {
  const [label, tone] = QUEUE[state] ?? [state, "slate"];
  return <Badge tone={tone}>{label}</Badge>;
}

export const APPT_STATUS: Record<string, [string, Tone]> = {
  scheduled: ["予定", "blue"],
  rescheduled: ["日程変更", "blue"],
  done: ["実施済", "emerald"],
  no_show: ["未実施", "amber"],
  canceled: ["キャンセル", "rose"],
};
export function ApptBadge({ status }: { status: string }) {
  const [label, tone] = APPT_STATUS[status] ?? [status, "slate"];
  return <Badge tone={tone}>{label}</Badge>;
}

export const APPT_METHOD: Record<string, string> = { online: "オンライン", phone: "電話", visit: "対面" };

export const SOURCE_LABEL: Record<string, string> = { kintone: "kintone（住宅）", lp: "人材LP", manual: "手動登録" };

export const INTENT_LABEL: Record<string, string> = {
  consult_wanted: "転職相談希望",
  yes: "意向あり",
  future: "将来検討",
  no: "意向なし",
};
