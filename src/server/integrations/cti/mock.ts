import "server-only";
import type { CtiProvider } from "./types";

/**
 * モック CTI。実際の発信は一切行わない。
 * 通話の進行（呼出→応答/不在/話し中）はブラウザ側のモック端末がシミュレーションし、ステータスを API に報告する。
 */
export const mockCtiProvider: CtiProvider = {
  name: "mock",
  isDemo: true,
  async issueClientToken() {
    return { token: "mock-token", expiresAt: new Date(Date.now() + 3600_000) };
  },
  async dial({ callLogId }) {
    return { providerCallId: `mock-${callLogId}` };
  },
  async hangup() {},
  async verifyWebhook() {
    return false; // モックは外部 Webhook を受け付けない
  },
  async parseStatusEvent() {
    throw new Error("mock provider does not receive webhooks");
  },
};
