import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { connection } from "../operations/provider-runtime.js";

/**
 * A call deleted or moved in the studio's Google Calendar, read back
 * (docs/roadmap.md, "Google Calendar inbound sync").
 *
 * StudioCue writes each call to the studio's calendar and never read it back,
 * so a studio that deleted a call in Google left it booked here, with the
 * client holding its confirmation. Google is not authoritative over a booking
 * (docs/booking-gate.md): what it says is evidence, and the owner decides. So
 * this never cancels or moves a call. It marks the call (`calendarDrift`), and
 * Today asks the owner: cancel it (the client is emailed), use Google's time
 * (the client is emailed), or keep it as booked (it goes back on the calendar).
 *
 * A sweep rather than a push channel: it reads only events StudioCue created
 * (the `calendar.events.owned` scope already granted), needs no webhook, and
 * can't miss a change the way an at-least-once push can. Every 30 minutes.
 */

export type CalendarDrift =
  | { kind: "deleted" }
  | { kind: "moved"; googleStartsAt: string; googleEndsAt: string };

type GoogleEvent = {
  status?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
} | null;

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const instant = (value: unknown) => new Date(text(value)).valueOf();

/** What Google's event says against the call as booked: null when they agree. */
export function driftFrom(call: { startsAt: unknown; endsAt: unknown }, event: GoogleEvent): CalendarDrift | null {
  if (!event || event.status === "cancelled") return { kind: "deleted" };
  const start = event.start?.dateTime;
  const end = event.end?.dateTime;
  // An all-day event, or one Google returned without times: nothing to compare.
  if (!start || !end) return null;
  const apart = (left: unknown, right: unknown) => Math.abs(instant(left) - instant(right)) > 60_000;
  if (!Number.isFinite(instant(start)) || !Number.isFinite(instant(end))) return null;
  if (!apart(start, call.startsAt) && !apart(end, call.endsAt)) return null;
  return {
    kind: "moved",
    googleStartsAt: new Date(instant(start)).toISOString(),
    googleEndsAt: new Date(instant(end)).toISOString(),
  };
}

/** The same drift as before, so nothing is written again. */
function sameDrift(before: unknown, after: CalendarDrift | null): boolean {
  if (!before || typeof before !== "object") return after === null;
  if (!after) return false;
  const record = before as Record<string, unknown>;
  if (record.kind !== after.kind) return false;
  return after.kind === "deleted" || (record.googleStartsAt === after.googleStartsAt && record.googleEndsAt === after.googleEndsAt);
}

/** An owner who chose "keep it" is answered by the restore job: leave the call alone while it runs. */
const KEEP_GRACE_MS = 2 * 60 * 60_000;

/** Calls are read back from now to this far ahead. */
const HORIZON_MS = 180 * 86_400_000;

export async function sweepCalendarDrift(deps: {
  db: Firestore;
  now: Date;
  connect: typeof connection;
  fetch: typeof fetch;
}) {
  const { db, now } = deps;
  const tally = { tenants: 0, checked: 0, marked: 0, cleared: 0, failed: 0 };
  const connections = await db
    .collection("integrationConnections")
    .where("provider", "==", "google_calendar")
    .where("status", "==", "connected")
    .get();
  const tenants = [...new Set(connections.docs.filter((doc) => doc.get("mockMode") !== true).map((doc) => text(doc.get("tenantId"))))].filter(Boolean);
  for (const tenantId of tenants) {
    let calendar: Awaited<ReturnType<typeof connection>>;
    try {
      calendar = await deps.connect(tenantId, "google_calendar");
    } catch {
      // A broken connection is Today's to report (integration health), not ours.
      tally.failed += 1;
      continue;
    }
    if (calendar.mock) continue;
    tally.tenants += 1;
    const calendarId = encodeURIComponent(String(calendar.document.get("selectedResourceId") ?? "primary"));
    const calls = await db.collection("consultations").where("tenantId", "==", tenantId).where("status", "==", "scheduled").limit(500).get();
    for (const call of calls.docs) {
      const startsAt = instant(call.get("startsAt"));
      if (!Number.isFinite(startsAt) || startsAt < now.valueOf() || startsAt > now.valueOf() + HORIZON_MS) continue;
      const eventId = text(call.get("calendarEventId"));
      // No event yet, or a mock-mode fixture id.
      if (!eventId || eventId.startsWith("gcal_")) continue;
      const before = call.get("calendarDrift") as Record<string, unknown> | null | undefined;
      const keptAt = instant(before?.keptAt);
      if (Number.isFinite(keptAt) && now.valueOf() - keptAt < KEEP_GRACE_MS) continue;
      tally.checked += 1;
      let event: GoogleEvent;
      try {
        const response = await deps.fetch(
          `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${encodeURIComponent(eventId)}`,
          { headers: { authorization: `Bearer ${calendar.credential?.accessToken}` } },
        );
        if (response.status === 404 || response.status === 410) event = null;
        else if (!response.ok) {
          tally.failed += 1;
          continue;
        } else event = (await response.json()) as GoogleEvent;
      } catch {
        tally.failed += 1;
        continue;
      }
      const drift = driftFrom({ startsAt: call.get("startsAt"), endsAt: call.get("endsAt") }, event);
      if (sameDrift(before, drift)) continue;
      const timestamp = now.toISOString();
      await call.ref.update({
        calendarDrift: drift ? { ...drift, detectedAt: timestamp } : null,
        updatedAt: timestamp,
        updatedBy: "calendar-drift",
      });
      if (!drift) {
        tally.cleared += 1;
        continue;
      }
      tally.marked += 1;
      await db.collection("auditEvents").doc().create({
        tenantId,
        projectId: text(call.get("projectId")) || null,
        actorId: "calendar-drift",
        actorType: "system",
        action: drift.kind === "deleted" ? "consultation.calendar_deleted" : "consultation.calendar_moved",
        entityType: "consultation",
        entityId: call.id,
        timestamp,
        before: { startsAt: call.get("startsAt"), endsAt: call.get("endsAt") },
        after: drift,
        ipAddress: null,
        userAgent: null,
        correlationId: `calendar-drift:${call.id}:${timestamp}`,
        automationRunId: null,
        providerEventId: eventId,
      });
    }
  }
  return tally;
}

export const calendarDriftSweep = onSchedule(
  {
    schedule: "every 30 minutes",
    timeZone: "UTC",
    retryCount: 1,
    // Reading the calendar refreshes the studio's Google token, and the
    // refresh needs the client secret (consultation-availability-query.ts).
    secrets: ["GOOGLE_CALENDAR_CLIENT_SECRET"],
  },
  async () => {
    const tally = await sweepCalendarDrift({ db: getFirestore(), now: new Date(), connect: connection, fetch });
    console.log(JSON.stringify({ event: "calendar_drift_sweep", ...tally }));
  },
);
