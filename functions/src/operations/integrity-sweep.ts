import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { jobCalledOff } from "../booking/stopped-billing.js";
import { isStandingInvoice } from "../booking/invoice-standing.js";

/**
 * The hourly safety sweep: records that disagree with each other.
 *
 * 2026-10-22: Michelle & Kyle paid their deposit through QuickBooks, the
 * invoice said paid, and the job stayed "Awaiting deposit" — the booking plan
 * the trigger needed had been deleted, so the trigger returned without a word.
 * A review found a dozen automations with the same shape: an event arrives,
 * something it needs is missing, and nothing tells anyone. Rather than guess
 * every way an automation can stall, this checks the outcomes they exist to
 * produce, across every studio, every hour:
 *
 * - a studio-facing problem becomes a task on Today (`source:
 *   "integrity_check"`, one per problem, closed by the sweep once resolved);
 * - every problem, the first time it is seen, logs an operational error
 *   (the "operational error" alert emails the team);
 * - `integrityFindings/{id}` remembers what is open, so nothing alerts twice.
 */

const MINUTE = 60 * 1000;

export type IntegrityRule =
  | "deposit_paid_not_booked"
  | "booking_plan_missing"
  | "signed_no_deposit"
  | "signed_not_advanced"
  | "amendment_not_applied"
  | "paid_after_cancel"
  | "job_queue_stuck"
  | "domain_events_stuck"
  | "inquiry_not_delivered"
  | "payment_not_matched"
  | "upload_scan_failed";

export type IntegrityFinding = {
  rule: IntegrityRule;
  /** Stable for the same problem on the same record. */
  id: string;
  tenantId: string | null;
  projectId: string | null;
  detail: string;
  /** Shown to the studio on Today, worded for them. Null: platform only. */
  studio: { title: string; description: string } | null;
};

type Row = Record<string, unknown>;
const text = (value: unknown): string => (typeof value === "string" ? value : "");
const at = (value: unknown): number => Date.parse(text(value)) || 0;

/**
 * One job waiting on its agreement or deposit: is it stuck? Pure — the
 * hourly run gathers the records, this decides. Exported for the tests.
 */
export function jobIntegrityFindings(input: {
  projectId: string;
  project: Row;
  plan: Row | null;
  retainers: Row[];
  completedContracts: Row[];
  now: number;
}): IntegrityFinding[] {
  const { projectId, project, plan, retainers, completedContracts, now } = input;
  const tenantId = text(project.tenantId);
  const state = text(project.state);
  if (jobCalledOff(project) || project.archivedAt) return [];
  const name = text(project.name) || "this job";
  const finding = (rule: IntegrityRule, detail: string, studio: IntegrityFinding["studio"]): IntegrityFinding => ({
    rule,
    id: `${rule}_${projectId}`,
    tenantId,
    projectId,
    detail,
    studio,
  });
  const out: IntegrityFinding[] = [];
  const paid = retainers.find(
    (invoice) => text(invoice.status) === "paid" && Number(invoice.balanceCents ?? 1) <= 0 && now - at(invoice.updatedAt) > 15 * MINUTE,
  );
  if (paid && (state === "RETAINER_PENDING" || state === "CONTRACT_PENDING")) {
    out.push(
      finding("deposit_paid_not_booked", `invoice ${text(paid.id)} paid, job ${state}`, {
        title: `Confirm the booking for ${name}`,
        description:
          "Their deposit is paid, but the booking didn't confirm on its own. Open the job's booking page and confirm it. StudioCue's team has been told too.",
      }),
    );
    return out;
  }
  const signed = completedContracts
    .map((contract) => at(contract.completedAt ?? contract.updatedAt))
    .filter(Boolean)
    .sort((a, b) => a - b)[0];
  const signedAnHourAgo = Boolean(signed) && now - (signed ?? now) > 60 * MINUTE;
  if (state === "CONTRACT_PENDING" && signedAnHourAgo) {
    out.push(
      finding("signed_not_advanced", "agreement complete, job still CONTRACT_PENDING", {
        title: `${name}: signed, but the job didn't move on`,
        description:
          "The agreement is signed, but the job still says it's waiting for it. Open the job and send the deposit invoice yourself. StudioCue's team has been told too.",
      }),
    );
  }
  if (state === "RETAINER_PENDING") {
    const planLive = plan && ["active", "needs_attention"].includes(text(plan.status));
    if (!planLive) out.push(finding("booking_plan_missing", `plan ${plan ? text(plan.status) : "missing"}`, null));
    const standing = retainers.some((invoice) => isStandingInvoice(invoice.status));
    const policy = (plan?.policy ?? {}) as Row;
    if (signedAnHourAgo && !standing && policy.createRetainerAfterSignature !== false) {
      out.push(
        finding("signed_no_deposit", "agreement complete over an hour ago, no deposit invoice", {
          title: `Send the deposit invoice for ${name}`,
          description:
            "The agreement was signed over an hour ago, but no deposit invoice was raised. Open the job's booking page and create it. StudioCue's team has been told too.",
        }),
      );
    }
  }
  return out;
}

async function pendingJobFindings(db: Firestore, now: number): Promise<IntegrityFinding[]> {
  const jobs = await db.collection("projects").where("state", "in", ["CONTRACT_PENDING", "RETAINER_PENDING"]).get();
  const out: IntegrityFinding[] = [];
  for (const job of jobs.docs) {
    const tenantId = text(job.get("tenantId"));
    if (!tenantId) continue;
    const [plan, retainers, contracts] = await Promise.all([
      db.doc(`bookingOrchestrations/${job.id}`).get(),
      db.collection("invoiceReferences").where("tenantId", "==", tenantId).where("projectId", "==", job.id).where("kind", "==", "retainer").get(),
      db.collection("contracts").where("tenantId", "==", tenantId).where("projectId", "==", job.id).where("status", "==", "completed").get(),
    ]);
    out.push(
      ...jobIntegrityFindings({
        projectId: job.id,
        project: job.data(),
        plan: plan.exists && plan.get("tenantId") === tenantId ? (plan.data() ?? null) : null,
        retainers: retainers.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
        completedContracts: contracts.docs.map((doc) => doc.data()),
        now,
      }),
    );
  }
  return out;
}

async function systemFindings(db: Firestore, now: number): Promise<IntegrityFinding[]> {
  const out: IntegrityFinding[] = [];
  const iso = (ms: number) => new Date(ms).toISOString();

  // Background work that should have run: queued past its time, or running too long.
  for (const collection of ["providerJobs", "emailJobs", "pdfJobs", "aiJobs"]) {
    const stuck = await db.collection(collection).where("status", "in", ["queued", "retry_scheduled", "running"]).limit(500).get();
    for (const job of stuck.docs) {
      const status = text(job.get("status"));
      const due = at(job.get("nextAttemptAt")) || at(job.get("updatedAt")) || at(job.get("createdAt"));
      const late = status === "running" ? now - at(job.get("updatedAt")) > 15 * MINUTE : due > 0 && now - due > 60 * MINUTE;
      if (late)
        out.push({ rule: "job_queue_stuck", id: `job_queue_stuck_${collection}_${job.id}`, tenantId: text(job.get("tenantId")) || null, projectId: text(job.get("projectId")) || null, detail: `${collection}/${job.id} ${status}`, studio: null });
    }
  }

  // Signed amendments that never applied.
  const amendments = await db.collection("bookingAmendments").where("status", "==", "signed").limit(200).get();
  for (const amendment of amendments.docs) {
    if (amendment.get("appliedAt") || now - at(amendment.get("updatedAt")) < 15 * MINUTE) continue;
    out.push({ rule: "amendment_not_applied", id: `amendment_not_applied_${amendment.id}`, tenantId: text(amendment.get("tenantId")) || null, projectId: text(amendment.get("projectId")) || null, detail: `bookingAmendments/${amendment.id}`, studio: null });
  }

  // A parent who paid for a place that was then canceled.
  const cancelled = await db.collection("eventParticipants").where("status", "==", "cancelled").limit(500).get();
  for (const participant of cancelled.docs) {
    const invoice = (participant.get("qbInvoice") ?? {}) as Row;
    if (!(Number(invoice.totalCents ?? 0) > 0 && Number(invoice.balanceCents ?? 1) <= 0)) continue;
    out.push({
      rule: "paid_after_cancel",
      id: `paid_after_cancel_${participant.id}`,
      tenantId: text(participant.get("tenantId")) || null,
      projectId: text(participant.get("projectId")) || null,
      detail: `eventParticipants/${participant.id}`,
      studio: {
        title: `Refund or keep ${text(participant.get("parentName")) || "a parent"}'s payment`,
        description: "They paid for a place that was then canceled. Decide whether to refund it, and do that in QuickBooks. StudioCue doesn't move money back on its own.",
      },
    });
  }

  // Events the automation pipeline never got to.
  const events = await db.collection("domainEvents").where("processingStatus", "in", ["pending", "publish_retry"]).limit(500).get();
  const staleEvents = events.docs.filter((event) => now - at(event.get("createdAt")) > 30 * MINUTE);
  if (staleEvents.length)
    out.push({ rule: "domain_events_stuck", id: "domain_events_stuck", tenantId: null, projectId: null, detail: `${staleEvents.length} domainEvents pending > 30 min (oldest ${staleEvents[0]?.id})`, studio: null });

  // Inquiries the website held that haven't reached the studio.
  const held = await db.collection("pendingInquiries").where("status", "in", ["pending", "delivering", "rejected", "failed"]).limit(200).get();
  for (const inquiry of held.docs) {
    const status = text(inquiry.get("status"));
    if ((status === "pending" || status === "delivering") && now - at(inquiry.get("receivedAt")) < 60 * MINUTE) continue;
    out.push({ rule: "inquiry_not_delivered", id: `inquiry_not_delivered_${inquiry.id}`, tenantId: text(inquiry.get("tenantId")) || null, projectId: null, detail: `pendingInquiries/${inquiry.id} ${status}: ${text(inquiry.get("lastError"))}`, studio: null });
  }

  // Payments QuickBooks reported on invoices StudioCue doesn't track (last day).
  const ignored = await db.collection("webhookEvents").where("createdAt", ">=", iso(now - 24 * 60 * MINUTE)).limit(1000).get();
  for (const event of ignored.docs) {
    if (event.get("status") !== "ignored" || event.get("ignoredReason") !== "INVOICE_NOT_TRACKED") continue;
    out.push({ rule: "payment_not_matched", id: `payment_not_matched_${event.id}`, tenantId: text(event.get("tenantId")) || null, projectId: null, detail: `webhookEvents/${event.id}`, studio: null });
  }

  // Uploads the scanner couldn't check: unreadable until rescanned.
  const scans = await db.collection("fileScans").where("status", "==", "scan_failed").limit(200).get();
  for (const scan of scans.docs) {
    if (now - at(scan.get("createdAt")) > 7 * 24 * 60 * MINUTE) continue;
    out.push({ rule: "upload_scan_failed", id: `upload_scan_failed_${scan.id}`, tenantId: null, projectId: null, detail: `fileScans/${scan.id} ${text(scan.get("objectName"))}: ${text(scan.get("detail")).slice(0, 120)}`, studio: null });
  }
  return out;
}

/** The task a studio sees on Today for a finding. */
export function integrityTask(finding: IntegrityFinding, nowIso: string): Row | null {
  if (!finding.studio || !finding.tenantId) return null;
  return {
    id: `integrity_${finding.id}`,
    tenantId: finding.tenantId,
    projectId: finding.projectId,
    workflowRunId: null,
    checkpointId: null,
    title: finding.studio.title,
    description: finding.studio.description,
    status: "not_started",
    priority: "high",
    assignedUserId: null,
    assignedRole: "studio_owner",
    dueDate: nowIso.slice(0, 10),
    blocking: false,
    completedAt: null,
    completedBy: null,
    source: "integrity_check",
    integrityRule: finding.rule,
    createdAt: nowIso,
    updatedAt: nowIso,
    createdBy: "integrity-sweep",
    updatedBy: "integrity-sweep",
    archivedAt: null,
  };
}

/** Everything open right now. Read-only. */
export async function collectIntegrityFindings(db: Firestore, now = Date.now()): Promise<IntegrityFinding[]> {
  return [...(await pendingJobFindings(db, now)), ...(await systemFindings(db, now))];
}

export async function runIntegritySweep(db: Firestore, now = Date.now()) {
  const nowIso = new Date(now).toISOString();
  const findings = await collectIntegrityFindings(db, now);
  const seen = new Set(findings.map((finding) => finding.id));
  let raised = 0;
  for (const finding of findings) {
    const reference = db.doc(`integrityFindings/${finding.id}`);
    const existing = await reference.get();
    const open = existing.exists && !existing.get("resolvedAt");
    await reference.set(
      {
        id: finding.id,
        rule: finding.rule,
        tenantId: finding.tenantId,
        projectId: finding.projectId,
        detail: finding.detail,
        lastSeenAt: nowIso,
        resolvedAt: null,
        ...(open ? {} : { firstSeenAt: nowIso }),
      },
      { merge: true },
    );
    if (open) continue;
    raised += 1;
    logger.error("integrityFinding", {
      studiocueOperationalError: true,
      code: `INTEGRITY_${finding.rule.toUpperCase()}`,
      findingId: finding.id,
      tenantId: finding.tenantId,
      projectId: finding.projectId,
      detail: finding.detail,
    });
    const task = integrityTask(finding, nowIso);
    if (task) {
      const taskReference = db.doc(`tasks/${task.id}`);
      const current = await taskReference.get();
      if (!current.exists) await taskReference.set(task);
      else if (current.get("completedAt")) await taskReference.update({ status: "not_started", completedAt: null, completedBy: null, updatedAt: nowIso, updatedBy: "integrity-sweep" });
    }
  }
  // Resolved since last hour: close the record and the studio's task.
  const open = await db.collection("integrityFindings").where("resolvedAt", "==", null).limit(1000).get();
  let resolved = 0;
  for (const record of open.docs) {
    if (seen.has(record.id)) continue;
    resolved += 1;
    await record.ref.update({ resolvedAt: nowIso });
    const task = await db.doc(`tasks/integrity_${record.id}`).get();
    if (task.exists && !task.get("completedAt"))
      await task.ref.update({ status: "complete", completedAt: nowIso, completedBy: "integrity-sweep", updatedAt: nowIso, updatedBy: "integrity-sweep" });
  }
  await db.doc("systemHealth/integritySweep").set({ id: "integritySweep", lastRunAt: nowIso, open: findings.length, raised, resolved }, { merge: true });
  logger.info("integritySweep", { open: findings.length, raised, resolved });
  return { open: findings.length, raised, resolved };
}

export const integritySweep = onSchedule({ schedule: "every 60 minutes", timeZone: "UTC", retryCount: 1 }, async () => {
  await runIntegritySweep(getFirestore());
});
