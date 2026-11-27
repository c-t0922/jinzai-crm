import "server-only";
import type { CtiProvider } from "./types";

/**
 * Twilio 実装（Phase 2：P2-CTI-01）。認証情報が未設定の間は使用できない。
 * 実装時は Voice SDK のアクセストークン発行、REST での発信、X-Twilio-Signature の検証を行う。
 */
export const twilioCtiProvider: CtiProvider = {
  name: "twilio",
  isDemo: false,
  async issueClientToken() {
    throw new Error("Twilio は Phase 2 で実装予定です（CTI_MODE=mock を使用してください）");
  },
  async dial() {
    throw new Error("Twilio は Phase 2 で実装予定です");
  },
  async hangup() {
    throw new Error("Twilio は Phase 2 で実装予定です");
  },
  async verifyWebhook() {
    return false;
  },
  async parseStatusEvent() {
    throw new Error("Twilio は Phase 2 で実装予定です");
  },
};
