"use client";
/**
 * ブラウザ側のモック通話端末。実際には発信しない（デモ通話）。
 * Twilio Voice SDK の Device と同じく「状態イベントを発火する」役割だけを持ち、差し替え可能にしている。
 * E2E や動作確認では localStorage "crm:mock-outcome" に answer / no_answer / busy を入れると結果を固定できる。
 */
export type DeviceStatus = "ringing" | "in_progress" | "completed" | "no_answer" | "busy" | "canceled" | "failed";

export interface CallDevice {
  dial(onStatus: (s: DeviceStatus) => void): void;
  hangup(): void;
  setMuted(m: boolean): void;
}

export class MockDevice implements CallDevice {
  private timers: ReturnType<typeof setTimeout>[] = [];
  private status: DeviceStatus | null = null;
  private onStatus: ((s: DeviceStatus) => void) | null = null;

  dial(onStatus: (s: DeviceStatus) => void) {
    this.onStatus = onStatus;
    this.emit("ringing");
    let forced: string | null = null;
    try {
      forced = window.localStorage.getItem("crm:mock-outcome");
    } catch {
      forced = null;
    }
    const r = Math.random();
    const outcome = forced ?? (r < 0.65 ? "answer" : r < 0.9 ? "no_answer" : "busy");
    const delay = forced ? 800 : 1500 + Math.random() * 2000;
    this.timers.push(
      setTimeout(() => {
        if (outcome === "answer") this.emit("in_progress");
        else if (outcome === "busy") this.emit("busy");
        else this.emit("no_answer");
      }, delay),
    );
  }

  hangup() {
    this.timers.forEach(clearTimeout);
    this.timers = [];
    if (this.status === "in_progress") this.emit("completed");
    else if (this.status === "ringing") this.emit("canceled");
  }

  setMuted() {}

  private emit(s: DeviceStatus) {
    this.status = s;
    this.onStatus?.(s);
  }
}

/**
 * 手動発信の端末。担当者が手持ちの電話でかけ、結果をボタンで記録する。
 * dial で「呼び出し中」にし、mark で「通話中・不在・話し中」、hangup で終話にする。
 */
export class ManualDevice implements CallDevice {
  private status: DeviceStatus | null = null;
  private onStatus: ((s: DeviceStatus) => void) | null = null;

  dial(onStatus: (s: DeviceStatus) => void) {
    this.onStatus = onStatus;
    this.emit("ringing");
  }

  mark(s: "in_progress" | "no_answer" | "busy") {
    if (this.status !== "ringing") return;
    this.emit(s);
  }

  hangup() {
    if (this.status === "in_progress") this.emit("completed");
    else if (this.status === "ringing") this.emit("canceled");
  }

  setMuted() {}

  private emit(s: DeviceStatus) {
    this.status = s;
    this.onStatus?.(s);
  }
}
