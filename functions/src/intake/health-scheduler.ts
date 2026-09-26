import { getFirestore } from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { studioNotificationAddress } from "../communications/notify-address.js";

/**
 * Capture health: say so when inquiries stop arriving.
 *
 * Forwarding fails silently — a filter deleted, a password changed, a mailbox
 * moved to Microsoft 365 with external forwarding blocked — and the studio's
 * experience of that failure is simply "no inquiries", which looks exactly
 * like a quiet week. So a studio whose captures stop for longer than usual
 * (three times its typical gap, and never less than a week) is told once,
 * in Today and by email, until a capture arrives again.
 */

const DAY = 86_400_000;

/** Pure: the silence threshold in ms, from the arrival times of recent captures. */
export function silenceThreshold(arrivals: readonly string[]): number {
  const times = arrivals
    .map((value) => Date.parse(value))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const gaps = times.slice(1).map((time, index) => time - times[index]!);
  if (!gaps.length) return 7 * DAY;
  const sorted = [...gaps].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  return Math.max(7 * DAY, 3 * median);
}

/** Pure: whether to raise the alert now. */
export function captureSilent(input: {
  lastCaptureAt: string | null;
  alertedForCaptureAt: string | null;
  thresholdMs: number;
  now: number;
}): boolean {
  if (!input.lastCaptureAt) return false; // never set up: nothing to lose yet
  if (input.alertedForCaptureAt === input.lastCaptureAt) return false; // said once
  return input.now - Date.parse(input.lastCaptureAt) > input.thresholdMs;
}

const COUNTED = new Set(["lead_created", "maybe_created", "attached_to_lead", "attached_to_project"]);

export const leadCaptureHealthScheduler = onSchedule(
  { schedule: "every day 14:00", timeZone: "UTC", retryCount: 1, region: "us-east4" },
  async () => {
    const db = getFirestore();
    const now = Date.now();
    const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "https://studio-cue.com").replace(/\/$/, "");
    const settings = await db.collection("leadCaptureSettings").get();
    for (const studio of settings.docs) {
      const tenantId = studio.id;
      const lastCaptureAt = (studio.get("lastCaptureAt") as string | null) ?? null;
      const alertedForCaptureAt = (studio.get("silenceAlertForCaptureAt") as string | null) ?? null;
      if (!lastCaptureAt || alertedForCaptureAt === lastCaptureAt) continue;
      const recent = await db
        .collection("inboundCaptures")
        .where("tenantId", "==", tenantId)
        .orderBy("receivedAt", "desc")
        .limit(30)
        .get()
        .catch(() => null);
      const arrivals = (recent?.docs ?? [])
        .filter((capture) => COUNTED.has(String(capture.get("outcome"))))
        .map((capture) => String(capture.get("receivedAt")));
      const thresholdMs = silenceThreshold(arrivals);
      if (!captureSilent({ lastCaptureAt, alertedForCaptureAt, thresholdMs, now })) continue;
      const silentDays = Math.floor((now - Date.parse(lastCaptureAt)) / DAY);
      const nowIso = new Date(now).toISOString();
      const recipient = await studioNotificationAddress(db, tenantId);
      const batch = db.batch();
      if (recipient) {
        batch.set(db.doc(`emailJobs/capture_silent_${tenantId}_${lastCaptureAt.slice(0, 19)}`), {
          id: `capture_silent_${tenantId}_${lastCaptureAt.slice(0, 19)}`,
          tenantId,
          projectId: null,
          type: "studio_capture_silent",
          recipient,
          silentDays,
          actionUrl: `${appUrl}/studio/settings/inquiry-capture`,
          status: "queued",
          attempts: 0,
          createdAt: nowIso,
          updatedAt: nowIso,
        });
      }
      batch.set(
        studio.ref,
        {
          silenceAlertForCaptureAt: lastCaptureAt,
          silenceAlertAt: nowIso,
          silentDays,
          updatedAt: nowIso,
        },
        { merge: true },
      );
      await batch.commit();
    }
  },
);
