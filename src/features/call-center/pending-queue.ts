"use client";
import type { SaveResultInput } from "@/lib/call-result";

/** 通信エラー時に未送信の架電結果を保持し、復帰後に再送する（冪等キーで二重登録されない） */
const KEY = "crm:pending-results";

export function readPending(): SaveResultInput[] {
  try {
    return JSON.parse(window.localStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function writePending(items: SaveResultInput[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    // ストレージが使えない環境では保持できない（画面に未送信件数は表示される）
  }
}

export function pushPending(item: SaveResultInput) {
  const items = readPending().filter((i) => i.idempotencyKey !== item.idempotencyKey);
  items.push(item);
  writePending(items);
  return items.length;
}

export function draftKey(contactId: string) {
  return `crm:draft:${contactId}`;
}

export function readLocalDraft<T>(contactId: string): T | null {
  try {
    const v = window.localStorage.getItem(draftKey(contactId));
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}

export function writeLocalDraft(contactId: string, v: unknown) {
  try {
    window.localStorage.setItem(draftKey(contactId), JSON.stringify(v));
  } catch {}
}

export function clearLocalDraft(contactId: string) {
  try {
    window.localStorage.removeItem(draftKey(contactId));
  } catch {}
}
