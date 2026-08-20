import { getFirestore } from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { z } from "zod";
import { requireAppCheck, requireIdentity } from "../crm/security.js";
import { getCalendarBusyIntervals } from "../operations/provider-runtime.js";
import { studioHubCors } from "../security/cors.js";
import { getConsultationSettings } from "./availability.js";

const inputSchema = z.object({ tenantId: z.string().min(1) });

const permittedRoles = new Set([
  "studio_owner",
  "studio_admin",
  "studio_coordinator",
]);

async function requireMembership(tenantId: string, userId: string) {
  const snapshot = await getFirestore()
    .doc(`memberships/${tenantId}_${userId}`)
    .get();
  if (
    !snapshot.exists ||
    snapshot.get("status") !== "active" ||
    !permittedRoles.has(String(snapshot.get("role")))
  ) {
    throw new Error("FORBIDDEN");
  }
}

// A pure read (studio settings + booked/busy intervals feeding the
// consultation calendar's slot generation) — no idempotency ledger, same
// precedent as public-scheduling.ts's "availability" action.
export const consultationAvailabilityQuery = onRequest(
  {
    cors: studioHubCors,
    invoker: "private",
    // Same reason as publicConsultationScheduling: this reads free/busy, which
    // refreshes the studio's Google token, and the refresh needs the client
    // secret. See the note there.
    secrets: ["GOOGLE_CALENDAR_CLIENT_SECRET"],
  },
  async (request, response) => {
    if (request.method !== "POST") {
      response.status(405).json({ error: "METHOD_NOT_ALLOWED" });
      return;
    }
    try {
      await requireAppCheck(request);
      const identity = await requireIdentity(request);
      const { tenantId } = inputSchema.parse(request.body);
      await requireMembership(tenantId, identity.uid);

      const db = getFirestore();
      const settings = await getConsultationSettings(db, tenantId);

      const now = new Date();
      const rangeEnd = new Date();
      rangeEnd.setUTCDate(rangeEnd.getUTCDate() + 90);

      const existing = await db
        .collection("consultations")
        .where("tenantId", "==", tenantId)
        .where("startsAt", ">=", now.toISOString())
        .where("startsAt", "<", rangeEnd.toISOString())
        .limit(1000)
        .get();
      const busy = existing.docs
        .filter((document) => document.get("status") === "scheduled")
        .map((document) => ({
          start: String(document.get("startsAt")),
          end: String(document.get("endsAt")),
        }));

      // Real calendar conflicts auto-block alongside internal bookings; an
      // unconnected or failing provider degrades gracefully rather than
      // failing the whole read.
      const calendar = await getCalendarBusyIntervals(
        tenantId,
        now.toISOString(),
        rangeEnd.toISOString(),
      );
      if (calendar.ok) busy.push(...calendar.busy);

      response.status(200).json({
        settings,
        busy,
        calendarStatus: calendar.ok ? "connected" : "unavailable",
      });
    } catch (caught: unknown) {
      const message =
        caught instanceof Error ? caught.message : "AVAILABILITY_QUERY_FAILED";
      response
        .status(message === "FORBIDDEN" ? 403 : 400)
        .json({ error: message });
    }
  },
);
