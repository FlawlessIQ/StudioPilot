"use client";

import { useSyncExternalStore } from "react";

const noop = () => () => {};
const onClient = () => true;
const onServer = () => false;

/**
 * Whether the client has hydrated, so a control cannot fire against handlers
 * that are not attached yet.
 *
 * Five components reached for `requestAnimationFrame` to answer this, and
 * Chrome does not run animation frames in a background tab. A page opened in
 * one — cmd-clicked from an email, or restored with a session — rendered its
 * primary button permanently disabled with nothing saying why, until the tab
 * was focused. It was diagnosed and fixed twice, in the delivery form and the
 * event-day copilot, and the sweep never happened: the crew workspace's
 * Accept, Decline, Acknowledge schedule and Download calendar buttons were all
 * still gated on a frame, which is every action a subcontractor has.
 *
 * `useSyncExternalStore` is the hydration flag without the race: false in the
 * server snapshot, true on the client, no effect and no frame to miss. The
 * subscribe function is a no-op because the answer never changes again.
 *
 * Use this rather than writing the pattern a sixth time.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(noop, onClient, onServer);
}
