import "server-only";
import type { CtiProvider } from "./types";

/**
 * 手動発信（担当者の手持ち電話で発信する）。システムからは発信しない。
 * 発信ボタンで架電記録を作り、番号を表示する。つながった／不在／話し中／終話は担当者がボタンで記録する。
 * 実際の通話として集計する（isDemo=false）。
 */
export const manualCtiProvider: CtiProvider = {
  name: "manual",
  isDemo: false,
  async issueClientToken() {
    return { token: "manual", expiresAt: new Date(Date.now() + 3600_000) };
  },
  async dial({ callLogId }) {
    return { providerCallId: `manual-${callLogId}` };
  },
  async hangup() {},
  async verifyWebhook() {
    return false;
  },
  async parseStatusEvent() {
    throw new Error("manual provider does not receive webhooks");
  },
};
