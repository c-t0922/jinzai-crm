import { describe, expect, it } from "vitest";
import { fieldsFor, saveResultSchema, validateResult, type ResultMaster } from "@/lib/call-result";

const m = (code: string, required: string[] = [], optional: string[] = []): ResultMaster => ({
  code, label: code, category: "progress", is_connected: true, required_fields: required, optional_fields: optional, auto_action: {}, shortcut_key: null, sort_order: 0,
});
const future = new Date(Date.now() + 86400_000).toISOString().replace("Z", "+00:00");
const past = new Date(Date.now() - 86400_000).toISOString().replace("Z", "+00:00");

describe("架電結果の入力チェック", () => {
  it("結果未選択はエラー", () => expect(validateResult(undefined, {})).toHaveProperty("result"));
  it("アポ獲得は日時必須", () => {
    expect(validateResult(m("appointment", ["appointment"]), {})).toHaveProperty("appointment");
    expect(validateResult(m("appointment", ["appointment"]), { appointment: { scheduledAt: future, method: "online" } })).toEqual({});
  });
  it("過去日時は不可", () => {
    expect(validateResult(m("appointment", ["appointment"]), { appointment: { scheduledAt: past, method: "online" } }).appointment).toMatch(/過去/);
    expect(validateResult(m("no_answer", [], ["next_call_at"]), { nextCallAt: past }).nextCallAt).toMatch(/過去/);
  });
  it("再架電希望は次回日時必須", () => {
    expect(validateResult(m("recall", ["next_call_at"]), {})).toHaveProperty("nextCallAt");
  });
  it("表示項目は必須＋任意", () => {
    const f = fieldsFor(m("connected", [], ["hearing", "memo"]));
    expect(f.hearing && f.memo).toBe(true);
    expect(f.appointment).toBe(false);
  });
  it("API スキーマ：冪等キー必須・UUID 検証", () => {
    expect(saveResultSchema.safeParse({ contactId: "x", callLogId: null, resultCode: "no_answer", idempotencyKey: "12345678" }).success).toBe(false);
    expect(saveResultSchema.safeParse({ contactId: crypto.randomUUID(), callLogId: null, resultCode: "no_answer" }).success).toBe(false);
    expect(saveResultSchema.safeParse({ contactId: crypto.randomUUID(), callLogId: null, resultCode: "no_answer", idempotencyKey: crypto.randomUUID() }).success).toBe(true);
  });
});
