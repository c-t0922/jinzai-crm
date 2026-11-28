import { defineConfig, devices } from "@playwright/test";

// 前提：ローカル Supabase 起動済み（pnpm db:start）＋ 架空データ投入済み（pnpm db:reset）
// 業務シナリオはデータを順に変更するため直列で実行する
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000",
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
    viewport: { width: 1366, height: 768 },
    trace: "off",
    // 事前にブラウザを用意している環境ではそのパスを使う（例：PW_CHROMIUM_PATH=/opt/pw-browsers/chromium）
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 768 } } }],
  webServer: {
    command: "MFA_ENFORCE=false pnpm dev -p 3000",
    url: "http://127.0.0.1:3000/login",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
