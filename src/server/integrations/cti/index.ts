import "server-only";
import { manualCtiProvider } from "./manual";
import { mockCtiProvider } from "./mock";
import { twilioCtiProvider } from "./twilio";
import type { CtiProvider } from "./types";

/**
 * CTI_MODE: mock（デモ通話・開発用）| manual（手持ち電話で発信）| twilio（Phase 2）。
 * 本番で未設定なら manual（本番の架電がデモ通話として記録されないように）。
 */
export function getCtiProvider(): CtiProvider {
  const mode = process.env.CTI_MODE ?? (process.env.NODE_ENV === "production" ? "manual" : "mock");
  if (mode === "manual") return manualCtiProvider;
  if (mode === "twilio") {
    const ok = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_API_KEY_SID && process.env.TWILIO_API_KEY_SECRET;
    // 認証情報が無い場合は手動発信（実通話とデモ通話を混同させない）
    return ok ? twilioCtiProvider : manualCtiProvider;
  }
  return mockCtiProvider;
}

export type { CtiProvider, CallStatus } from "./types";
