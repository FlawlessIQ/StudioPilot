import { createHash } from "node:crypto";
import { getFirestore } from "firebase-admin/firestore";
import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { resolveProviderForTenant } from "../integrations/capability-resolution.js";
import { productEvent } from "../operations/product-events.js";

function stableId(scope: string, ...parts: string[]) {
  return `${scope}_${createHash("sha256")
    .update(parts.join(":"))
    .digest("hex")
    .slice(0, 32)}`;
}

function dueDate(days: number, from: string) {
  const value = new Date(from);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export const bookingContractCompleted = onDocumentUpdated(
  "contracts/{contractId}",
  async (event) => {
    const before = event.data?.before;
    const contract = event.data?.after;
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
        .limit(1)
        .get(),
    ]);
    if (
      !plan.exists ||
      plan.get("status") !== "active" ||
      plan.get("contractId") !== contract.id ||
      plan.get("policy.createRetainerAfterSignature") !== true
    ) return;
    if (!project.exists || project.get("tenantId") !== tenantId) return;
    if (!existingInvoices.empty) {
      await planReference.update({
        invoiceId: existingInvoices.docs[0]!.id,
        currentStep: "wait_for_payment",
        updatedAt: new Date().toISOString(),
      });
      return;
    }
    const packageSnapshotId = String(project.get("packageSnapshotId") ?? "");
    if (!packageSnapshotId) throw new Error("PACKAGE_SNAPSHOT_NOT_FOUND");
    const packageSnapshot = await db.doc(`packageSnapshots/${packageSnapshotId}`).get();
    if (!packageSnapshot.exists || packageSnapshot.get("tenantId") !== tenantId)
      throw new Error("PACKAGE_SNAPSHOT_NOT_FOUND");
    const provider = await resolveProviderForTenant(db, tenantId, "invoicing", "quickbooks");
    const now = new Date().toISOString();
    const invoiceId = stableId("invoice_auto", tenantId, projectId, contract.id);
    const providerInvoiceId = provider === "stripe"
      ? `stripe_invoice_${invoiceId}`
      : `qbo_invoice_${invoiceId}`;
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
          amountCents: Number(packageSnapshot.get("retainerCents") ?? 0),
          balanceCents: Number(packageSnapshot.get("retainerCents") ?? 0),
          dueDate: dueDate(days, now),
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
        updatedAt: now,
      });
    });
  },
);

export const bookingRetainerPaid = onDocumentUpdated(
  "invoiceReferences/{invoiceId}",
  async (event) => {
    const before = event.data?.before;
    const invoice = event.data?.after;
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
    if (
      !plan.exists ||
      plan.get("status") !== "active" ||
      plan.get("policy.completeBookingAfterPayment") !== true ||
      !project.exists ||
      project.get("tenantId") !== tenantId
    ) return;

    const eventDate = String(project.get("eventDate") ?? "");
    const contactIds = strings(project.get("clientContactIds"));
    const [sameDateProjects, contacts] = await Promise.all([
      db.collection("projects").where("tenantId", "==", tenantId).where("eventDate", "==", eventDate).get(),
      Promise.all(contactIds.map((contactId) => db.doc(`contacts/${contactId}`).get())),
    ]);
    const blockingStates = new Set(["BOOKED", "PLANNING", "READY", "EVENT_COMPLETE"]);
    const checks = {
      contractCompleted: !contracts.empty,
      // The orchestrator only runs behind a provider signature, so an
      // attestation never reaches it; declared so the evidence shape stays
      // one thing rather than two.
      contractAttestedManually: false,
      retainerInvoiceCreated: true,
      retainerSatisfied: true,
      eventDateAvailable: Boolean(eventDate) && !sameDateProjects.docs.some(
        (candidate) => candidate.id !== projectId && blockingStates.has(String(candidate.get("state"))),
      ),
      requiredContactsComplete: contactIds.length > 0 && contacts.every(
        (contact) => contact.exists &&
          contact.get("tenantId") === tenantId &&
          String(contact.get("email") ?? "").includes("@") &&
          String(contact.get("displayName") ?? "").trim().length > 0,
      ),
    };
    const blockers = Object.entries(checks).filter(([, passed]) => !passed).map(([key]) => key);
    const now = new Date().toISOString();
    const gateId = stableId("gate_auto", tenantId, projectId, invoice.id);
    const correlationId = stableId("booking_paid", tenantId, projectId, invoice.id);
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
      properties: { invoiceId: invoice.id, blockers },
    });

    await db.runTransaction(async (transaction) => {
      const [currentPlan, currentProject] = await Promise.all([
        transaction.get(planReference),
        transaction.get(projectReference),
      ]);
      if (!currentPlan.exists || currentPlan.get("status") !== "active") return;
      if (!currentProject.exists || currentProject.get("tenantId") !== tenantId) return;
      transaction.set(db.doc(`bookingGateRuns/${gateId}`), {
        id: gateId,
        tenantId,
        projectId,
        checks,
        blockers,
        passed: blockers.length === 0,
        rulesVersion: 2,
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
        transaction.set(db.doc(`tasks/booking_exception_${projectId}`), {
          id: `booking_exception_${projectId}`,
          tenantId,
          projectId,
          title: "Resolve booking exception",
          description: `StudioCue stopped safely: ${blockers.join(", ")}.`,
          status: "open",
          priority: "urgent",
          assignedTo: null,
          dueAt: now,
          source: "booking_orchestrator",
          createdAt: now,
          updatedAt: now,
          createdBy: "booking-orchestrator",
          updatedBy: "booking-orchestrator",
          archivedAt: null,
        }, { merge: true });
        return;
      }
      if (currentProject.get("state") !== "RETAINER_PENDING")
        throw new Error("INVALID_BOOKING_STATE");
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
        steps: ["dropbox_folders", "production_calendar", "workflow", "checkpoints", "confirmation"],
        createdAt: now,
        updatedAt: now,
      }, { merge: true });
      transaction.set(db.doc(`actionReceipts/booking_complete_${projectId}`), {
        id: `booking_complete_${projectId}`,
        tenantId,
        projectId,
        title: "Booking completed automatically",
        summary: "StudioCue verified the signed agreement and cleared retainer, then confirmed the booking and queued project setup.",
        status: "completed",
        source: "booking_orchestrator",
        affectedEntityType: "project",
        affectedEntityId: projectId,
        providerEvidence: { contractId: contracts.docs[0]!.id, invoiceId: invoice.id },
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
