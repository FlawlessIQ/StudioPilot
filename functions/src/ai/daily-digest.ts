import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { scopedDocuments } from "./copilot.js";

/**
 * The proactive morning brief. Each day it computes a studio's most pressing
 * items — overdue balances, expired crew offers, unready upcoming events, late
 * questionnaires — and emails the owner a short digest that links back into the
 * copilot, where the prepared actions live.
 *
 * Two deliberate choices:
 * - It is OPT-IN per tenant (`tenants/{id}.dailyDigest.enabled`), default off, so
 *   no studio is ever surprised by an unrequested email.
 * - It is fully DETERMINISTIC — no model call. The digest reports facts drawn
 *   straight from records (amounts, dates, counts), never model-authored prose;
 *   the copilot does the reasoning and drafting when the owner opens it.
 */

type Priority = { text: string; rank: number };

const str = (value: unknown) => (typeof value === "string" ? value : "");
const num = (value: unknown) => (typeof value === "number" ? value : 0);
const usd = (cents: unknown) => `$${(num(cents) / 100).toFixed(2)}`;
/** ISO YYYY-MM-DD → "September 1" (falls back to the raw value if unparseable). */
const humanDate = (iso: unknown) => {
  const value = str(iso);
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-US", { month: "long", day: "numeric" });
};
const list = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? (value as Record<string, unknown>[]) : [];

/** The studio's most pressing items today, as short factual lines. */
async function computePriorities(tenantId: string): Promise<Priority[]> {
  const [projects, invoices, assignments, questionnaires, readiness] =
    await Promise.all([
      scopedDocuments("projects", tenantId, null),
      scopedDocuments("invoiceReferences", tenantId, null),
      scopedDocuments("crewAssignments", tenantId, null),
      scopedDocuments("questionnaireResponses", tenantId, null),
      scopedDocuments("readinessAssessments", tenantId, null),
    ]);
  const projectName = new Map(
    projects.map((p) => [String(p.id), str(p.name) || "A project"]),
  );
  const todayIso = new Date().toISOString().slice(0, 10);
  const priorities: Priority[] = [];

  // Overdue balances — most urgent (money, past due).
  for (const invoice of invoices) {
    const balance = num(invoice.balanceCents);
    const dueDate = str(invoice.dueDate);
    if (balance > 0 && dueDate && dueDate < todayIso) {
      priorities.push({
        rank: 0,
        text: `${projectName.get(str(invoice.projectId)) ?? "A project"} — the ${usd(balance)} balance is overdue (was due ${humanDate(dueDate)}).`,
      });
    }
  }

  // Expired crew offers — a role that quietly went unfilled.
  const expiredByProject = new Map<string, number>();
  for (const assignment of assignments) {
    if (str(assignment.status) === "expired") {
      const key = str(assignment.projectId);
      expiredByProject.set(key, (expiredByProject.get(key) ?? 0) + 1);
    }
  }
  for (const [projectId, count] of expiredByProject) {
    priorities.push({
      rank: 1,
      text: `${projectName.get(projectId) ?? "A project"} — a crew role is still open (${count} offer${count === 1 ? "" : "s"} lapsed).`,
    });
  }

  // Upcoming events that are not ready.
  for (const assessment of readiness) {
    const projectId = str(assessment.projectId);
    const project = projects.find((p) => String(p.id) === projectId);
    const projectEventDate = str(project?.eventDate);
    if (
      assessment.ready === false &&
      projectEventDate &&
      projectEventDate >= todayIso
    ) {
      const blockers = list(assessment.blockingItems).length;
      priorities.push({
        rank: 2,
        text: `${projectName.get(projectId) ?? "A project"} (${humanDate(projectEventDate)}) isn't ready yet${blockers ? ` — ${blockers} open item${blockers === 1 ? "" : "s"}` : ""}.`,
      });
    }
  }

  // Late questionnaires.
  for (const response of questionnaires) {
    const status = str(response.status || response.approvalState).toLowerCase();
    if (status && status !== "complete") {
      priorities.push({
        rank: 3,
        text: `${projectName.get(str(response.projectId)) ?? "A project"} — the client questionnaire is still incomplete.`,
      });
    }
  }

  // De-dupe identical lines, most urgent first, capped so the email stays short.
  const seen = new Set<string>();
  return priorities
    .sort((a, b) => a.rank - b.rank)
    .filter((p) => (seen.has(p.text) ? false : (seen.add(p.text), true)))
    .slice(0, 6);
}

function renderDigest(
  studioName: string,
  priorities: Priority[],
): { subject: string; body: string } {
  const n = priorities.length;
  const subject = `Your ${studioName} brief — ${n} thing${n === 1 ? "" : "s"} to look at today`;
  const lines = priorities.map((p) => `• ${p.text}`).join("\n\n");
  // No "Good morning" here — the email template's heading greets by name, so
  // repeating it in the body reads twice.
  const body = [
    `Here ${n === 1 ? "is the one thing" : `are the ${n} things`} that need your attention today:`,
    lines,
    "Open StudioCue whenever you're ready — every reply and action is prepared for you to review and approve, and nothing is sent on its own.",
  ].join("\n\n");
  return { subject, body };
}

export const dailyDigestScheduler = onSchedule(
  { schedule: "every day 13:00", timeZone: "UTC", retryCount: 1 },
  async () => {
    const db = getFirestore();
    const now = new Date().toISOString();
    const dayKey = now.slice(0, 10).replaceAll("-", "");
    const tenants = await db.collection("tenants").get();
    console.log(`[digest] scanning ${tenants.size} tenants`);
    for (const tenantDoc of tenants.docs) {
      const digestSettings = tenantDoc.get("dailyDigest") as
        | { enabled?: boolean }
        | undefined;
      if (!digestSettings?.enabled) continue;
      const tenantId = tenantDoc.id;
      console.log(`[digest] ${tenantId} enabled`);

      const priorities = await computePriorities(tenantId);
      console.log(`[digest] ${tenantId} priorities=${priorities.length}`);
      if (!priorities.length) continue; // nothing pressing — don't email for the sake of it

      const memberships = await db
        .collection("memberships")
        .where("tenantId", "==", tenantId)
        .get();
      const owners = memberships.docs.filter(
        (m) => m.get("role") === "studio_owner" && m.get("status") === "active",
      );
      console.log(`[digest] ${tenantId} owners=${owners.length}`);
      const studioName = str(tenantDoc.get("name")) || "StudioCue";
      const { subject, body } = renderDigest(studioName, priorities);
      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://studio-cue.com";

      for (const owner of owners) {
        const userId = str(owner.get("userId"));
        // The membership doc doesn't always carry an email; fall back to the
        // owner's Firebase Auth address.
        let recipient = str(owner.get("email"));
        if (!recipient && userId) {
          try {
            recipient = (await getAuth().getUser(userId)).email ?? "";
          } catch {
            /* no auth user — skip this owner */
          }
        }
        if (!recipient) continue;
        // One digest per owner per day — a deterministic id makes a retry a no-op.
        const jobId = `digest_${tenantId}_${userId}_${dayKey}`;
        try {
          await db.doc(`emailJobs/${jobId}`).create({
            id: jobId,
            tenantId,
            projectId: null,
            contactId: null,
            recipient,
            recipientName: str(owner.get("displayName")) || null,
            projectName: null,
            type: "daily_digest",
            customSubject: subject,
            customBody: body,
            actionLabel: "Review in StudioCue",
            actionUrl: `${appUrl}/studio/copilot`,
            category: "digest",
            communicationDraftId: null,
            status: "queued",
            scheduledFor: null,
            attempts: 0,
            createdAt: now,
            updatedAt: now,
          });
        } catch {
          // create() throws if the day's digest already exists — that is the
          // idempotency guard; skip quietly.
        }
      }
    }
  },
);
