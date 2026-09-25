import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { clientAutomationsPaused } from "../imports/existing-booking.js";

/**
 * Nudge a couple who has not signed.
 *
 * Three and seven days after a StudioCue contract is sent, if it is still
 * unsigned, the couple gets one short reminder. Only the latest due reminder
 * is sent, never on the day it went out, and each at most once — the email
 * job's id names the contract and the offset.
 *
 * Read again when it fires (see scheduled-client-email-must-recheck): the job,
 * the contract and the couple's quiet flag are all re-read here, and the email
 * worker checks the contract once more before sending.
 */

export const CONTRACT_REMINDER_DAYS = [3, 7] as const;

function daysBetween(fromIso: string, today: string): number {
  const from = Date.parse(`${fromIso.slice(0, 10)}T00:00:00.000Z`);
  const to = Date.parse(`${today}T00:00:00.000Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return -1;
  return Math.floor((to - from) / 86_400_000);
}

/** Which reminder is due today, if any. Pure. */
export function contractReminderDue(input: {
  provider: unknown;
  status: unknown;
  sentAt: unknown;
  sentOffsets: readonly number[];
  today: string;
}): number | null {
  if (input.provider !== "studiocue") return null;
  if (input.status !== "sent" && input.status !== "viewed") return null;
  if (typeof input.sentAt !== "string") return null;
  const elapsed = daysBetween(input.sentAt, input.today);
  const due = [...CONTRACT_REMINDER_DAYS].reverse().find((days) => elapsed >= days);
  if (due === undefined || input.sentOffsets.includes(due)) return null;
  // Latest only: a contract found at day 8 with nothing sent gets the day-7
  // reminder, not both.
  return due;
}

/** Whether a contract email should still go, read at send time. */
export function contractStillAwaitingSignature(contract: {
  exists: boolean;
  status: unknown;
}): boolean {
  return contract.exists && (contract.status === "sent" || contract.status === "viewed");
}

export const contractReminderScheduler = onSchedule(
  { schedule: "every day 15:00", timeZone: "UTC", retryCount: 1, region: "us-east4" },
  async () => {
    const db = getFirestore();
    const today = new Date().toISOString().slice(0, 10);
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://studio-cue.com";
    // Two single-field queries rather than a composite index that exists only
    // for a daily sweep.
    const [sent, viewed] = await Promise.all([
      db.collection("contracts").where("status", "==", "sent").limit(500).get(),
      db.collection("contracts").where("status", "==", "viewed").limit(500).get(),
    ]);
    for (const contract of [...sent.docs, ...viewed.docs]) {
      const offsets = contract.get("remindersSentDays");
      const offset = contractReminderDue({
        provider: contract.get("provider"),
        status: contract.get("status"),
        sentAt: contract.get("sentAt"),
        sentOffsets: Array.isArray(offsets) ? offsets.map(Number) : [],
        today,
      });
      if (offset === null) continue;
      const tenantId = String(contract.get("tenantId") ?? "");
      const projectId = String(contract.get("projectId") ?? "");
      const project = await db.doc(`projects/${projectId}`).get();
      if (!project.exists || project.get("tenantId") !== tenantId) continue;
      if (clientAutomationsPaused(project.data())) continue;
      if (project.get("state") !== "CONTRACT_PENDING") continue;
      const signers = Array.isArray(contract.get("signers"))
        ? (contract.get("signers") as Array<Record<string, unknown>>)
        : [];
      const client = signers.find((signer) => signer.role === "primary_client");
      if (!client || typeof client.email !== "string" || !client.email) continue;
      const now = new Date().toISOString();
      const jobReference = db.doc(`emailJobs/contract_reminder_${contract.id}_${offset}`);
      try {
        await db.runTransaction(async (transaction) => {
          const [existing, current] = await Promise.all([
            transaction.get(jobReference),
            transaction.get(contract.ref),
          ]);
          if (existing.exists) return;
          if (!contractStillAwaitingSignature({ exists: current.exists, status: current.get("status") }))
            return;
          transaction.create(jobReference, {
            id: jobReference.id,
            tenantId,
            projectId,
            contractId: contract.id,
            type: "contract_reminder",
            recipient: client.email,
            recipientName: typeof client.name === "string" ? client.name : null,
            actionUrl: `${appUrl.replace(/\/$/, "")}/client/contract`,
            reminderDay: offset,
            status: "queued",
            attempts: 0,
            createdAt: now,
            updatedAt: now,
          });
          transaction.update(contract.ref, {
            remindersSentDays: FieldValue.arrayUnion(offset),
            remindersSent: FieldValue.increment(1),
            lastReminderAt: now,
          });
        });
      } catch (caught: unknown) {
        console.error("contract reminder not queued", contract.id, caught);
      }
    }
  },
);
