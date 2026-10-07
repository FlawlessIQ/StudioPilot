"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { UndoSend, type HeldSend } from "@/components/communications/undo-send";

/**
 * "Sending your reply to Albert… Undo", wherever a draft was approved.
 *
 * An approved reply's card used to stay open on "Queued to send" with a Done
 * button, and Gabe read the second step as the send not having happened ("had
 * to hit reply twice", GR 2026-10-07). The card now closes as it sends, so
 * what was sent has to be said somewhere that outlives it: here, mounted once
 * in the studio shell. Today keeps its own stack, which can also bring its
 * card back on Undo.
 */
type Entry = HeldSend & { key: string };

let entries: Entry[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

/** Say a send is on its way; with a hold window, offer Undo for it. */
export function announceHeldSend(send: HeldSend | { label: string }) {
  const held: HeldSend =
    "emailJobId" in send ? send : { emailJobId: "", windowMs: 0, label: send.label };
  const key = held.emailJobId || `sent_${Date.now()}`;
  entries = [...entries.filter((entry) => entry.key !== key), { ...held, key }];
  emit();
}

function release(key: string) {
  entries = entries.filter((entry) => entry.key !== key);
  emit();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const snapshot = () => entries;
const serverSnapshot = (): Entry[] => [];

/** Plain "Sent" notes stay this long; held sends last their undo window. */
const NOTE_MS = 4_000;

export function HeldSendStack() {
  const current = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  if (!current.length) return null;
  return (
    <div className="today-undo-stack">
      {current.map((entry) =>
        entry.emailJobId && entry.windowMs > 0 ? (
          <UndoSend
            buttonClassName="today-undo-button"
            className="today-undo-send"
            held={entry}
            key={entry.key}
            onGone={() => release(entry.key)}
            onUndone={() => release(entry.key)}
          />
        ) : (
          <SentNote entry={entry} key={entry.key} />
        ),
      )}
    </div>
  );
}

function SentNote({ entry }: { entry: Entry }) {
  useTimeout(() => release(entry.key), NOTE_MS);
  return (
    <div className="today-undo-send" role="status">
      <span>Sent {entry.label}.</span>
    </div>
  );
}

function useTimeout(callback: () => void, ms: number) {
  const latest = useRef(callback);
  useEffect(() => {
    latest.current = callback;
  }, [callback]);
  useEffect(() => {
    const timer = window.setTimeout(() => latest.current(), ms);
    return () => window.clearTimeout(timer);
  }, [ms]);
}
