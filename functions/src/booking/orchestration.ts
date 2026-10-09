import { prepareOnAcceptance } from "../contracts/commands.js";
import { studioVouchedAuthorities } from "../imports/existing-booking.js";
import { createHash } from "node:crypto";
import {
  getFirestore,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
  type QuerySnapshot,
} from "firebase-admin/firestore";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions/v2";
import { agreedRetainerCents } from "./agreed-retainer.js";
import { isStandingInvoice } from "./invoice-standing.js";
import { jobCalledOff, refundOrKeepTask } from "./stopped-billing.js";
import { bookingGateRequirements } from "./gate-requirements.js";
import { dateClashes, jobKindOf, projectGateNeeds } from "../job-kinds/job-kinds.js";
import {
  requireProviderForTenant,
  resolveProviderForTenant,
} from "../integrations/capability-resolution.js";
import { productEvent } from "../operations/product-events.js";
import { studioNotificationAddress } from "../communications/notify-address.js";
import { combinedSnapshot, readJobSnapshots } from "../packages/combined-snapshot.js";
import { jobBillingFor } from "../billing/job-billing-reader.js";

function stableId(scope: string, ...parts: string[]) {
  return `${scope}_${createHash("sha256")
    .update(parts.join(":"))
    .digest("hex")
    .slice(0, 32)}`;
}

/**
 * The calendar date at `instant`, as observed in `timeZone`.
 *
 * Mirrored from lib/format/event-date.ts `todayInZone` — functions is a
 * separate package and imports nothing from the app, the same reason
 * checkpoint-evidence exists twice. `en-CA` is the locale whose numeric
 * format is already YYYY-MM-DD.
 */
function zonedDate(instant: Date, timeZone: string): string {
  if (!timeZone) return instant.toISOString().slice(0, 10);
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(instant);
  } catch {
    // An unrecognised zone must not stop a booking from raising its invoice.
    return instant.toISOString().slice(0, 10);
  }
}

/**
 * A due date `days` after the booking, counted in the job's own timezone.
 *
 * This took `new Date(from)` and added days in UTC. `from` is the current
 * instant, so a booking taken at 9pm Eastern was already tomorrow in UTC and
 * every retainer and balance due date landed a day later than the policy
 * says. Noon anchoring keeps the arithmetic clear of both boundaries.
 */
function dueDate(days: number, from: string, timeZone: string) {
  const base = zonedDate(new Date(from), timeZone);
  const value = new Date(`${base}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

/**
 * Written, not updated.
 *
 * A contract signed through a provider is created first and completed later
 * by the webhook, so an update trigger saw it. A signature recorded by the
 * studio is created already complete — one write, no update — and this
 * never fired: the sequence sat on `wait_for_signature` against a contract
 * that was finished, the retainer was never raised, and the workspace said
 * "Waiting for verified signature" indefinitely.
 *
 * The guards below already tolerate a create: `before` is a snapshot that
 * does not exist, so `before?.get(...)` is undefined and reads as "was not
 * previously complete", which is exactly right.
 */
/**
 * The couple accepted; the agreement goes out.
 *
 * Accepting a proposal used to create a "Prepare client agreement" task, so
 * the studio had to open the booking page, confirm a template and press
 * "Approve sequence & send" — three steps for a decision already made when
 * the studio chose its default agreement. When the studio has opted in
 * (`defaultContractSettings.sendOnAcceptance`, set beside that choice), this
 * does what that button does: creates the contract, queues the signature
 * request and starts the booking sequence, so the retainer follows the
 * signature and the job books itself when the retainer is paid.
 *
 * Deliberately narrow. It acts only on a transition to accepted, only with a
 * connected signing app, a default template, a client with an email and a
 * project waiting at CONTRACT_PENDING, and never when a contract already
 * exists. Anything missing leaves the studio's existing task in place — the
 * manual path is unchanged. Ids derive from the proposal, so a retried
 * trigger cannot send twice.
 */
export const bookingProposalAccepted = onDocumentWritten(
  "proposals/{proposalId}",
  async (event) => {
    const before = event.data?.before;
    const proposal = event.data?.after;
    if (!proposal?.exists) return;
    if (proposal.get("status") !== "accepted" || before?.get("status") === "accepted")
      return;
    // Accepted by signing the booking agreement (H2): the contract is signed
    // already, in the same act. There is nothing to prepare.
    if (proposal.get("acceptedWithContractId")) return;

    const db = getFirestore();
    const tenantId = String(proposal.get("tenantId") ?? "");
    const projectId = String(proposal.get("projectId") ?? "");
    if (!tenantId || !projectId) return;

    // A kind of job that books without an agreement — a family session, a
    // sports day (job-kinds.ts; GR Productions, 2026-10-02) — goes straight
    // to payment, or straight to booked when nothing is paid to book.
    const acceptedProject = await db.doc(`projects/${projectId}`).get();
    if (
      acceptedProject.exists &&
      acceptedProject.get("tenantId") === tenantId &&
      !projectGateNeeds(acceptedProject.data()).agreement
    ) {
      await bookWithoutAgreement(db, { tenantId, projectId, proposal });
      return;
    }

    // StudioCue's own contracts come first: when the studio has saved an
    // agreement, the contract is written from it and waits as a draft (or is
    // signed and sent, if the studio turned that on). A signing app's
    // template is only consulted when there is no StudioCue agreement.
    try {
      const native = await prepareOnAcceptance(db, {
        tenantId,
        projectId,
        proposalId: proposal.id,
      });
      if (native.outcome !== "not_enabled" && native.outcome !== "no_agreement_template") {
        logger.info("bookingProposalAcceptedNativeContract", {
          tenantId,
          projectId,
          outcome: native.outcome,
        });
        return;
      }
    } catch (caught: unknown) {
      // Never let a contract draft failure block the rest of acceptance; the
      // studio can still prepare it from the job.
      logger.error("bookingProposalAcceptedNativeContractFailed", {
        tenantId,
        projectId,
        error: caught instanceof Error ? caught.message : String(caught),
      });
      return;
    }

    const tenant = await db.doc(`tenants/${tenantId}`).get();
    const settings = (tenant.get("defaultContractSettings") ?? {}) as {
      templateId?: string | null;
      sendOnAcceptance?: boolean;
    };
    const templateId =
      typeof settings.templateId === "string" ? settings.templateId : "";
    if (settings.sendOnAcceptance !== true || !templateId) return;

    const skip = (reason: string) =>
      logger.info("bookingProposalAcceptedSkipped", { tenantId, projectId, reason });

    let signingProvider: string;
    try {
      signingProvider = await requireProviderForTenant(db, tenantId, "signing");
    } catch (caught: unknown) {
      skip(caught instanceof Error ? caught.message : "SIGNING_UNRESOLVED");
      return;
    }

    const projectReference = db.doc(`projects/${projectId}`);
    const [project, existingContracts, plan] = await Promise.all([
      projectReference.get(),
      db.collection("contracts")
        .where("tenantId", "==", tenantId)
        .where("projectId", "==", projectId)
        .limit(10)
        .get(),
      db.doc(`bookingOrchestrations/${projectId}`).get(),
    ]);
    if (!project.exists || project.get("tenantId") !== tenantId) return;
    // Acceptance moves the job to CONTRACT_PENDING in the same write as the
    // proposal, but a studio-recorded acceptance from CONSULTATION hops two
    // states; anything else means the booking is already past this point.
    if (project.get("state") !== "CONTRACT_PENDING") {
      skip(`project_${String(project.get("state"))}`);
      return;
    }
    if (existingContracts.docs.some((contract) => contract.get("status") !== "failed")) {
      skip("contract_exists");
      return;
    }
    if (plan.exists && plan.get("status") === "active") {
      skip("plan_active");
      return;
    }
    const contactIds = strings(project.get("clientContactIds"));
    const contact = contactIds[0] ? await db.doc(`contacts/${contactIds[0]}`).get() : null;
    const email = String(contact?.get("email") ?? "").trim();
    if (!contact?.exists || contact.get("tenantId") !== tenantId || !email.includes("@")) {
      skip("client_email_missing");
      return;
    }
    const name =
      String(contact.get("displayName") ?? "").trim() ||
      [contact.get("firstName"), contact.get("lastName")].filter(Boolean).join(" ").trim() ||
      email;

    const now = new Date().toISOString();
    const idempotencyKey = stableId("accept_send", tenantId, proposal.id);
    const contractId = stableId("contract", tenantId, idempotencyKey);
    const retainerDueDays = 7;
    const startedEvent = productEvent({
      tenantId,
      projectId,
      actorId: "booking-orchestrator",
      actorType: "system",
      name: "booking.sequence_approved",
      occurredAt: now,
      correlationId: idempotencyKey,
      sourceEntityType: "bookingOrchestration",
      sourceEntityId: projectId,
      properties: {
        proposalId: proposal.id,
        contractId,
        retainerDueDays,
        trigger: "proposal_accepted",
      },
    });

    await db.runTransaction(async (transaction) => {
      const contractReference = db.doc(`contracts/${contractId}`);
      const [existing, currentProject] = await Promise.all([
        transaction.get(contractReference),
        transaction.get(projectReference),
      ]);
      if (existing.exists) return;
      if (currentProject.get("state") !== "CONTRACT_PENDING") return;
      for (const stale of existingContracts.docs) {
        transaction.update(stale.ref, {
          status: "superseded",
          supersededAt: now,
          supersededBy: contractId,
          updatedAt: now,
          updatedBy: "booking-orchestrator",
        });
      }
      transaction.create(contractReference, {
        id: contractId,
        tenantId,
        projectId,
        proposalId: proposal.id,
        status: "queued",
        provider: signingProvider,
        providerEnvelopeId: `envelope_${idempotencyKey}`,
        templateId,
        signers: [{ name, email, role: "Client", order: 1, status: "queued" }],
        sentAt: null,
        completedAt: null,
        signedDocumentId: null,
        certificateDocumentId: null,
        completionEvidence: null,
        fileHash: null,
        lastProviderEventId: null,
        providerState: "queued",
        // Who approved this send: the studio, in advance, by opting in.
        sentOnStudioPolicy: "send_on_acceptance",
        createdAt: now,
        updatedAt: now,
        createdBy: "booking-orchestrator",
        updatedBy: "booking-orchestrator",
        archivedAt: null,
      });
      transaction.create(db.doc(`providerJobs/contract_${contractId}`), {
        tenantId,
        projectId,
        type: signingProvider === "dropbox_sign"
          ? "create_dropbox_sign_request"
          : "create_docusign_envelope",
        contractId,
        idempotencyKey,
        status: "queued",
        attempts: 0,
        createdAt: now,
        updatedAt: now,
      });
      transaction.set(db.doc(`bookingOrchestrations/${projectId}`), {
        id: projectId,
        tenantId,
        projectId,
        proposalId: proposal.id,
        contractId,
        invoiceId: null,
        status: "active",
        currentStep: "wait_for_signature",
        policy: {
          createRetainerAfterSignature: true,
          completeBookingAfterPayment: true,
          retainerDueDays,
        },
        approvedBy: "studio_policy:send_on_acceptance",
        approvedAt: now,
        lastError: null,
        completedAt: null,
        createdAt: now,
        updatedAt: now,
      }, { merge: false });
      // The task acceptance created is done: nobody needs to prepare anything.
      // `complete` is the schema's word — `completed` is not in the enum and
      // left the task's "Mark done" button on screen for ever.
      transaction.set(db.doc(`tasks/proposal_decision_${proposal.id}`), {
        status: "complete",
        completedAt: now,
        completedBy: "booking-orchestrator",
        updatedAt: now,
        updatedBy: "booking-orchestrator",
      }, { merge: true });
      transaction.create(db.doc(`productEvents/${startedEvent.id}`), startedEvent);
      transaction.set(db.doc(`actionReceipts/booking_agreement_${projectId}`), {
        id: `booking_agreement_${projectId}`,
        tenantId,
        projectId,
        title: "Agreement sent automatically",
        summary: `The couple accepted their proposal, so the agreement went to ${name} for signature. The retainer follows the signature.`,
        status: "completed",
        source: "booking_orchestrator",
        affectedEntityType: "contract",
        affectedEntityId: contractId,
        providerEvidence: { proposalId: proposal.id, provider: signingProvider },
        reversible: false,
        retryable: true,
        canCancel: false,
        canRetry: true,
        attempts: 1,
        completedAt: now,
        createdAt: now,
        updatedAt: now,
        createdBy: "booking-orchestrator",
        updatedBy: "booking-orchestrator",
        archivedAt: null,
      }, { merge: true });
    });
  },
);

export const bookingContractCompleted = onDocumentWritten(
  "contracts/{contractId}",
  async (event) => {
    const before = event.data?.before;
    const contract = event.data?.after;
    // Also covers deletion, which onDocumentWritten delivers and an update
    // trigger never did.
    if (!contract?.exists) return;
    if (before?.get("status") === "completed" || contract.get("status") !== "completed")
      return;

    const db = getFirestore();
    const tenantId = String(contract.get("tenantId") ?? "");
    const projectId = String(contract.get("projectId") ?? "");
    if (!tenantId || !projectId) return;
    const planReference = db.doc(`bookingOrchestrations/${projectId}`);
    const [plan, project, existingInvoices] = await Promise.all([
      planReference.get(),
      db.doc(`projects/${projectId}`).get(),
      db.collection("invoiceReferences")
        .where("tenantId", "==", tenantId)
        .where("projectId", "==", projectId)
        .where("kind", "==", "retainer")
        // Not limit(1): a stale attempt must not hide a live invoice.
        .limit(10)
        .get(),
    ]);
    if (
      !plan.exists ||
      plan.get("status") !== "active" ||
      plan.get("contractId") !== contract.id
    ) return;
    // Sent with nothing connected to raise the deposit, and QuickBooks or
    // Stripe connected since (Today: "Connect payments so … can pay online"):
    // raise it now, so the client who signs pays on the spot. Still nothing
    // connected: the studio records it by hand, as the plan said.
    // Either way, only for a job billed through QuickBooks: a job the studio
    // bills itself (billing/job-billing.ts) raises nothing there, and its
    // plan is turned to "the studio takes the deposit" so the job, Today and
    // the portal all say so.
    const policy = plan.get("policy.createRetainerAfterSignature");
    const billing = await jobBillingFor(db, tenantId, projectId, project.exists ? (project.data() ?? null) : null);
    const raisesRetainer = (policy === true || policy === false) && billing.method === "quickbooks";
    if (!raisesRetainer) {
      if (policy === true && billing.method === "studio") {
        await planReference.update({
          "policy.createRetainerAfterSignature": false,
          updatedAt: new Date().toISOString(),
        });
      }
      return;
    }
    if (!project.exists || project.get("tenantId") !== tenantId) return;
    // A signature that lands after the job was called off raises no retainer.
    // Cancelling now closes the plan (stopped-billing.ts); a plan left active
    // by a cancellation before that would otherwise bill the couple here.
    if (jobCalledOff(project.data())) return;
    // A refused or superseded attempt is not a retainer, and pointing the
    // plan at one would park it on `wait_for_payment` against an invoice
    // the client never received.
    const liveInvoices = existingInvoices.docs.filter((invoice) =>
      isStandingInvoice(invoice.get("status")),
    );
    if (liveInvoices.length) {
      await planReference.update({
        invoiceId: liveInvoices[0]!.id,
        currentStep: "wait_for_payment",
        updatedAt: new Date().toISOString(),
      });
      return;
    }
    const packageSnapshotId = String(project.get("packageSnapshotId") ?? "");
    if (!packageSnapshotId) throw new Error("PACKAGE_SNAPSHOT_NOT_FOUND");
    // Every package on the job, for the retainer fallback when no proposal
    // was accepted (packages/combined-snapshot.ts).
    const jobSnapshots = await readJobSnapshots(db, project.data(), tenantId);
    if (!jobSnapshots.length || jobSnapshots[0]!.id !== packageSnapshotId)
      throw new Error("PACKAGE_SNAPSHOT_NOT_FOUND");
    const packageSnapshot = combinedSnapshot(jobSnapshots);
    const provider = await resolveProviderForTenant(db, tenantId, "invoicing", "quickbooks");
    const now = new Date().toISOString();
    const invoiceId = stableId("invoice_auto", tenantId, projectId, contract.id);
    const providerInvoiceId = provider === "stripe"
      ? `stripe_invoice_${invoiceId}`
      : `qbo_invoice_${invoiceId}`;
    const agreedRetainer = await agreedRetainerCents(
      db,
      tenantId,
      projectId,
      packageSnapshot,
    );
    const days = Math.min(30, Math.max(1, Number(plan.get("policy.retainerDueDays") ?? 7)));
    const eventDocument = productEvent({
      tenantId,
      projectId,
      actorId: "booking-orchestrator",
      actorType: "system",
      name: "booking.retainer_queued",
      occurredAt: now,
      correlationId: contract.id,
      sourceEntityType: "invoiceReference",
      sourceEntityId: invoiceId,
      properties: { contractId: contract.id, provider },
    });

    await db.runTransaction(async (transaction) => {
      const [currentPlan, existingInvoice] = await Promise.all([
        transaction.get(planReference),
        transaction.get(db.doc(`invoiceReferences/${invoiceId}`)),
      ]);
      if (!currentPlan.exists || currentPlan.get("status") !== "active") return;
      if (!existingInvoice.exists) {
        transaction.create(existingInvoice.ref, {
          id: invoiceId,
          tenantId,
          projectId,
          kind: "retainer",
          provider,
          providerInvoiceId,
          providerCustomerId: `pending_${projectId}`,
          status: "sent",
          currency: packageSnapshot.get("currency") ?? "USD",
          // The same figure the command raises. Two paths create a
          // retainer and they must not disagree about what the couple
          // agreed to pay.
          amountCents: agreedRetainer,
          balanceCents: agreedRetainer,
          dueDate: dueDate(days, now, String(project.get("timezone") ?? "")),
          hostedUrl: null,
          lastSyncedAt: now,
          lastProviderEventId: null,
          providerState: "queued",
          createdAt: now,
          updatedAt: now,
          createdBy: "booking-orchestrator",
          updatedBy: "booking-orchestrator",
          archivedAt: null,
        });
        transaction.create(db.doc(`providerJobs/invoice_${invoiceId}`), {
          tenantId,
          projectId,
          type: provider === "stripe" ? "create_stripe_invoice" : "create_quickbooks_invoice",
          invoiceId,
          idempotencyKey: stableId("retainer", tenantId, projectId, contract.id),
          status: "queued",
          attempts: 0,
          createdAt: now,
          updatedAt: now,
        });
        transaction.create(db.doc(`productEvents/${eventDocument.id}`), eventDocument);
        transaction.set(db.doc(`actionReceipts/booking_retainer_${projectId}`), {
          id: `booking_retainer_${projectId}`,
          tenantId,
          projectId,
          title: "Retainer prepared automatically",
          summary: "The signed agreement was verified and the retainer invoice was queued with the connected accounting provider.",
          status: "completed",
          source: "booking_orchestrator",
          affectedEntityType: "invoiceReference",
          affectedEntityId: invoiceId,
          providerEvidence: { contractId: contract.id, provider },
          reversible: false,
          retryable: true,
          canCancel: false,
          canRetry: true,
          attempts: 1,
          completedAt: now,
          createdAt: now,
          updatedAt: now,
          createdBy: "booking-orchestrator",
          updatedBy: "booking-orchestrator",
          archivedAt: null,
        }, { merge: true });
      }
      transaction.update(planReference, {
        invoiceId,
        currentStep: "wait_for_payment",
        // Raised after all (payments connected since the link went out): the
        // client is no longer told to arrange it with the studio.
        "policy.createRetainerAfterSignature": true,
        updatedAt: now,
      });
    });
  },
);

/**
 * Written, not updated — the same lesson as the contract trigger above.
 *
 * A provider retainer is created unpaid and cleared later by the webhook,
 * so an update trigger saw it. A retainer the studio records by hand is
 * created already paid, in one write, and this never fired: the plan stayed
 * on `create_retainer` against a retainer that was already in, and the
 * booking was never confirmed.
 *
 * The guards below already tolerate a create: `before` is a snapshot that
 * does not exist, so `wasPaid` is false, which is exactly right for a
 * retainer that has only just appeared.
 */
export const bookingRetainerPaid = onDocumentWritten(
  "invoiceReferences/{invoiceId}",
  async (event) => {
    const before = event.data?.before;
    const invoice = event.data?.after;
    // Also covers deletion, which a write trigger delivers and an update
    // trigger never did.
    if (!invoice?.exists || invoice.get("kind") !== "retainer") return;
    const isPaid = invoice.get("status") === "paid" && Number(invoice.get("balanceCents")) === 0;
    const wasPaid = before?.get("status") === "paid" && Number(before.get("balanceCents")) === 0;
    if (!isPaid || wasPaid) return;

    const db = getFirestore();
    const tenantId = String(invoice.get("tenantId") ?? "");
    const projectId = String(invoice.get("projectId") ?? "");
    if (!tenantId || !projectId) return;
    const planReference = db.doc(`bookingOrchestrations/${projectId}`);
    const projectReference = db.doc(`projects/${projectId}`);
    const [plan, project, contracts] = await Promise.all([
      planReference.get(),
      projectReference.get(),
      db.collection("contracts")
        .where("tenantId", "==", tenantId)
        .where("projectId", "==", projectId)
        .where("status", "==", "completed")
        .limit(1)
        .get(),
    ]);
    /**
     * Say why, when this declines to act.
     *
     * Each of these used to be a bare `return`. The booking workspace shows
     * "Automatic confirmation is active — StudioCue will run the evidence
     * check as soon as the connected provider reports the retainer paid" for
     * as long as the plan is active, so a decline here left that sentence on
     * screen permanently with nothing anywhere to say the trigger had looked
     * and walked away. The retainer was paid; the promise was not kept; the
     * studio had no way to find out why.
     *
     * Declining is often correct — this is a write trigger and fires on
     * invoices with no plan at all. What was wrong was doing it silently
     * while a plan was open and waiting on precisely this event.
     */
    /**
     * Already booked: a retainer paid after booking on an approved exception
     * (commands.ts, recordRetainerPayment). There is nothing to book, and
     * running on would throw INVALID_BOOKING_STATE on every retry.
     */
    if (
      project.exists &&
      ["BOOKED", "PLANNING", "READY", "EVENT_COMPLETE", "POST_PRODUCTION", "DELIVERED", "REVIEW_REQUESTED", "CLOSED"].includes(
        String(project.get("state")),
      )
    )
      return;
    /**
     * Paid after the job was called off.
     *
     * The couple paid a retainer invoice that was still out when the studio
     * cancelled the job or closed the inquiry as lost. This used to run on to
     * the transaction below and throw INVALID_BOOKING_STATE inside a trigger
     * with no retry — the plan stayed "active" for ever and nobody was told
     * that money had arrived for a wedding that is not happening (money
     * audit, 2026-09-30). There is nothing to book; the studio has a decision
     * to make about the money, so it gets a task, and the plan is closed.
     */
    if (project.exists && jobCalledOff(project.data())) {
      const paidCents = Math.max(
        0,
        Number(invoice.get("amountCents") ?? 0) - Number(invoice.get("balanceCents") ?? 0),
      );
      await db.runTransaction(async (transaction) => {
        const [currentPlan, refundTask] = await Promise.all([
          transaction.get(planReference),
          transaction.get(db.doc(`tasks/refund_or_keep_${projectId}`)),
        ]);
        const now = new Date().toISOString();
        if (currentPlan.exists && ["active", "needs_attention"].includes(String(currentPlan.get("status"))))
          transaction.update(planReference, {
            status: "cancelled",
            currentStep: "cancelled",
            cancelledAt: now,
            cancelledReason: "project_called_off",
            updatedAt: now,
          });
        if (!refundTask.exists && paidCents > 0) {
          const task = refundOrKeepTask({
            tenantId,
            projectId,
            paidCents,
            currency: String(invoice.get("currency") ?? "USD"),
            now,
            actor: "booking-orchestrator",
          });
          transaction.set(db.doc(`tasks/${task.id}`), task);
        }
      });
      return;
    }
    const declineReason = !plan.exists
      ? "no_plan"
      : plan.get("status") !== "active"
        ? `plan_${String(plan.get("status"))}`
        : plan.get("policy.completeBookingAfterPayment") !== true
          ? "policy_does_not_complete_after_payment"
          : !project.exists || project.get("tenantId") !== tenantId
            ? "project_mismatch"
            : null;
    if (declineReason) {
      // Only worth a line when a plan was actually waiting on this.
      if (plan.exists && plan.get("status") === "active") {
        logger.error("bookingRetainerPaidDeclined", {
          studiocueOperationalError: true,
          code: "BOOKING_AUTOMATION_STALLED",
          reason: declineReason,
          tenantId,
          projectId,
          invoiceId: invoice.id,
        });
      }
      return;
    }

    await runAutomaticGate(db, {
      tenantId,
      projectId,
      invoice,
      contracts,
      project,
      planReference,
      projectReference,
      triggerId: invoice.id,
    });
  },
);

/**
 * The automatic booking gate, once the job's requirements may be met.
 *
 * Run when a retainer is paid (bookingRetainerPaid), and — for a kind of job
 * that books without paying (a sports day, an invoice-after corporate job) —
 * when its proposal is accepted (bookWithoutAgreement). One copy, because two
 * gates that disagree are how jobs book that shouldn't (gate-requirements.ts).
 * `invoice` is null when no payment was asked for.
 */
async function runAutomaticGate(
  db: Firestore,
  input: {
    tenantId: string;
    projectId: string;
    invoice: DocumentSnapshot | null;
    contracts: QuerySnapshot;
    project: DocumentSnapshot;
    planReference: DocumentReference;
    projectReference: DocumentReference;
    /** What fired this: the invoice, or the accepted proposal. Keys the ids. */
    triggerId: string;
  },
): Promise<void> {
  const { tenantId, projectId, invoice, contracts, project, planReference, projectReference, triggerId } = input;
    const eventDate = String(project.get("eventDate") ?? "");
    const contactIds = strings(project.get("clientContactIds"));
    const [sameDateProjects, contacts] = await Promise.all([
      db.collection("projects").where("tenantId", "==", tenantId).where("eventDate", "==", eventDate).get(),
      Promise.all(contactIds.map((contactId) => db.doc(`contacts/${contactId}`).get())),
    ]);
    const blockingStates = new Set(["BOOKED", "PLANNING", "READY", "EVENT_COMPLETE"]);
    /**
     * Evidence, then requirements — not evidence treated as requirements.
     *
     * `blockers` was derived straight from this object by "anything not
     * true", and `contractAttestedManually` was hardcoded `false` on the
     * reasoning that the orchestrator only ever runs behind a provider
     * signature. So it was permanently in the blocker list and the automatic
     * gate could never pass. Not "rarely" — never, for any booking, however
     * complete: the run this was found on had contractCompleted,
     * eventDateAvailable, requiredContactsComplete, retainerInvoiceCreated
     * and retainerSatisfied all true, and still stopped with a single
     * blocker naming a flag that is not a requirement.
     *
     * Several of these fields answer the same requirement by different
     * authorities, which is exactly what `bookingGateRequirements` folds —
     * `runBookingGate` has always called it. The orchestrator built its own
     * shape and skipped it.
     *
     * The premise was wrong too. This trigger fires on a retainer invoice
     * reaching paid, by any authority, and the retainer that got here was
     * `manual_attested`. Both authorities are now read from the records
     * rather than assumed.
     */
    const contractAttestedManually = contracts.docs.some(
      (contract) =>
        studioVouchedAuthorities.includes(
          String(contract.get("completionAuthority")),
        ),
    );
    const retainerAttestedManually = invoice
      ? studioVouchedAuthorities.includes(String(invoice.get("completionAuthority")))
      : false;
    const checks = {
      contractCompleted: !contracts.empty && !contractAttestedManually,
      contractAttestedManually,
      retainerInvoiceCreated: Boolean(invoice),
      retainerAttestedManually,
      retainerSatisfied: Boolean(invoice) && !retainerAttestedManually,
      retainerExceptionApproved: false,
      eventDateAvailable: Boolean(eventDate) && !dateClashes(
        project.data(),
        sameDateProjects.docs
          .filter(
            (candidate) =>
              candidate.id !== projectId &&
              // An archived job holds no date (see commands.ts, runBookingGate).
              !candidate.get("archivedAt") &&
              blockingStates.has(String(candidate.get("state"))),
          )
          .map((candidate) => candidate.data()),
      ),
      requiredContactsComplete: contactIds.length > 0 && contacts.every(
        (contact) => contact.exists &&
          contact.get("tenantId") === tenantId &&
          String(contact.get("email") ?? "").includes("@") &&
          String(contact.get("displayName") ?? "").trim().length > 0,
      ),
    };
    // Fold the alternatives before asking what is missing. See
    // gate-requirements.ts. What the job needs comes from its kind
    // (job-kinds.ts): with no payment to book, no invoice is required.
    const needs = projectGateNeeds(project.data());
    const requirements = bookingGateRequirements(checks, needs);
    const blockers = Object.entries(requirements)
      .filter(([, passed]) => !passed)
      .map(([key]) => key);
    const now = new Date().toISOString();
    const gateId = stableId("gate_auto", tenantId, projectId, triggerId);
    const correlationId = stableId("booking_paid", tenantId, projectId, triggerId);
    const eventName = blockers.length
      ? "booking.exception_raised" as const
      : "booking.completed_automatically" as const;
    const eventDocument = productEvent({
      tenantId,
      projectId,
      actorId: "booking-orchestrator",
      actorType: "system",
      name: eventName,
      occurredAt: now,
      correlationId,
      sourceEntityType: blockers.length ? "bookingOrchestration" : "project",
      sourceEntityId: projectId,
      properties: { invoiceId: invoice?.id ?? null, blockers },
    });
    // The studio hears that it booked. A booking that completes itself is
    // otherwise invisible until someone opens the app.
    const studioAddress = blockers.length
      ? null
      : await studioNotificationAddress(db, tenantId).catch(() => null);

    await db.runTransaction(async (transaction) => {
      const [currentPlan, currentProject] = await Promise.all([
        transaction.get(planReference),
        transaction.get(projectReference),
      ]);
      if (!currentPlan.exists || currentPlan.get("status") !== "active") return;
      if (!currentProject.exists || currentProject.get("tenantId") !== tenantId) return;
      /**
       * Only RETAINER_PENDING books. Checked before anything is written: this
       * used to throw after the gate run and a "completed automatically"
       * event were staged, inside a trigger with no retry, so a job put on
       * hold (or called off) between the read above and this one failed
       * noisily and for ever. A held job is re-booked through the gate when
       * it comes back.
       */
      if (currentProject.get("state") !== "RETAINER_PENDING") {
        logger.error("bookingRetainerPaidDeclined", {
          studiocueOperationalError: true,
          code: "BOOKING_AUTOMATION_STALLED",
          reason: `project_${String(currentProject.get("state"))}`,
          tenantId,
          projectId,
          invoiceId: invoice?.id ?? null,
        });
        return;
      }
      transaction.set(db.doc(`bookingGateRuns/${gateId}`), {
        id: gateId,
        tenantId,
        projectId,
        checks,
        requirements,
        blockers,
        passed: blockers.length === 0,
        profile: { kind: jobKindOf(project.data()), ...needs },
        rulesVersion: 3,
        source: "booking_orchestrator",
        createdAt: now,
        createdBy: "booking-orchestrator",
      }, { merge: false });
      transaction.create(db.doc(`productEvents/${eventDocument.id}`), eventDocument);
      if (blockers.length) {
        transaction.update(planReference, {
          status: "needs_attention",
          currentStep: "needs_attention",
          blockers,
          lastError: "BOOKING_GATE_BLOCKED",
          updatedAt: now,
        });
        /**
         * Shaped like features/tasks/schema.ts, because it is a task.
         *
         * This wrote `status: "open"` and `assignedTo` / `dueAt` — none of
         * which the task schema has. On the live tasks list the row read
         * "Resolve booking exception · open · Blocking —" beside tasks reading
         * "not started · Blocking No", and `blocking` was absent entirely on a
         * task that by definition blocks the booking.
         */
        transaction.set(db.doc(`tasks/booking_exception_${projectId}`), {
          id: `booking_exception_${projectId}`,
          tenantId,
          projectId,
          workflowRunId: null,
          checkpointId: null,
          title: "Resolve booking exception",
          description: `StudioCue stopped safely: ${blockers.join(", ")}.`,
          status: "not_started",
          priority: "urgent",
          assignedUserId: null,
          assignedRole: "studio_owner",
          dueDate: now.slice(0, 10),
          blocking: true,
          completedAt: null,
          completedBy: null,
          source: "booking_orchestrator",
          createdAt: now,
          updatedAt: now,
          createdBy: "booking-orchestrator",
          updatedBy: "booking-orchestrator",
          archivedAt: null,
        }, { merge: true });
        return;
      }
      const priorVersion = Number(currentProject.get("stateVersion") ?? 0);
      transaction.update(projectReference, {
        state: "BOOKED",
        stateVersion: priorVersion + 1,
        bookingCompletedAt: now,
        clientPortalActive: true,
        updatedAt: now,
        updatedBy: "booking-orchestrator",
      });
      transaction.update(planReference, {
        status: "completed",
        currentStep: "completed",
        blockers: [],
        lastError: null,
        completedAt: now,
        updatedAt: now,
      });
      transaction.set(db.doc(`providerJobs/booking_${projectId}`), {
        tenantId,
        projectId,
        type: "complete_booking_side_effects",
        idempotencyKey: correlationId,
        status: "queued",
        steps: ["dropbox_folders", "production_calendar", "workflow", "checkpoints", "crew_plan", "confirmation"],
        createdAt: now,
        updatedAt: now,
      }, { merge: true });
      if (studioAddress) {
        transaction.set(db.doc(`emailJobs/studio_booked_${projectId}`), {
          id: `studio_booked_${projectId}`,
          tenantId,
          projectId,
          type: "studio_booking_confirmed",
          recipient: studioAddress,
          actionUrl: `${(process.env.NEXT_PUBLIC_APP_URL ?? "https://studio-cue.com").replace(/\/$/, "")}/studio/projects/${projectId}`,
          status: "queued",
          attempts: 0,
          createdAt: now,
          updatedAt: now,
        }, { merge: false });
      }
      transaction.set(db.doc(`actionReceipts/booking_complete_${projectId}`), {
        id: `booking_complete_${projectId}`,
        tenantId,
        projectId,
        title: "Booking completed automatically",
        summary: needs.agreement && needs.payment
          ? "StudioCue verified the signed agreement and cleared retainer, then confirmed the booking and queued project setup."
          : needs.payment
            ? "StudioCue confirmed the payment, then booked the job and queued its setup. This kind of job books without an agreement."
            : "StudioCue booked the job on its date and contact details, and queued its setup. This kind of job is paid later.",
        status: "completed",
        source: "booking_orchestrator",
        affectedEntityType: "project",
        affectedEntityId: projectId,
        providerEvidence: { contractId: contracts.docs[0]?.id ?? null, invoiceId: invoice?.id ?? null },
        reversible: false,
        retryable: true,
        canCancel: false,
        canRetry: true,
        attempts: 1,
        completedAt: now,
        createdAt: now,
        updatedAt: now,
        createdBy: "booking-orchestrator",
        updatedBy: "booking-orchestrator",
        archivedAt: null,
      }, { merge: true });
    });
}

/** Every payment line the client agreed to, added up: the whole price. */
function fullAmountFromSchedule(schedule: unknown, fallbackCents: number): number {
  if (!Array.isArray(schedule) || !schedule.length) return fallbackCents;
  const total = schedule.reduce(
    (sum, entry) => sum + Number((entry as { amountCents?: unknown })?.amountCents ?? 0),
    0,
  );
  return Number.isInteger(total) && total > 0 ? total : fallbackCents;
}

/**
 * Booking a job whose kind has no agreement (job-kinds.ts).
 *
 * Accepting a proposal moves a job to CONTRACT_PENDING, and for a wedding the
 * agreement goes out from there. A family session has no agreement — "that's
 * overkill" (GR Productions, 2026-10-02) — so this moves it on at once, with
 * the reason on the audit trail:
 *
 * - **Paid to book** (family, paid in full; or a deposit): the invoice is
 *   raised now — the whole price when the package is paid in full — and the
 *   job books itself when it is paid (bookingRetainerPaid → runAutomaticGate).
 *   "Book & pay": the client accepts, pays, and is booked; the studio taps
 *   nothing.
 * - **Nothing to book** (sports, paid on the day; or invoiced after): the
 *   gate runs now and books it on its date and contact details. The bill is
 *   raised later (invoice-scheduler.ts).
 *
 * Either way the gate, not this, decides: it re-reads the job and records the
 * profile it used. Ids derive from the proposal, so a retried trigger cannot
 * raise a second invoice.
 */
async function bookWithoutAgreement(
  db: Firestore,
  input: { tenantId: string; projectId: string; proposal: DocumentSnapshot },
): Promise<void> {
  const { tenantId, projectId, proposal } = input;
  const projectReference = db.doc(`projects/${projectId}`);
  const planReference = db.doc(`bookingOrchestrations/${projectId}`);
  const project = await projectReference.get();
  if (!project.exists || project.get("tenantId") !== tenantId) return;
  if (project.get("state") !== "CONTRACT_PENDING") {
    logger.info("bookWithoutAgreementSkipped", { tenantId, projectId, reason: `project_${String(project.get("state"))}` });
    return;
  }
  if (jobCalledOff(project.data())) return;
  const needs = projectGateNeeds(project.data());
  const kind = jobKindOf(project.data());
  const now = new Date().toISOString();
  const retainerDueDays = 7;

  let invoice: { id: string; data: Record<string, unknown>; providerJob: Record<string, unknown> } | null = null;
  // A job the studio bills itself raises nothing at QuickBooks: the plan
  // below already says the studio takes the payment (depositByStudio), and
  // the job's step reads "Record the deposit". Before, this queued a
  // QuickBooks invoice for a studio with no QuickBooks, which could only fail.
  const billing = needs.payment ? await jobBillingFor(db, tenantId, projectId, project.data() ?? null) : null;
  if (needs.payment && billing?.method === "quickbooks") {
    const existing = await db
      .collection("invoiceReferences")
      .where("tenantId", "==", tenantId)
      .where("projectId", "==", projectId)
      .where("kind", "==", "retainer")
      .limit(10)
      .get();
    if (!existing.docs.some((document) => isStandingInvoice(document.get("status")))) {
      const packageSnapshotId = String(project.get("packageSnapshotId") ?? "");
      const jobSnapshots = packageSnapshotId ? await readJobSnapshots(db, project.data(), tenantId) : [];
      const packageSnapshot =
        jobSnapshots.length && jobSnapshots[0]!.id === packageSnapshotId ? combinedSnapshot(jobSnapshots) : null;
      if (!packageSnapshot) {
        logger.error("bookWithoutAgreementNoPackage", { tenantId, projectId });
        return;
      }
      const paidInFull = project.get("paymentShape") === "paid_in_full" ||
        (!project.get("paymentShape") && kind === "portraits");
      const amountCents = paidInFull
        ? fullAmountFromSchedule(
            proposal.get("paymentSchedule"),
            Number(packageSnapshot.get("totalCents") ?? 0),
          )
        : await agreedRetainerCents(db, tenantId, projectId, packageSnapshot);
      const provider = await resolveProviderForTenant(db, tenantId, "invoicing", "quickbooks");
      const invoiceId = stableId("invoice_auto", tenantId, projectId, proposal.id);
      invoice = {
        id: invoiceId,
        data: {
          id: invoiceId,
          tenantId,
          projectId,
          kind: "retainer",
          // Paid in full: this one invoice is the whole price, and no final
          // balance follows (hasFinalBalance in job-kinds.ts).
          paidInFull,
          provider,
          providerInvoiceId: provider === "stripe" ? `stripe_invoice_${invoiceId}` : `qbo_invoice_${invoiceId}`,
          providerCustomerId: `pending_${projectId}`,
          status: "sent",
          currency: packageSnapshot.get("currency") ?? "USD",
          amountCents,
          balanceCents: amountCents,
          dueDate: dueDate(retainerDueDays, now, String(project.get("timezone") ?? "")),
          hostedUrl: null,
          lastSyncedAt: now,
          lastProviderEventId: null,
          providerState: "queued",
          createdAt: now,
          updatedAt: now,
          createdBy: "booking-orchestrator",
          updatedBy: "booking-orchestrator",
          archivedAt: null,
        },
        providerJob: {
          tenantId,
          projectId,
          type: provider === "stripe" ? "create_stripe_invoice" : "create_quickbooks_invoice",
          invoiceId,
          idempotencyKey: stableId("retainer", tenantId, projectId, proposal.id),
          status: "queued",
          attempts: 0,
          createdAt: now,
          updatedAt: now,
        },
      };
    }
  }

  const moved = await db.runTransaction(async (transaction) => {
    const current = await transaction.get(projectReference);
    if (!current.exists || current.get("state") !== "CONTRACT_PENDING") return false;
    const priorVersion = Number(current.get("stateVersion") ?? 0);
    transaction.update(projectReference, {
      state: "RETAINER_PENDING",
      stateVersion: priorVersion + 1,
      nextAction: needs.payment ? "Waiting for the client to pay" : "Booking",
      updatedAt: now,
      updatedBy: "booking-orchestrator",
    });
    const auditId = stableId("audit_no_agreement", tenantId, projectId, proposal.id);
    transaction.create(db.doc(`auditEvents/${auditId}`), {
      id: auditId,
      tenantId,
      projectId,
      actorId: "booking-orchestrator",
      actorType: "system",
      action: "project.state_changed",
      entityType: "project",
      entityId: projectId,
      timestamp: now,
      before: { state: "CONTRACT_PENDING", stateVersion: priorVersion },
      after: {
        state: "RETAINER_PENDING",
        stateVersion: priorVersion + 1,
        reason: `This kind of job (${kind}) books without an agreement`,
        profile: { kind, ...needs },
      },
      ipAddress: null,
      userAgent: null,
      correlationId: proposal.id,
      automationRunId: null,
      providerEventId: null,
    });
    if (invoice) {
      transaction.create(db.doc(`invoiceReferences/${invoice.id}`), invoice.data);
      transaction.create(db.doc(`providerJobs/invoice_${invoice.id}`), invoice.providerJob);
    }
    transaction.set(planReference, {
      id: projectId,
      tenantId,
      projectId,
      proposalId: proposal.id,
      contractId: null,
      invoiceId: invoice?.id ?? null,
      status: "active",
      currentStep: needs.payment ? "wait_for_payment" : "wait_for_gate",
      policy: {
        createRetainerAfterSignature: false,
        completeBookingAfterPayment: true,
        retainerDueDays,
        noAgreement: true,
      },
      approvedBy: "studio_policy:job_kind",
      approvedAt: now,
      lastError: null,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    }, { merge: false });
    // "Prepare client agreement" has nothing to prepare.
    transaction.set(db.doc(`tasks/proposal_decision_${proposal.id}`), {
      status: "complete",
      completedAt: now,
      completedBy: "booking-orchestrator",
      updatedAt: now,
      updatedBy: "booking-orchestrator",
    }, { merge: true });
    return true;
  });
  if (!moved || needs.payment) return;

  // Nothing to pay to book: the gate decides now.
  const [booked, contracts] = await Promise.all([
    projectReference.get(),
    db.collection("contracts")
      .where("tenantId", "==", tenantId)
      .where("projectId", "==", projectId)
      .where("status", "==", "completed")
      .limit(1)
      .get(),
  ]);
  await runAutomaticGate(db, {
    tenantId,
    projectId,
    invoice: null,
    contracts,
    project: booked,
    planReference,
    projectReference,
    triggerId: proposal.id,
  });
}
