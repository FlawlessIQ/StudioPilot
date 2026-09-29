import { getFirestore } from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { clientAutomationsPaused } from "../imports/existing-booking.js";
import { retainerFromSchedule } from "../booking/agreed-retainer.js";

const date = (value: Date) => value.toISOString().slice(0, 10);

export const finalInvoiceScheduler = onSchedule(
  {
    schedule: "every day 06:00",
    timeZone: "UTC",
    retryCount: 3,
  },
  async () => {
    const db = getFirestore();
    const today = new Date();
    const target = new Date(today);
    target.setUTCDate(target.getUTCDate() + 28);
    const projects = await db
      .collection("projects")
      .where("eventDate", "==", date(target))
      .where("state", "in", ["BOOKED", "PLANNING", "READY"])
      .limit(100)
      .get();

    for (const project of projects.docs) {
      // A quiet imported booking is usually billed elsewhere already; raising
      // and emailing a final invoice would be a second bill for one wedding.
      if (clientAutomationsPaused(project.data())) continue;
      await db.runTransaction(async (transaction) => {
        const invoiceReference = db.doc(
          `invoiceReferences/final_${project.id}`,
        );
        if ((await transaction.get(invoiceReference)).exists) return;
        const snapshotId = String(project.get("packageSnapshotId") ?? "");
        if (!snapshotId) return;
        const packageSnapshot = await transaction.get(
          db.doc(`packageSnapshots/${snapshotId}`),
        );
        if (!packageSnapshot.exists) return;
        const retainers = await transaction.get(
          db
            .collection("invoiceReferences")
            .where("tenantId", "==", project.get("tenantId"))
            .where("projectId", "==", project.id)
            .where("kind", "==", "retainer")
            .limit(1),
        );
        const retainer = retainers.docs[0];
        if (!retainer) return;
        const customerId = retainer.get("providerCustomerId");
        if (typeof customerId !== "string") return;

        // What the couple agreed to is the accepted proposal: every package
        // on the job, and the retainer as scheduled. The primary package's
        // snapshot left out a second package, and flagged every retainer the
        // studio had set by hand as a mismatch (H2, M2/M3).
        const accepted = (
          await transaction.get(
            db
              .collection("proposals")
              .where("tenantId", "==", project.get("tenantId"))
              .where("projectId", "==", project.id)
              .where("status", "==", "accepted")
              .limit(1),
          )
        ).docs[0];
        const agreedPricing = (accepted?.get("pricingSnapshot") ?? null) as Record<string, unknown> | null;
        const agreedTotal = Number(agreedPricing?.totalCents);
        const fromProposal = Boolean(accepted && Number.isSafeInteger(agreedTotal) && agreedTotal > 0);
        const source = fromProposal ? `proposals/${accepted!.id}` : `packageSnapshots/${snapshotId}`;
        const totalCents = fromProposal ? agreedTotal : Number(packageSnapshot.get("totalCents") ?? 0);
        const taxCents = fromProposal
          ? Number(agreedPricing?.taxCents ?? 0)
          : Number(packageSnapshot.get("taxCents") ?? 0);
        const retainerExpectedCents = retainerFromSchedule(
          accepted?.get("paymentSchedule"),
          Number(packageSnapshot.get("retainerCents") ?? 0),
        );
        const retainerAmountCents = Number(
          retainer.get("amountCents") ?? retainerExpectedCents,
        );
        const retainerBalanceCents = Number(
          retainer.get("balanceCents") ?? retainerAmountCents,
        );
        const retainerPaidCents = Math.max(
          0,
          retainerAmountCents - retainerBalanceCents,
        );
        const amountCents = totalCents - retainerPaidCents;
        if (
          !Number.isSafeInteger(totalCents) ||
          !Number.isSafeInteger(amountCents) ||
          amountCents <= 0
        )
          return;

        const discrepancies: string[] = [];
        if (retainerPaidCents !== retainerExpectedCents)
          discrepancies.push("RETAINER_EVIDENCE_MISMATCH");
        const readyForProviderDraft = discrepancies.length === 0;
        const due = new Date(`${String(project.get("eventDate"))}T00:00:00Z`);
        due.setUTCDate(due.getUTCDate() - 14);
        const now = new Date().toISOString();
        const calculation = {
          lines: [
            {
              label: "Approved package and add-ons",
              amountCents: totalCents - taxCents,
              source,
            },
            {
              label: "Approved tax",
              amountCents: taxCents,
              source,
            },
            {
              label: "Retainer payment received",
              amountCents: -retainerPaidCents,
              source: `invoiceReferences/${retainer.id}`,
            },
          ],
          packageTotalCents: totalCents,
          retainerExpectedCents,
          retainerPaidCents,
          expectedBalanceCents: amountCents,
          discrepancies,
          authority: "quickbooks",
          requiresHumanReview: true,
          calculatedAt: now,
        };
        transaction.create(invoiceReference, {
          id: `final_${project.id}`,
          tenantId: project.get("tenantId"),
          projectId: project.id,
          kind: "final",
          provider: "quickbooks",
          providerInvoiceId: readyForProviderDraft
            ? `pending_final_${project.id}`
            : null,
          providerCustomerId: customerId,
          status: readyForProviderDraft ? "draft" : "review_required",
          currency: packageSnapshot.get("currency"),
          amountCents,
          balanceCents: amountCents,
          dueDate: date(due),
          hostedUrl: null,
          lastSyncedAt: now,
          lastProviderEventId: null,
          providerState: readyForProviderDraft ? "queued" : "review_required",
          calculation,
          createdAt: now,
          updatedAt: now,
          createdBy: "final-invoice-scheduler",
          updatedBy: "final-invoice-scheduler",
          archivedAt: null,
        });
        if (readyForProviderDraft) {
          transaction.create(
            db.doc(`providerJobs/invoice_final_${project.id}`),
            {
              id: `invoice_final_${project.id}`,
              tenantId: project.get("tenantId"),
              projectId: project.id,
              type: "create_quickbooks_invoice",
              invoiceId: `final_${project.id}`,
              idempotencyKey: `final-invoice-${project.id}`,
              status: "queued",
              attempts: 0,
              createdAt: now,
              updatedAt: now,
            },
          );
        }
      });
    }

    const overdue = await db
      .collection("invoiceReferences")
      .where("balanceCents", ">", 0)
      .where("dueDate", "<", date(today))
      .limit(200)
      .get();
    const batch = db.batch();
    for (const invoice of overdue.docs) {
      if (
        !["voided", "refunded", "paid"].includes(
          String(invoice.get("status")),
        )
      )
        batch.update(invoice.ref, {
          status: "overdue",
          updatedAt: new Date().toISOString(),
          updatedBy: "invoice-scheduler",
        });
    }
    await batch.commit();
  },
);
