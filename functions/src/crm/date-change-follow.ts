import type { Firestore } from "firebase-admin/firestore";
import { dateClashes } from "../job-kinds/job-kinds.js";

/** States that hold a date (public-lead.ts, intake/capture.ts). */
const DATE_HOLDING_STATES = [
  "CONSULTATION",
  "PROPOSAL",
  "CONTRACT_PENDING",
  "RETAINER_PENDING",
  "BOOKED",
  "PLANNING",
  "READY",
];

/**
 * An inquiry's first reply, redrafted for the date the studio corrected.
 *
 * The reply is drafted once, at intake, from the date the client typed and
 * whether it was free. The studio fixing that date on the job left the draft
 * one tap from telling the client the old date was taken (prod walk,
 * 2026-10-23: "May 15 … we already have a conflict" after the job had moved
 * to a free June 19). So: the inquiry takes the new date, availability is
 * asked again, and the waiting draft is put away and written again by the
 * intake job. A reply already sent stays sent — only a draft still waiting is
 * touched. After the save rather than inside it, like followEmailToInquiries:
 * a failure here never fails the edit.
 */
export async function followDateToFirstReply(
  db: Firestore,
  input: { tenantId: string; projectId: string; now: string },
): Promise<{ redrafted: string | null }> {
  const project = await db.doc(`projects/${input.projectId}`).get();
  if (!project.exists || project.get("tenantId") !== input.tenantId) return { redrafted: null };
  if (project.get("state") !== "LEAD") return { redrafted: null };
  const leadId = typeof project.get("leadId") === "string" ? (project.get("leadId") as string) : "";
  if (!leadId) return { redrafted: null };
  const draft = db.doc(`aiActions/ai_reply_${leadId}`);
  const [lead, waiting] = await Promise.all([db.doc(`leads/${leadId}`).get(), draft.get()]);
  if (!lead.exists || lead.get("tenantId") !== input.tenantId) return { redrafted: null };
  if (!waiting.exists || waiting.get("status") !== "review_required") return { redrafted: null };

  const eventDate = typeof project.get("eventDate") === "string" ? (project.get("eventDate") as string) : null;
  const others = eventDate
    ? await db
        .collection("projects")
        .where("tenantId", "==", input.tenantId)
        .where("eventDate", "==", eventDate)
        .where("state", "in", DATE_HOLDING_STATES)
        .limit(20)
        .get()
    : null;
  const availabilityStatus = !eventDate
    ? "unknown"
    : dateClashes(
          project.data(),
          (others?.docs ?? [])
            .filter((other) => other.id !== project.id && !other.get("archivedAt"))
            .map((other) => other.data()),
        )
      ? "conflict"
      : "available";

  const batch = db.batch();
  batch.update(lead.ref, {
    eventDate,
    city: project.get("city") ?? lead.get("city") ?? null,
    venue: project.get("venueName") ?? lead.get("venue") ?? null,
    availabilityStatus,
    updatedAt: input.now,
    updatedBy: "date-change-follow",
  });
  // Out of the queue until it is rewritten; the intake job sets it back.
  batch.update(draft, { archivedAt: input.now, updatedAt: input.now });
  batch.set(
    db.doc(`aiJobs/lead_intake_${leadId}`),
    {
      id: `lead_intake_${leadId}`,
      tenantId: input.tenantId,
      projectId: null,
      leadId,
      type: "lead_intake_analysis",
      status: "queued",
      attempts: 0,
      nextAttemptAt: null,
      humanApprovalRequired: false,
      updatedAt: input.now,
    },
    { merge: true },
  );
  await batch.commit();
  return { redrafted: draft.id };
}
