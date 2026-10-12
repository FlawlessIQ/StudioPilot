import type { Firestore } from "firebase-admin/firestore";
import { studioNotificationAddress } from "../communications/notify-address.js";
import { tradeProfile, tradeVocab } from "../trades/trades.js";
import { consultationPurpose } from "./consultation-purpose.js";

/**
 * Tell the studio a client booked, moved or canceled a call themselves.
 *
 * Gabe, 2026-10-12: a couple booked a Saturday consultation from their link and
 * the only sign was a card on Today — "should get email too. Right?" The couple
 * got their confirmation; the studio got nothing, so a call could be booked,
 * moved or dropped without the studio knowing until it opened StudioCue.
 *
 * One email per change, keyed on it, so a retried request never sends two.
 * Never for a call the studio itself booked or moved: it already knows.
 */

export type StudioCallChange = "booked" | "moved" | "cancelled";

/** What the studio calls this kind of call, in its own trade's words. Pure. */
export function studioCallLabel(purpose: unknown, trade: unknown): string {
  const kind = consultationPurpose({ purpose });
  if (kind === "trial") return "trial";
  const words = tradeVocab(trade);
  if (kind === "final_details") return words.finalCall.toLowerCase();
  return tradeProfile(trade).consultation ? words.consultation.toLowerCase() : "call";
}

export async function queueStudioCallAlert(
  db: Firestore,
  input: {
    tenantId: string;
    projectId: string | null;
    consultationId: string;
    change: StudioCallChange;
    /** "Ernie", or "The couple". */
    who: string;
    purpose: unknown;
    /** "Sat, Oct 17, 11:00 AM", in the studio's timezone. */
    whenLabel: string;
    /** For a move: where it was. */
    previousWhenLabel?: string | null;
    /** "on Zoom", "by phone", "in person", when known. */
    formatLabel?: string | null;
    reason?: string | null;
    now: string;
  },
): Promise<void> {
  const recipient = await studioNotificationAddress(db, input.tenantId).catch(() => null);
  if (!recipient) {
    console.warn("studio call alert: no studio address", { tenantId: input.tenantId, consultationId: input.consultationId });
    return;
  }
  const tenant = await db.doc(`tenants/${input.tenantId}`).get();
  const projectName = input.projectId ? String((await db.doc(`projects/${input.projectId}`).get()).get("name") ?? "") : "";
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "https://studio-cue.com").replace(/\/$/, "");
  const id = `studio_call_${input.change}_${input.consultationId}`;
  const reference = db.doc(`emailJobs/${id}`);
  await db.runTransaction(async (transaction) => {
    if ((await transaction.get(reference)).exists) return;
    transaction.create(reference, {
      id,
      tenantId: input.tenantId,
      // Not the job's: a studio alert is never held for the couple's outreach
      // guards, and never shows in the couple's email history.
      projectId: null,
      type: "studio_call_booked",
      recipient,
      change: input.change,
      who: input.who,
      callLabel: studioCallLabel(input.purpose, tenant.get("trade")),
      whenLabel: input.whenLabel,
      previousWhenLabel: input.previousWhenLabel ?? null,
      formatLabel: input.formatLabel ?? null,
      reason: input.reason ?? null,
      jobName: projectName,
      actionUrl: input.projectId ? `${appUrl}/studio/projects/${input.projectId}` : `${appUrl}/studio`,
      status: "queued",
      attempts: 0,
      createdAt: input.now,
      updatedAt: input.now,
    });
  });
}
