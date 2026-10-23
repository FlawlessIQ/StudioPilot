import { createHash } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { studioNotificationAddress } from "../communications/notify-address.js";

/**
 * Telling a studio its connection to another app broke.
 *
 * FlawlessIQ's Google Calendar refresh failed on Oct 12; the connection was
 * marked "error" and Today grew a quiet card, but nobody was told, and for
 * three days booked calls didn't reach the calendar (found 2026-10-15). This
 * emails the studio once, at the moment provider-runtime marks the connection
 * broken — that happens once per break, because a connection marked "error"
 * is never loaded again until the studio reconnects.
 *
 * The consequences are a copy of features/integrations/connection-consequence.ts;
 * tests/connection-alert.test.ts keeps the two equal.
 */
export const CONNECTION_CONSEQUENCES: Record<string, { label: string; stops: string }> = {
  google_calendar: {
    label: "Google Calendar",
    stops: "Calls clients book won't go on your calendar, and your booking links won't offer clients any times until you reconnect.",
  },
  outlook_calendar: {
    label: "Outlook Calendar",
    stops: "Calls clients book won't go on your calendar, and your booking links won't offer clients any times until you reconnect.",
  },
  apple_calendar: {
    label: "Apple Calendar",
    stops: "Calls clients book won't go on your calendar, and your booking links won't offer clients any times until you reconnect.",
  },
  zoom: { label: "Zoom", stops: "New calls won't get a Zoom link, and call summaries won't come back." },
  quickbooks: { label: "QuickBooks", stops: "Invoices won't be created in QuickBooks, and payments won't be marked paid." },
  stripe: { label: "Stripe", stops: "Invoices won't be created in Stripe, and payments won't be marked paid." },
  dropbox: { label: "Dropbox", stops: "Signed agreements and files won't be saved to your Dropbox." },
  dropbox_sign: { label: "Dropbox Sign", stops: "Agreements can't go out for signature through Dropbox Sign." },
  docusign: { label: "Docusign", stops: "Agreements can't go out for signature through Docusign." },
};

export async function queueConnectionBrokenAlert(
  db: Firestore,
  input: { tenantId: string; provider: string; connectedAt: string | null; code: string; now: string },
): Promise<void> {
  const recipient = await studioNotificationAddress(db, input.tenantId).catch(() => null);
  if (!recipient) {
    console.warn("connection alert: no studio address", { tenantId: input.tenantId, provider: input.provider });
    return;
  }
  const consequence = CONNECTION_CONSEQUENCES[input.provider] ?? {
    label: input.provider.replace(/_/g, " "),
    stops: "StudioCue can't use it until you reconnect.",
  };
  // One email per break: the same connection, connected at the same time.
  const id = `studio_connection_${createHash("sha256").update(`${input.tenantId}:${input.provider}:${input.connectedAt ?? ""}`).digest("hex").slice(0, 32)}`;
  const reference = db.doc(`emailJobs/${id}`);
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "https://studio-cue.com").replace(/\/$/, "");
  await db.runTransaction(async (transaction) => {
    if ((await transaction.get(reference)).exists) return;
    transaction.create(reference, {
      id,
      tenantId: input.tenantId,
      projectId: null,
      type: "studio_connection_broken",
      recipient,
      provider: input.provider,
      providerLabel: consequence.label,
      stops: consequence.stops,
      reasonCode: input.code,
      actionUrl: `${appUrl}/studio/integrations`,
      status: "queued",
      attempts: 0,
      createdAt: input.now,
      updatedAt: input.now,
    });
  });
}
