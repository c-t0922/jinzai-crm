"use client";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  AlertTriangle, ArrowRight, CalendarClock, CheckCircle2, ExternalLink, Headphones, Keyboard, Loader2, Mic, MicOff,
  Copy, Phone, PhoneCall, PhoneMissed, PhoneOff, RefreshCw, SkipForward, WifiOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { ConsentBadge, ResultBadge, QueueBadge, SOURCE_LABEL, INTENT_LABEL, CATEGORY_TONE } from "@/components/status";
import { EmptyState } from "@/components/states";
import { cn } from "@/lib/utils";
import { fmtDate, fmtDateTime, fmtDuration } from "@/lib/format";
import { BLOCK_REASON_LABEL, fieldsFor, validateResult, type ResultMaster, type SaveResultInput } from "@/lib/call-result";
import { fromLocalInput, presetJst } from "@/lib/datetime-local";
import {
  endCall, getQueue, heartbeat, nextContact, openContact, releaseContact, reportCallStatus, saveDraft, saveResult, startCall, todayStats,
  type ContactCard,
} from "@/server/domain/calls/actions";
import { ManualDevice, MockDevice, type CallDevice, type DeviceStatus } from "./mock-device";
import { clearLocalDraft, pushPending, readLocalDraft, readPending, writeLocalDraft, writePending } from "./pending-queue";

type QueueItem = {
  id: string; name: string; area: string | null; queueState: string; nextCallAt: string | null; callCount: number;
  lastCallResult: string | null; rank: number; source: string; lockedByOther: boolean;
};
type Queue = { items: QueueItem[]; counts: Record<string, number> };
type Tab = "today" | "recall" | "new" | "untouched";
type CallState = {
  callLogId: string; status: "dialing" | DeviceStatus; startedAt: number; answeredAt: number | null; endedAt: number | null;
  displayNumber: string; isDemo: boolean; muted: boolean;
};
type FormState = {
  resultCode: string | null;
  hearing: { currentJob?: string; desiredTiming?: string; desiredJob?: string; desiredArea?: string };
  memo: string;
  nextCallAt: string;
  appt: { at: string; method: "online" | "phone" | "visit"; url: string; advisor: string; note: string };
};
const EMPTY_FORM: FormState = { resultCode: null, hearing: {}, memo: "", nextCallAt: "", appt: { at: "", method: "online", url: "", advisor: "", note: "" } };

const TABS: { key: Tab; label: string }[] = [
  { key: "today", label: "本日" },
  { key: "recall", label: "再架電" },
  { key: "new", label: "新規反響" },
  { key: "untouched", label: "未対応" },
];

const ACTION_LABEL: Record<string, string> = {
  recall: "再架電を予約しました",
  appointment: "アポイントを登録し、担当者へ引き継ぎました",
  suppressed: "架電禁止リストに登録しました",
  closed: "対応を終了しました",
  invalid_phone: "電話番号を無効にしました",
  consent_review: "利用許諾の確認タスクを作成しました",
};

function uuid() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
function isTyping(el: EventTarget | null) {
  const t = el as HTMLElement | null;
  return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
}

export function CallCenter(props: {
  masters: ResultMaster[];
  scripts: { id: string; title: string; body: string }[];
  advisors: { id: string; name: string }[];
  ctiMode: string;
  isDemo: boolean;
  callingHours?: { enforce: boolean; days: number[]; start: string; end: string };
  initialContactId?: string;
  userName: string;
}) {
  const { masters, scripts, advisors, isDemo } = props;
  const manual = props.ctiMode === "manual";
  const [tab, setTab] = useState<Tab>("today");
  const [queue, setQueue] = useState<Queue | null>(null);
  const [queueError, setQueueError] = useState(false);
  const [contact, setContact] = useState<ContactCard | null>(null);
  const [blockReason, setBlockReason] = useState<string | null>(null);
  const [loadingContact, setLoadingContact] = useState(false);
  const [noMore, setNoMore] = useState(false);
  const [call, setCall] = useState<CallState | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState(0);
  const online = useSyncExternalStore(
    (cb) => {
      window.addEventListener("online", cb);
      window.addEventListener("offline", cb);
      return () => {
        window.removeEventListener("online", cb);
        window.removeEventListener("offline", cb);
      };
    },
    () => navigator.onLine,
    () => true,
  );
  const [stats, setStats] = useState<{ calls: number; connects: number; appointments: number; goalAppointments: number | null; monthAppointments: number } | null>(null);
  const [scriptId, setScriptId] = useState<string | null>(scripts[0]?.id ?? null);
  const [centerTab, setCenterTab] = useState<"script" | "history">("script");
  const [mics, setMics] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [showKeys, setShowKeys] = useState(false);
  const [, startTransition] = useTransition();

  const device = useRef<CallDevice>(manual ? new ManualDevice() : new MockDevice());
  const dialKey = useRef<string>(uuid());
  const saveKey = useRef<string>(uuid());
  const dirty = useRef(false);
  const formRef = useRef(form);
  useEffect(() => {
    formRef.current = form;
  }, [form]);

  const master = useMemo(() => masters.find((m) => m.code === form.resultCode), [masters, form.resultCode]);
  const fields = fieldsFor(master);
  const inCall = !!call && (call.status === "dialing" || call.status === "ringing" || call.status === "in_progress");

  // ---------- データ取得 ----------
  const loadQueue = useCallback(async (t: Tab) => {
    const r = await getQueue(t);
    if (r.ok) {
      setQueue(r.data as Queue);
      setQueueError(false);
    } else setQueueError(true);
  }, []);
  const loadStats = useCallback(async () => {
    const r = await todayStats();
    if (r.ok) setStats(r.data);
  }, []);

  const resetForContact = useCallback((c: ContactCard | null) => {
    setCall(null);
    setErrors({});
    dialKey.current = uuid();
    saveKey.current = uuid();
    dirty.current = false;
    const local = c ? readLocalDraft<FormState>(c.id) : null;
    const server = (c?.draft as FormState | null) ?? null;
    setForm(local ?? server ?? EMPTY_FORM);
    setCenterTab("script");
  }, []);

  // 顧客の読み込みは最後に要求したものだけを反映する（連打・二重実行で古い応答が画面を上書きしないように）
  const loadSeq = useRef(0);
  const loadNext = useCallback(
    async (skip?: string | null) => {
      const seq = ++loadSeq.current;
      setLoadingContact(true);
      const r = await nextContact(skip ?? null);
      if (seq !== loadSeq.current) return;
      setLoadingContact(false);
      if (!r.ok) {
        toast.error("次の顧客を取得できませんでした。通信状態を確認してください。");
        return;
      }
      setContact(r.data.contact);
      setBlockReason(null);
      setNoMore(!r.data.contact);
      resetForContact(r.data.contact);
    },
    [resetForContact],
  );

  const open = useCallback(
    async (id: string) => {
      if (inCall) return toast.warning("通話中は顧客を切り替えられません");
      const seq = ++loadSeq.current;
      setLoadingContact(true);
      const r = await openContact(id);
      if (seq !== loadSeq.current) return;
      setLoadingContact(false);
      if (!r.ok) {
        toast.error(r.error === "locked_by_other" ? "他の担当者が対応中です" : "この顧客を開けませんでした");
        return;
      }
      setContact(r.data.contact);
      setBlockReason(r.data.blockReason ?? null);
      setNoMore(false);
      resetForContact(r.data.contact);
    },
    [inCall, resetForContact],
  );

  useEffect(() => {
    // サーバーからの取得開始（読み込み中表示の更新を含む）。外部データとの同期なので effect で行う
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadQueue(tab);
  }, [tab, loadQueue]);

  const booted = useRef(false);
  useEffect(() => {
    // 開発時の StrictMode で 2 回実行されてもロックを二重取得しない
    if (booted.current) return;
    booted.current = true;
    loadStats();
    // localStorage はクライアントでしか読めないため、マウント後に反映する（SSR との不一致を避ける）
    setPending(readPending().length);
    // 初回の顧客取得（外部データとの同期）
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (props.initialContactId) open(props.initialContactId);
    else loadNext();
    navigator.mediaDevices
      ?.enumerateDevices?.()
      .then((d) => setMics(d.filter((x) => x.kind === "audioinput").length))
      .catch(() => setMics(0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 通話時間表示・通話中は操作扱い（自動ログアウトしない）
  useEffect(() => {
    if (!inCall) return;
    const t = setInterval(() => {
      setNow(Date.now());
      window.dispatchEvent(new Event("crm:activity"));
    }, 1000);
    return () => clearInterval(t);
  }, [inCall]);

  // ロックのハートビート
  useEffect(() => {
    if (!contact) return;
    const id = contact.id;
    const t = setInterval(() => heartbeat(id), 120_000);
    const leave = () => navigator.sendBeacon?.("/api/v1/call-center/release", JSON.stringify({ contactId: id }));
    window.addEventListener("pagehide", leave);
    return () => {
      clearInterval(t);
      window.removeEventListener("pagehide", leave);
    };
  }, [contact]);

  // 入力途中の自動保存（3秒毎にローカル、10秒毎にサーバー）
  useEffect(() => {
    if (!contact) return;
    const id = contact.id;
    const local = setInterval(() => {
      if (dirty.current) writeLocalDraft(id, formRef.current);
    }, 3000);
    const remote = setInterval(() => {
      if (dirty.current) saveDraft(id, formRef.current as unknown as Record<string, unknown>);
    }, 10_000);
    return () => {
      clearInterval(local);
      clearInterval(remote);
    };
  }, [contact]);

  // 未送信の結果の再送
  const flushPending = useCallback(async () => {
    const items = readPending();
    if (!items.length) return;
    const rest: SaveResultInput[] = [];
    for (const it of items) {
      try {
        const r = await saveResult(it);
        if (!r.ok && r.error !== "ALREADY_RECORDED" && r.error !== "VALIDATION_ERROR" && r.error !== "FORBIDDEN") rest.push(it);
      } catch {
        rest.push(it);
      }
    }
    writePending(rest);
    setPending(rest.length);
    if (items.length && !rest.length) {
      toast.success("未送信だった架電結果を送信しました");
      loadStats();
    }
  }, [loadStats]);

  // 通信復帰時・15秒ごとに未送信の結果を再送
  useEffect(() => {
    const on = () => flushPending();
    window.addEventListener("online", on);
    const t = setInterval(flushPending, 15_000);
    return () => {
      window.removeEventListener("online", on);
      clearInterval(t);
    };
  }, [flushPending]);

  // ---------- 通話操作 ----------
  const onDeviceStatus = useCallback((callLogId: string, s: DeviceStatus) => {
    setCall((c) => {
      if (!c || c.callLogId !== callLogId) return c;
      const t = Date.now();
      return {
        ...c,
        status: s,
        answeredAt: s === "in_progress" ? t : c.answeredAt,
        endedAt: ["completed", "no_answer", "busy", "canceled", "failed"].includes(s) ? t : c.endedAt,
      };
    });
    reportCallStatus(callLogId, s);
    if (s === "no_answer") setForm((f) => (f.resultCode ? f : { ...f, resultCode: "no_answer" }));
    if (s === "busy") setForm((f) => (f.resultCode ? f : { ...f, resultCode: "busy" }));
  }, []);

  const dial = useCallback(async () => {
    if (!contact || inCall || call) return;
    if (blockReason) return toast.error(BLOCK_REASON_LABEL[blockReason] ?? "発信できません");
    setCall({ callLogId: "", status: "dialing", startedAt: Date.now(), answeredAt: null, endedAt: null, displayNumber: "", isDemo, muted: false });
    const r = await startCall({ contactId: contact.id, idempotencyKey: dialKey.current, scriptId });
    if (!r.ok) {
      setCall(null);
      const msg = r.error === "NOT_CALLABLE" ? BLOCK_REASON_LABEL[r.reason ?? ""] : r.error === "DUPLICATE_DIAL" ? "通話中の発信があります。先に終話してください。" : "発信に失敗しました";
      if (r.reason) setBlockReason(r.reason);
      if (r.error === "DUPLICATE_DIAL" && r.callLogId) {
        // ブラウザ終了・通信断で終了できていない通話が残っている場合、ここから終了できる
        const stale = r.callLogId;
        toast.error("終了していない通話が残っています", {
          description: "前の通話を終了してから、もう一度発信してください。",
          action: { label: "前の通話を終了", onClick: () => endCall(stale).then((x) => (x.ok ? toast.success("前の通話を終了しました") : toast.error("終了できませんでした"))) },
          duration: 15_000,
        });
        return;
      }
      toast.error(msg ?? "発信できません");
      return;
    }
    const callLogId = r.data.callLogId;
    setCall({ callLogId, status: "ringing", startedAt: Date.now(), answeredAt: null, endedAt: null, displayNumber: r.data.displayNumber, isDemo: r.data.isDemo, muted: false });
    device.current.dial((s) => onDeviceStatus(callLogId, s));
  }, [contact, inCall, call, blockReason, isDemo, scriptId, onDeviceStatus]);

  const hangup = useCallback(() => {
    if (!call || !inCall) return;
    device.current.hangup();
  }, [call, inCall]);

  const toggleMute = useCallback(() => {
    setCall((c) => {
      if (!c) return c;
      device.current.setMuted(!c.muted);
      return { ...c, muted: !c.muted };
    });
  }, []);

  // ---------- 結果保存 ----------
  const update = (patch: Partial<FormState>) => {
    dirty.current = true;
    setForm((f) => ({ ...f, ...patch }));
  };

  const save = useCallback(async () => {
    if (!contact || saving) return;
    if (inCall && call?.status !== "in_progress") return toast.warning("呼出中です。終話してから保存してください");
    const f = formRef.current;
    const m = masters.find((x) => x.code === f.resultCode);
    const input: SaveResultInput = {
      contactId: contact.id,
      callLogId: call?.callLogId || null,
      resultCode: f.resultCode ?? "",
      idempotencyKey: saveKey.current,
      hearing: Object.fromEntries(Object.entries(f.hearing).filter(([, v]) => v)),
      memo: f.memo || null,
      nextCallAt: fromLocalInput(f.nextCallAt),
      appointment: m?.auto_action?.type === "appointment"
        ? { scheduledAt: fromLocalInput(f.appt.at) ?? "", method: f.appt.method, meetingUrl: f.appt.url, advisorUserId: f.appt.advisor, note: f.appt.note }
        : null,
    };
    const errs = validateResult(m, input);
    if (input.appointment && !input.appointment.scheduledAt) delete input.appointment;
    setErrors(errs);
    if (Object.keys(errs).length) return;
    if (m?.code === "refused" && !window.confirm("この顧客を架電禁止リストに登録します。よろしいですか？")) return;
    if (inCall) device.current.hangup();

    setSaving(true);
    let res: Awaited<ReturnType<typeof saveResult>> | null = null;
    try {
      res = await saveResult(input);
    } catch {
      res = null; // 通信エラー
    }
    setSaving(false);
    if (!res) {
      setPending(pushPending(input));
      clearLocalDraft(contact.id);
      toast.warning("通信エラーのため結果を一時保存しました。復帰後に自動で送信します。");
    } else if (!res.ok) {
      if (res.error === "VALIDATION_ERROR") return setErrors({ [res.field === "appointment" ? "appointment" : res.field === "next_call_at" ? "nextCallAt" : "result"]: "入力内容を確認してください" });
      if (res.error === "ALREADY_RECORDED") toast.info("この通話の結果は既に登録されています");
      else return toast.error("保存できませんでした。もう一度お試しください。");
    } else {
      clearLocalDraft(contact.id);
      for (const a of res.data.actions) toast.success(ACTION_LABEL[a.type] ?? "保存しました", a.at ? { description: `次回：${fmtDateTime(a.at)}` } : undefined);
    }
    startTransition(() => {
      loadQueue(tab);
      loadStats();
    });
    await loadNext(contact.id);
  }, [contact, saving, inCall, call, masters, tab, loadQueue, loadStats, loadNext]);

  const skip = useCallback(async () => {
    if (!contact || inCall) return;
    if (call && !window.confirm("通話の結果が未登録です。スキップしますか？（架電記録は残ります）")) return;
    await releaseContact(contact.id);
    await loadNext(contact.id);
  }, [contact, inCall, call, loadNext]);

  // ---------- キーボード ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        save();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "e") {
        e.preventDefault();
        hangup();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (contact) {
          writeLocalDraft(contact.id, formRef.current);
          saveDraft(contact.id, formRef.current as unknown as Record<string, unknown>);
          toast.success("下書きを保存しました");
        }
        return;
      }
      if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === " ") {
        e.preventDefault();
        if (!call) dial();
        return;
      }
      if (e.key === "m" || e.key === "M") return toggleMute();
      if (e.key === "?") return setShowKeys((v) => !v);
      const m = masters.find((x) => x.shortcut_key && x.shortcut_key === e.key.toLowerCase());
      if (m) {
        dirty.current = true;
        setForm((f) => ({ ...f, resultCode: m.code }));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save, hangup, dial, toggleMute, masters, contact, call]);

  // ---------- 表示 ----------
  const elapsed = call ? Math.max(0, Math.floor(((call.endedAt ?? now) - (call.answeredAt ?? call.startedAt)) / 1000)) : 0;
  const script = scripts.find((s) => s.id === scriptId);
  const goalPct = stats?.goalAppointments ? Math.min(100, Math.round((stats.monthAppointments / stats.goalAppointments) * 100)) : null;

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      {/* ステータスバー */}
      <div className="flex h-10 shrink-0 items-center gap-4 overflow-x-auto whitespace-nowrap border-b border-border bg-white px-4 text-xs [&>*]:shrink-0">
        <span className="hidden font-semibold text-slate-900 sm:inline">架電センター</span>
        <span className="tabular text-slate-600">本日 架電 <b className="text-slate-900">{stats?.calls ?? "—"}</b></span>
        <span className="tabular text-slate-600">接続 <b className="text-slate-900">{stats?.connects ?? "—"}</b></span>
        <span className="tabular text-slate-600">アポ <b className="text-emerald-700">{stats?.appointments ?? "—"}</b></span>
        <span className="hidden items-center gap-2 lg:flex">
          <span className="text-slate-500">今月のアポ目標</span>
          <span className="h-1.5 w-24 overflow-hidden rounded bg-slate-100" aria-hidden>
            <span className="block h-full bg-accent-blue" style={{ width: `${goalPct ?? 0}%` }} />
          </span>
          <span className="tabular text-slate-700">{stats ? `${stats.monthAppointments} / ${stats.goalAppointments ?? "未設定"}` : "—"}</span>
        </span>
        <span className="ml-auto flex items-center gap-2">
          {pending > 0 ? <Badge tone="amber">未送信 {pending} 件</Badge> : null}
          {!online ? (
            <Badge tone="rose"><WifiOff className="size-3" /> オフライン</Badge>
          ) : null}
          {manual ? null : <span className={cn("hidden items-center gap-1 sm:flex", mics ? "text-slate-500" : "text-amber-700")} title="マイク・ヘッドセットの検出状況">
            <Headphones className="size-3.5" /> {mics === null ? "確認中" : mics > 0 ? `マイク ${mics}台` : "マイク未検出"}
          </span>}
          {isDemo ? <Badge tone="violet" data-testid="demo-badge" title="デモ通話（実際には発信されません）">デモ通話<span className="hidden sm:inline">（実際には発信されません）</span></Badge> : manual ? <Badge tone="navy" data-testid="manual-badge" title="手持ちの電話で発信し、結果をボタンで記録します">手持ち電話で発信</Badge> : <Badge tone="navy">実通話</Badge>}
          <button type="button" onClick={() => setShowKeys((v) => !v)} className="rounded p-1 text-slate-500 hover:bg-slate-100" aria-label="ショートカット一覧">
            <Keyboard className="size-4" />
          </button>
        </span>
      </div>

      {showKeys ? (
        <div className="border-b border-border bg-slate-50 px-4 py-2 text-xs text-slate-600">
          <b>ショートカット</b>：Space 発信 ／ Ctrl+E 終話 ／ M ミュート ／ 数字・英字キー 結果選択（ボタン右下の文字） ／ Ctrl+Enter 保存して次へ ／ Ctrl+S 下書き保存 ／ ? この一覧
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[250px_minmax(0,1fr)_340px]">
        {/* 左：キュー */}
        <section aria-label="架電リスト" className="hidden min-h-0 flex-col border-r border-border bg-white lg:flex">
          <div className="grid grid-cols-4 border-b border-border text-xs">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={cn("flex flex-col items-center py-1.5", tab === t.key ? "border-b-2 border-accent-blue font-semibold text-accent-blue" : "text-slate-500 hover:text-slate-800")}
                aria-pressed={tab === t.key}
              >
                {t.label}
                <span className="tabular text-[11px]">{queue?.counts?.[t.key] ?? "—"}</span>
              </button>
            ))}
          </div>
          <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto" data-testid="queue-list">
            {queueError ? (
              <li className="p-4 text-center text-xs text-rose-600">
                読み込みに失敗しました
                <Button size="sm" variant="outline" className="mt-2" onClick={() => loadQueue(tab)}>
                  <RefreshCw /> 再試行
                </Button>
              </li>
            ) : !queue ? (
              Array.from({ length: 8 }).map((_, i) => <li key={i} className="h-12 animate-pulse bg-slate-50" />)
            ) : queue.items.length === 0 ? (
              <li>
                <EmptyState title="対象の顧客はいません" description="リスト管理者に割り当てを依頼してください" />
              </li>
            ) : (
              queue.items.map((q) => (
                <li key={q.id}>
                  <button
                    type="button"
                    onClick={() => open(q.id)}
                    disabled={q.lockedByOther}
                    className={cn(
                      "flex w-full flex-col gap-0.5 px-3 py-2 text-left hover:bg-slate-50 disabled:opacity-50",
                      contact?.id === q.id && "bg-blue-50/70 hover:bg-blue-50",
                    )}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-[13px] font-medium">{q.name}</span>
                      {q.lockedByOther ? <Badge tone="slate">対応中</Badge> : q.source === "lp" && q.callCount === 0 ? <Badge tone="blue">新規</Badge> : null}
                    </span>
                    <span className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
                      <span>{q.area ?? "—"} ・ {q.callCount}回</span>
                      {q.nextCallAt ? (
                        <span className={cn("tabular", new Date(q.nextCallAt).getTime() <= now ? "text-amber-700" : "")}>
                          <CalendarClock className="mr-0.5 inline size-3" />
                          {fmtDateTime(q.nextCallAt)}
                        </span>
                      ) : null}
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
          <div className="border-t border-border px-3 py-2 text-xs text-slate-500">
            残り <b className="tabular text-slate-800">{queue?.counts?.total ?? "—"}</b> 件
          </div>
        </section>

        {/* 中央：顧客情報・架電操作 */}
        <section aria-label="顧客情報と架電操作" className="flex min-h-0 flex-col overflow-y-auto">
          {loadingContact && !contact ? (
            <div className="flex flex-1 items-center justify-center text-sm text-slate-500">
              <Loader2 className="mr-2 size-4 animate-spin" /> 次の顧客を読み込んでいます
            </div>
          ) : !contact ? (
            <EmptyState
              className="flex-1"
              title={noMore ? "架電可能な顧客がいません" : "顧客が選択されていません"}
              description={noMore ? "本日の割り当て分は終了したか、再架電予定の時刻前です。左のリストから選択することもできます。" : undefined}
              action={
                <Button variant="outline" size="sm" onClick={() => loadNext()}>
                  <RefreshCw /> 再読み込み
                </Button>
              }
            />
          ) : (
            <div className="flex flex-col gap-3 p-4">
              <div className="rounded-lg border border-border bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[11px] text-slate-500">{contact.kana}</p>
                    <h2 className="flex items-center gap-2 text-lg font-semibold" data-testid="contact-name">
                      {contact.name}
                      <Link href={`/contacts/${contact.id}`} target="_blank" className="text-slate-400 hover:text-accent-blue" aria-label="顧客詳細を別タブで開く">
                        <ExternalLink className="size-4" />
                      </Link>
                    </h2>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <ConsentBadge status={contact.consentStatus} />
                      <QueueBadge state={contact.queueState} />
                      {contact.isSuppressed ? <Badge tone="rose">架電禁止</Badge> : null}
                      {contact.jobChangeIntent ? <Badge tone="blue">{INTENT_LABEL[contact.jobChangeIntent] ?? contact.jobChangeIntent}</Badge> : null}
                      {contact.tags.map((t) => <Badge key={t}>{t}</Badge>)}
                    </div>
                  </div>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
                    <dt className="text-slate-500">電話</dt>
                    <dd className="tabular font-medium" data-testid="contact-phone">{call?.displayNumber || contact.phones[0]?.display || "—"}</dd>
                    <dt className="text-slate-500">エリア</dt>
                    <dd>{contact.area || "—"}</dd>
                    <dt className="text-slate-500">初回問合せ</dt>
                    <dd>{fmtDate(contact.firstInquiryAt)}</dd>
                    <dt className="text-slate-500">流入経路</dt>
                    <dd className="max-w-48 truncate">{SOURCE_LABEL[contact.source] ?? contact.source}{contact.sourceDetail ? ` / ${contact.sourceDetail}` : ""}</dd>
                    <dt className="text-slate-500">架電回数</dt>
                    <dd className="tabular">{contact.callCount} 回（最終 {fmtDateTime(contact.lastCalledAt)}）</dd>
                  </dl>
                </div>

                {blockReason ? (
                  <p role="alert" className="mt-3 flex items-center gap-2 rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700">
                    <AlertTriangle className="size-4" /> {BLOCK_REASON_LABEL[blockReason] ?? "発信できません"}
                  </p>
                ) : null}

                {/* 架電操作 */}
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
                  {!inCall ? (
                    <Button variant="success" size="lg" onClick={dial} disabled={!!call || !!blockReason || !online} data-testid="dial-button" className="min-w-36">
                      <Phone /> {call ? "通話終了" : "発信"} <kbd className="ml-1 rounded bg-white/20 px-1 text-[10px]">Space</kbd>
                    </Button>
                  ) : (
                    <Button variant="destructive" size="lg" onClick={hangup} data-testid="hangup-button" className="min-w-36">
                      <PhoneOff /> 終話 <kbd className="ml-1 rounded bg-white/20 px-1 text-[10px]">Ctrl+E</kbd>
                    </Button>
                  )}
                  {manual ? null : (
                    <Button variant="outline" onClick={toggleMute} disabled={!inCall} aria-pressed={call?.muted}>
                      {call?.muted ? <MicOff /> : <Mic />} {call?.muted ? "ミュート中" : "ミュート"}
                    </Button>
                  )}
                  <div className="ml-1 flex flex-col">
                    <span className="tabular text-xl font-semibold" data-testid="call-timer">{fmtDuration(elapsed)}</span>
                    <span className="text-[11px] text-slate-500" data-testid="call-status">
                      {!call ? "待機中" : call.status === "dialing" ? "発信準備中…" : call.status === "ringing" ? "呼び出し中…" : call.status === "in_progress" ? "通話中" :
                        call.status === "no_answer" ? "応答なし" : call.status === "busy" ? "話し中" : call.status === "failed" ? "発信失敗" : "通話終了"}
                      {call?.isDemo ? "（デモ）" : ""}
                    </span>
                  </div>
                  <Button variant="ghost" size="sm" className="ml-auto" onClick={skip} disabled={inCall}>
                    <SkipForward /> スキップ
                  </Button>
                </div>
                {manual && call && (call.status === "ringing" || call.status === "in_progress") && call.displayNumber ? (
                  <ManualDialPanel
                    number={call.displayNumber}
                    status={call.status}
                    onMark={(s) => (device.current as ManualDevice).mark(s)}
                  />
                ) : null}
              </div>

              {/* スクリプト／履歴 */}
              <div className="rounded-lg border border-border bg-white">
                <div className="flex items-center gap-1 border-b border-border px-2">
                  {(["script", "history"] as const).map((k) => (
                    <button key={k} type="button" onClick={() => setCenterTab(k)}
                      className={cn("px-3 py-2 text-xs", centerTab === k ? "border-b-2 border-accent-blue font-semibold text-accent-blue" : "text-slate-500")}>
                      {k === "script" ? "トークスクリプト" : `架電履歴（${contact.history.length}）`}
                    </button>
                  ))}
                  {centerTab === "script" && scripts.length > 1 ? (
                    <Select className="ml-auto h-7 w-auto text-xs" value={scriptId ?? ""} onChange={(e) => setScriptId(e.target.value)} aria-label="スクリプト選択">
                      {scripts.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
                    </Select>
                  ) : null}
                </div>
                <div className="max-h-[300px] overflow-y-auto p-4">
                  {centerTab === "script" ? (
                    script ? (
                      <div className="space-y-2 text-[13px] leading-relaxed">
                        {script.body.replaceAll("{担当者名}", props.userName).replaceAll("{顧客名}", contact.name).split("\n").map((line, i) =>
                          line.startsWith("## ") ? <h3 key={i} className="pt-1 text-xs font-semibold text-primary">{line.slice(3)}</h3>
                          : line.startsWith("- ") ? <p key={i} className="pl-3 text-slate-700">・{line.slice(2)}</p>
                          : line ? <p key={i} className="text-slate-800">{line}</p> : null,
                        )}
                      </div>
                    ) : <EmptyState title="スクリプトが登録されていません" />
                  ) : contact.history.length === 0 ? (
                    <EmptyState title="架電履歴はありません" />
                  ) : (
                    <ol className="space-y-2">
                      {contact.history.map((h, i) => (
                        <li key={i} className="flex gap-3 text-xs">
                          <span className="tabular w-24 shrink-0 text-slate-500">{fmtDateTime(h.at)}</span>
                          <span className="flex flex-col gap-0.5">
                            <span className="flex items-center gap-2"><ResultBadge code={h.result} /> <span className="text-slate-500">{h.user}</span>{h.durationSec ? <span className="tabular text-slate-400">{fmtDuration(h.durationSec)}</span> : null}</span>
                            {h.memo ? <span className="text-slate-700">{h.memo}</span> : null}
                          </span>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              </div>
            </div>
          )}
        </section>

        {/* 右：結果入力 */}
        <section aria-label="架電結果と次回アクション" className="flex min-h-0 flex-col border-l border-border bg-white">
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <p className="mb-2 text-xs font-semibold text-slate-700">架電結果</p>
            <div className="grid grid-cols-3 gap-1" role="radiogroup" aria-label="架電結果" aria-invalid={!!errors.result}>
              {masters.map((m) => {
                const active = form.resultCode === m.code;
                const tone = CATEGORY_TONE[m.category] ?? "slate";
                return (
                  <button
                    key={m.code}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    disabled={!contact}
                    onClick={() => update({ resultCode: m.code })}
                    data-result={m.code}
                    className={cn(
                      "relative h-9 rounded-md border px-1.5 text-left text-[11.5px] leading-tight transition-colors disabled:opacity-40",
                      active
                        ? { slate: "border-slate-500 bg-slate-100", amber: "border-amber-500 bg-amber-50 text-amber-900", blue: "border-blue-600 bg-blue-50 text-blue-800", emerald: "border-emerald-600 bg-emerald-50 text-emerald-800", rose: "border-rose-600 bg-rose-50 text-rose-800", violet: "border-violet-600 bg-violet-50 text-violet-800", navy: "" }[tone]
                        : "border-border hover:bg-slate-50",
                    )}
                  >
                    {m.label}
                    {m.shortcut_key ? <kbd className="absolute bottom-0.5 right-1 text-[9px] text-slate-400">{m.shortcut_key.toUpperCase()}</kbd> : null}
                  </button>
                );
              })}
            </div>
            {errors.result ? <p className="mt-1 text-xs text-rose-600" role="alert">{errors.result}</p> : null}

            {master ? (
              <div className="mt-3 space-y-3 border-t border-border pt-3">
                {fields.appointment ? (
                  <div className="space-y-2 rounded-md bg-emerald-50/60 p-2.5">
                    <p className="text-xs font-semibold text-emerald-800">アポイント</p>
                    <Field label="日時（必須）" htmlFor="appt-at" error={errors.appointment}>
                      <Input id="appt-at" type="datetime-local" value={form.appt.at} onChange={(e) => update({ appt: { ...form.appt, at: e.target.value } })} aria-invalid={!!errors.appointment} />
                    </Field>
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="形式" htmlFor="appt-method">
                        <Select id="appt-method" value={form.appt.method} onChange={(e) => update({ appt: { ...form.appt, method: e.target.value as FormState["appt"]["method"] } })}>
                          <option value="online">オンライン</option>
                          <option value="phone">電話</option>
                          <option value="visit">対面</option>
                        </Select>
                      </Field>
                      <Field label="面談担当（CA）" htmlFor="appt-advisor">
                        <Select id="appt-advisor" value={form.appt.advisor} onChange={(e) => update({ appt: { ...form.appt, advisor: e.target.value } })}>
                          <option value="">未定（PMへ通知）</option>
                          {advisors.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                        </Select>
                      </Field>
                    </div>
                    {form.appt.method === "online" ? (
                      <Field label="面談URL" htmlFor="appt-url">
                        <Input id="appt-url" type="url" placeholder="https://" value={form.appt.url} onChange={(e) => update({ appt: { ...form.appt, url: e.target.value } })} />
                      </Field>
                    ) : null}
                  </div>
                ) : null}

                {fields.nextCallAt ? (
                  <Field label={`次回架電日時${fields.required.has("next_call_at") ? "（必須）" : "（任意・空欄なら自動設定）"}`} htmlFor="next-call" error={errors.nextCallAt}>
                    <Input id="next-call" type="datetime-local" value={form.nextCallAt} onChange={(e) => update({ nextCallAt: e.target.value })} aria-invalid={!!errors.nextCallAt} />
                    <div className="flex gap-1">
                      {(["1h", "tomorrow", "3d", "1w"] as const).map((k) => (
                        <button key={k} type="button" onClick={() => update({ nextCallAt: presetJst(k) })} className="rounded border border-border px-1.5 py-0.5 text-[11px] text-slate-600 hover:bg-slate-50">
                          {{ "1h": "1時間後", tomorrow: "明日", "3d": "3日後", "1w": "1週間後" }[k]}
                        </button>
                      ))}
                    </div>
                  </Field>
                ) : null}

                {fields.hearing ? (
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="現在の職種" htmlFor="h-job">
                      <Input id="h-job" value={form.hearing.currentJob ?? ""} onChange={(e) => update({ hearing: { ...form.hearing, currentJob: e.target.value } })} />
                    </Field>
                    <Field label="転職希望時期" htmlFor="h-timing">
                      <Select id="h-timing" value={form.hearing.desiredTiming ?? ""} onChange={(e) => update({ hearing: { ...form.hearing, desiredTiming: e.target.value } })}>
                        <option value="">未確認</option>
                        <option>すぐにでも</option>
                        <option>3ヶ月以内</option>
                        <option>半年以内</option>
                        <option>1年以内</option>
                        <option>未定</option>
                      </Select>
                    </Field>
                    <Field label="希望職種" htmlFor="h-desired">
                      <Input id="h-desired" value={form.hearing.desiredJob ?? ""} onChange={(e) => update({ hearing: { ...form.hearing, desiredJob: e.target.value } })} />
                    </Field>
                    <Field label="希望勤務地" htmlFor="h-area">
                      <Input id="h-area" value={form.hearing.desiredArea ?? ""} onChange={(e) => update({ hearing: { ...form.hearing, desiredArea: e.target.value } })} />
                    </Field>
                  </div>
                ) : null}

                {fields.memo || fields.hearing || fields.appointment ? (
                  <Field label={`メモ${fields.required.has("memo") ? "（必須）" : ""}`} htmlFor="memo" error={errors.memo}>
                    <Textarea id="memo" rows={3} value={form.memo} onChange={(e) => update({ memo: e.target.value })} aria-invalid={!!errors.memo} placeholder={master.code === "complaint" ? "クレーム内容を記録してください" : "引き継ぎ事項など"} />
                  </Field>
                ) : null}

                <p className="rounded bg-slate-50 px-2 py-1.5 text-[11px] text-slate-600">
                  <CheckCircle2 className="mr-1 inline size-3 text-slate-400" />
                  保存すると：{
                    { recall: "再架電キューに登録", appointment: "アポイント登録・CAへ引き継ぎ", suppress: "架電禁止リストに即時登録", close: "対応終了", invalid_phone: "電話番号を無効化して終了", consent_review: "架電不可に戻し許諾確認タスク作成", keep: "次回日時で再架電に登録" }[master.auto_action?.type ?? "keep"] ?? "記録のみ"
                  }
                </p>
              </div>
            ) : (
              <p className="mt-3 text-xs text-slate-400">結果を選ぶと、必要な入力欄だけが表示されます。</p>
            )}
          </div>
          <div className="border-t border-border p-3">
            <Button className="w-full" size="lg" onClick={save} disabled={!contact || !form.resultCode || saving || (inCall && call?.status !== "in_progress")} data-testid="save-next">
              {saving ? <Loader2 className="animate-spin" /> : null}
              保存して次の顧客へ <ArrowRight /> <kbd className="ml-1 rounded bg-white/20 px-1 text-[10px]">Ctrl+Enter</kbd>
            </Button>
            <p className="mt-1 text-center text-[11px] text-slate-400">次の顧客を表示しても自動では発信しません</p>
          </div>
        </section>
      </div>
    </div>
  );
}

/** 手持ち電話での発信：番号を大きく表示し（スマホではタップで発信）、つながった／不在／話し中を記録する */
function ManualDialPanel({ number, status, onMark }: { number: string; status: string; onMark: (s: "in_progress" | "no_answer" | "busy") => void }) {
  const tel = number.replace(/[^\d+]/g, "");
  return (
    <div className="mt-3 rounded-md border border-accent-blue/30 bg-blue-50/60 p-3" data-testid="manual-panel">
      <p className="text-xs text-slate-600">{status === "ringing" ? "お手元の電話でこの番号にかけてください" : "通話中です。終わったら「終話」を押してください"}</p>
      <div className="mt-1 flex flex-wrap items-center gap-3">
        <a href={`tel:${tel}`} className="tabular text-2xl font-semibold tracking-wide text-accent-blue underline-offset-4 hover:underline" data-testid="manual-number">{number}</a>
        <Button size="sm" variant="outline" onClick={() => navigator.clipboard?.writeText(tel).then(() => toast.success("番号をコピーしました"), () => toast.error("コピーできませんでした"))}>
          <Copy /> コピー
        </Button>
      </div>
      {status === "ringing" ? (
        <div className="mt-2 flex flex-wrap gap-2">
          <Button variant="success" onClick={() => onMark("in_progress")} data-testid="manual-answered"><PhoneCall /> つながった</Button>
          <Button variant="outline" onClick={() => onMark("no_answer")} data-testid="manual-no-answer"><PhoneMissed /> 不在</Button>
          <Button variant="outline" onClick={() => onMark("busy")} data-testid="manual-busy"><PhoneOff /> 話し中</Button>
        </div>
      ) : null}
    </div>
  );
}
