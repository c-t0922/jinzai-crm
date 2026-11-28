import "server-only";
import { mockCtiProvider } from "./mock";
import { twilioCtiProvider } from "./twilio";
import type { CtiProvider } from "./types";

export function getCtiProvider(): CtiProvider {
  const mode = process.env.CTI_MODE ?? "mock";
  if (mode === "twilio") {
    const ok = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_API_KEY_SID && process.env.TWILIO_API_KEY_SECRET;
    // 認証情報が無い場合は必ずモック（実通話とデモ通話を混同させない）
    return ok ? twilioCtiProvider : mockCtiProvider;
  }
  return mockCtiProvider;
}

export type { CtiProvider, CallStatus } from "./types";
