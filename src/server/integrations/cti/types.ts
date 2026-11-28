/** CTI 抽象化（docs/07 §4）。特定サービスに依存しないよう、ここ以外から Twilio 等を直接呼ばない。 */
export type CallStatus = "initiating" | "ringing" | "in_progress" | "completed" | "failed" | "no_answer" | "busy" | "canceled";

export interface CallStatusEvent {
  providerCallId: string;
  status: CallStatus;
  occurredAt: Date;
}

export interface CtiProvider {
  readonly name: "mock" | "twilio";
  /** デモ通話（実際には発信しない）なら true。画面に「デモ通話」と常時表示する */
  readonly isDemo: boolean;
  issueClientToken(userId: string): Promise<{ token: string; expiresAt: Date }>;
  dial(input: { callLogId: string; toE164: string }): Promise<{ providerCallId: string }>;
  hangup(providerCallId: string): Promise<void>;
  verifyWebhook(req: Request): Promise<boolean>;
  parseStatusEvent(req: Request): Promise<CallStatusEvent>;
}
