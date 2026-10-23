import { logger } from "firebase-functions/v2";

/**
 * Retries for the booking triggers, without retrying for ever.
 *
 * bookingProposalAccepted, bookingContractCompleted and bookingRetainerPaid
 * had no `retry`: one failed delivery (a Firestore blip, an instance that died,
 * the 2026-10-22 outage) and the event was gone — a paid deposit that never
 * booked the job. Now a failure is retried, but only while it can still help:
 *
 * - our own coded errors ("PACKAGE_SNAPSHOT_NOT_FOUND") are permanent: alert,
 *   don't retry (a retrying trigger re-runs for up to 7 days);
 * - anything else (contention, unavailable, a crash) is retried for two hours,
 *   then alerts.
 *
 * Every handler here is idempotent (stable ids, transactions), which is what
 * makes retrying safe.
 */
export const BOOKING_TRIGGER_RETRY_WINDOW_MS = 2 * 60 * 60 * 1000;

/** "PACKAGE_SNAPSHOT_NOT_FOUND", "INVALID_BOOKING_STATE: …": decided, not transient. */
export function isPermanentTriggerError(message: string): boolean {
  return /^[A-Z][A-Z0-9_]{3,}(?::|$)/.test(message);
}

export async function retryingTrigger(
  name: string,
  event: { time?: string; id?: string },
  run: () => Promise<void>,
  now = Date.now(),
): Promise<void> {
  try {
    await run();
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    const age = now - Date.parse(event.time ?? "");
    const permanent = isPermanentTriggerError(message);
    if (permanent || !(age < BOOKING_TRIGGER_RETRY_WINDOW_MS)) {
      logger.error(`${name}Failed`, {
        studiocueOperationalError: true,
        code: permanent ? message.split(":")[0] : "BOOKING_TRIGGER_GAVE_UP",
        trigger: name,
        eventId: event.id ?? null,
        error: message.slice(0, 300),
      });
      return;
    }
    logger.warn(`${name}Retrying`, { trigger: name, eventId: event.id ?? null, error: message.slice(0, 300) });
    throw caught;
  }
}
