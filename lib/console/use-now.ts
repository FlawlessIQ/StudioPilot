"use client";

import { useSyncExternalStore } from "react";

/**
 * The current time for rendering "3d ago" and "ends in 2d", shared by every
 * Console component and refreshed every 30 seconds. Reading the clock inside
 * a render makes renders impure; this reads it in a timer instead.
 */
let now = Date.now();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function tick() {
  now = Date.now();
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!timer) {
    timer = setInterval(tick, 30_000);
    // Catch up at once: the module may have loaded long before this page.
    queueMicrotask(tick);
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

export function useNow(): number {
  return useSyncExternalStore(
    subscribe,
    () => now,
    () => now,
  );
}
