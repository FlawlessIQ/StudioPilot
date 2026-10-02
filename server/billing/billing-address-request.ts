import { createHash } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import type { BillingAddress } from "@/features/contacts/schema";
import {
  readSigningBillingAddress,
  writeSigningBillingAddress,
} from "@/server/contracts/signing-billing-address";
import type { RequestEvidence, SignerIdentity } from "@/server/contracts/client-signing";

/**
 * The couple's side of a billing-address request
 * (functions/src/billing/billing-address-request.ts asks; this answers).
 *
 * The card on their portal shows when the studio's settings need an address
 * (the same rule as at signing: QuickBooks sales tax, not exempt) and their
 * own contact has none. Saved where signing saves it — their own contact,
 * found by the email they signed in with, never an id the page sends — and
 * marked theirs. Then the request closes, and a final already held for want
 * of an address has its tax worked out again, the studio's "Work the tax out
 * again" done for them.
 */

const stableId = (scope: string, ...parts: string[]) =>
  `${scope}_${createHash("sha256").update(parts.join(":")).digest("hex").slice(0, 32)}`;

export async function billingAddressRequestFor(
  db: Firestore,
  input: { tenantId: string; projectId: string; email: string | null },
): Promise<{ needed: boolean }> {
  const context = await readSigningBillingAddress(db, (reference) => reference.get(), {
    tenantId: input.tenantId,
    projectId: input.projectId,
    signerEmail: input.email,
    kind: "contract",
  });
  return { needed: context.requirement === "required" && Boolean(context.contact) && !context.onFile };
}

export async function confirmRequestedBillingAddress(
  db: Firestore,
  input: {
    tenantId: string;
    projectId: string;
    address: BillingAddress;
    signer: SignerIdentity;
    evidence: RequestEvidence;
    now?: string;
  },
): Promise<{ saved: boolean; recalculating: string[] }> {
  const now = input.now ?? new Date().toISOString();
  const requestReference = db.doc(`billingAddressRequests/${input.tenantId}_${input.projectId}`);
  return db.runTransaction(async (transaction) => {
    const context = await readSigningBillingAddress(db, (reference) => transaction.get(reference), {
      tenantId: input.tenantId,
      projectId: input.projectId,
      signerEmail: input.signer.email,
      kind: "contract",
    });
    if (context.requirement === "hidden") throw new Error("BILLING_ADDRESS_NOT_ASKED");
    if (!context.contact) throw new Error("BILLING_ADDRESS_CONTACT_NOT_FOUND");
    const [request, held] = await Promise.all([
      transaction.get(requestReference),
      transaction.get(
        db
          .collection("invoiceReferences")
          .where("tenantId", "==", input.tenantId)
          .where("projectId", "==", input.projectId)
          .where("kind", "==", "final")
          .limit(10),
      ),
    ]);
    // Finals held only because QuickBooks had no address to tax from.
    const waiting = held.docs.filter((invoice) => {
      const review = (invoice.get("sendReview") ?? {}) as Record<string, unknown>;
      return (
        invoice.get("status") === "review_required" &&
        review.state === "awaiting_studio" &&
        review.billingAddressMissing === true
      );
    });

    const saved = writeSigningBillingAddress(db, transaction, {
      context,
      address: input.address,
      tenantId: input.tenantId,
      projectId: input.projectId,
      via: "address_request",
      recordId: requestReference.id,
      auditId: stableId("audit_billing_address", input.tenantId, input.projectId, input.signer.uid, now),
      now,
      signer: input.signer,
      evidence: input.evidence,
    });
    if (request.exists)
      transaction.update(requestReference, { status: "received", receivedAt: now, receivedVia: "couple", updatedAt: now });

    const recalculating: string[] = [];
    for (const invoice of waiting) {
      // The same job the studio's "Work the tax out again" queues
      // (functions/src/booking/held-invoice-send.ts), so the worker treats it
      // exactly the same: it updates the couple in QuickBooks and asks again.
      const jobId = stableId("held_invoice", input.tenantId, invoice.id, `address_${now}`);
      const review = (invoice.get("sendReview") ?? {}) as Record<string, unknown>;
      transaction.update(invoice.ref, {
        sendReview: {
          ...review,
          state: "recalculating",
          request: {
            action: "recalculate",
            jobId,
            idempotencyKey: jobId,
            by: input.signer.uid,
            at: now,
            confirmAmountCents: null,
          },
        },
        updatedAt: now,
        updatedBy: input.signer.uid,
      });
      transaction.create(db.doc(`providerJobs/${jobId}`), {
        id: jobId,
        tenantId: input.tenantId,
        projectId: input.projectId,
        type: "release_quickbooks_invoice",
        invoiceId: invoice.id,
        providerInvoiceId: invoice.get("providerInvoiceId") ?? null,
        action: "recalculate",
        requestedBy: input.signer.uid,
        idempotencyKey: `held-${jobId}`,
        status: "queued",
        attempts: 0,
        createdAt: now,
        updatedAt: now,
      });
      recalculating.push(invoice.id);
    }
    return { saved, recalculating };
  });
}
