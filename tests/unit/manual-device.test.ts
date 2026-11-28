import { describe, expect, it } from "vitest";
import { ManualDevice, type DeviceStatus } from "@/features/call-center/mock-device";

describe("手持ち電話での発信（ManualDevice）", () => {
  const run = (steps: (d: ManualDevice) => void) => {
    const seen: DeviceStatus[] = [];
    const d = new ManualDevice();
    d.dial((s) => seen.push(s));
    steps(d);
    return seen;
  };
  it("つながった → 終話", () => expect(run((d) => { d.mark("in_progress"); d.hangup(); })).toEqual(["ringing", "in_progress", "completed"]));
  it("不在", () => expect(run((d) => d.mark("no_answer"))).toEqual(["ringing", "no_answer"]));
  it("呼び出し中に終話は取り消し", () => expect(run((d) => d.hangup())).toEqual(["ringing", "canceled"]));
  it("通話中に不在は押せない", () => expect(run((d) => { d.mark("in_progress"); d.mark("busy"); })).toEqual(["ringing", "in_progress"]));
});
