"use client";

import { getAuth } from "firebase/auth";
import { getAppCheckToken } from "@/lib/firebase/app-check";
import {
  connectStorageEmulator,
  getStorage,
  ref,
  uploadBytes,
} from "firebase/storage";
import { getFirebaseClient } from "@/lib/firebase/client";
import { activeMembership } from "@/lib/firebase/active-membership";
import type {
  ExistingBooking,
  ExistingBookingIssue,
} from "@/features/imports/existing-booking";
import type { QuickBooksClientHistory } from "@/features/imports/quickbooks-prefill";
import { markTenantRecordsWritten } from "@/lib/live/record-writes";

export async function sendBookingCommand(input: Record<string, unknown>) {
  const endpoint = process.env.NEXT_PUBLIC_BOOKING_FUNCTIONS_URL;
  if (!endpoint) return { mode: "preview" as const };
  const client = getFirebaseClient();
  const user = getAuth(client.app).currentUser;
  if (!user) throw new Error("Sign in before changing booking records.");
  const membership = await activeMembership(client.firestore, user.uid);
  const appCheckToken = await getAppCheckToken();
  const response = await fetch(
    `${endpoint.replace(/\/$/, "")}/bookingCommand`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${await user.getIdToken()}`,
        ...(appCheckToken ? { "x-firebase-appcheck": appCheckToken } : {}),
        // The device, for commands that record it as evidence (signing a
        // contract for the studio). Proxies replace the real user agent.
        "x-studiohub-user-agent": navigator.userAgent.slice(0, 400),
      },
      body: JSON.stringify({
        ...input,
        tenantId: membership.data().tenantId as string,
      }),
    },
  );
  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      String(payload.error ?? "Booking command could not be completed."),
    );
  }
  markTenantRecordsWritten();
  return { mode: "live" as const, payload };
}

export type ConsultationAvailabilityQueryResult = {
  settings: Record<string, unknown>;
  busy: { start: string; end: string }[];
  calendarStatus: "connected" | "unavailable";
};

/**
 * Studio settings + booked/busy intervals (internal bookings merged with
 * the connected Google Calendar's real freebusy) for the consultation
 * calendar. Read-only — falls back to a non-persisting preview shape when
 * NEXT_PUBLIC_BOOKING_FUNCTIONS_URL is unset, same disclosure pattern as
 * sendBookingCommand.
 */
export async function queryConsultationAvailability(): Promise<
  | { mode: "preview" }
  | { mode: "live"; payload: ConsultationAvailabilityQueryResult }
> {
  const endpoint = process.env.NEXT_PUBLIC_BOOKING_FUNCTIONS_URL;
  if (!endpoint) return { mode: "preview" as const };
  const client = getFirebaseClient();
  const user = getAuth(client.app).currentUser;
  if (!user) throw new Error("Sign in to view consultation availability.");
  const membership = await activeMembership(client.firestore, user.uid);
  const appCheckToken = await getAppCheckToken();
  const response = await fetch(
    `${endpoint.replace(/\/$/, "")}/consultationAvailabilityQuery`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${await user.getIdToken()}`,
        ...(appCheckToken ? { "x-firebase-appcheck": appCheckToken } : {}),
      },
      body: JSON.stringify({ tenantId: membership.data().tenantId as string }),
    },
  );
  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      String(payload.error ?? "Could not load consultation availability."),
    );
  }
  return {
    mode: "live" as const,
    payload: payload as unknown as ConsultationAvailabilityQueryResult,
  };
}

let signedAgreementEmulatorConnected = false;

/**
 * Records an agreement signed outside StudioCue.
 *
 * A signing provider's API is a paid subscription, and without one a
 * project could not leave CONTRACT_PENDING by any route. This is the
 * signature equivalent of the retainer exception the booking gate already
 * accepts: a named person takes responsibility, and the record says so.
 *
 * The signed PDF is optional but uploaded first when present, so the
 * attestation and its evidence land together — the studio path under
 * `tenants/{t}/projects/{p}/` already permits studio roles to write, so no
 * new storage rule is involved.
 */
export async function recordSignedAgreement(input: {
  projectId: string;
  proposalId: string;
  signerName: string;
  signedAt: string;
  method: string;
  file: File | null;
}) {
  const endpoint = process.env.NEXT_PUBLIC_BOOKING_FUNCTIONS_URL;
  if (!endpoint) return { mode: "preview" as const };
  const client = getFirebaseClient();
  const user = getAuth(client.app).currentUser;
  if (!user) throw new Error("Sign in before recording a signature.");
  const membership = await activeMembership(client.firestore, user.uid);
  const tenantId = membership.data().tenantId as string;

  let signedDocumentId: string | null = null;
  if (input.file) {
    const storage = getStorage(client.app);
    if (
      process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === "true" &&
      !signedAgreementEmulatorConnected
    ) {
      connectStorageEmulator(storage, "127.0.0.1", 9199);
      signedAgreementEmulatorConnected = true;
    }
    const safeName = input.file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    signedDocumentId = `tenants/${tenantId}/projects/${input.projectId}/contracts/${crypto.randomUUID()}-${safeName}`;
    await uploadBytes(ref(storage, signedDocumentId), input.file, {
      contentType: input.file.type,
      // The couple's to see, not the crew's. This was "shared", which the
      // project-wide storage rule also opens to every photographer and
      // subcontractor assigned to the job — a signed contract carries the
      // couple's fee, and crew are paid from it. Imports already file their
      // signed copy as "client"; this is the same rule for the hand-recorded
      // path.
      customMetadata: { visibility: "client", scanStatus: "pending" },
    });
  }

  return sendBookingCommand({
    type: "recordSignedAgreement",
    idempotencyKey: crypto.randomUUID(),
    input: {
      projectId: input.projectId,
      proposalId: input.proposalId,
      signerName: input.signerName,
      signedAt: input.signedAt,
      method: input.method,
      signedDocumentId,
      attestation: true,
    },
  });
}

/**
 * Recording a retainer taken outside StudioCue.
 *
 * No file upload and no amount: the amount comes from the package snapshot
 * the couple accepted, server-side, so "the retainer was paid" cannot come
 * to mean a different number than the one quoted.
 */
export async function recordRetainerPayment(input: {
  projectId: string;
  packageSnapshotId: string;
  paidAt: string;
  method: string;
  reference: string | null;
}) {
  const endpoint = process.env.NEXT_PUBLIC_BOOKING_FUNCTIONS_URL;
  if (!endpoint) return { mode: "preview" as const };
  return sendBookingCommand({
    type: "recordRetainerPayment",
    idempotencyKey: crypto.randomUUID(),
    input: {
      projectId: input.projectId,
      packageSnapshotId: input.packageSnapshotId,
      paidAt: input.paidAt,
      method: input.method,
      reference: input.reference,
      attestation: true,
    },
  });
}

/**
 * Recording a final balance taken outside StudioCue.
 *
 * The same contract as `recordRetainerPayment`, and for the same reason: the
 * amount is read server-side from the accepted proposal's payment schedule, so
 * "the balance was paid" cannot come to mean a figure the browser chose. The
 * difference is when it applies — any time from the booking onward, because a
 * couple can settle up long before the final invoice would be raised.
 */
export async function recordFinalPayment(input: {
  projectId: string;
  packageSnapshotId: string;
  paidAt: string;
  method: string;
  reference: string | null;
}) {
  const endpoint = process.env.NEXT_PUBLIC_BOOKING_FUNCTIONS_URL;
  if (!endpoint) return { mode: "preview" as const };
  return sendBookingCommand({
    type: "recordFinalPayment",
    idempotencyKey: crypto.randomUUID(),
    input: {
      projectId: input.projectId,
      packageSnapshotId: input.packageSnapshotId,
      paidAt: input.paidAt,
      method: input.method,
      reference: input.reference,
      attestation: true,
    },
  });
}

/**
 * "Send the final bill": raise the final invoice now, through the studio's
 * invoicing provider. The amount is the server's — the accepted proposal's
 * total less everything paid (functions/src/booking/send-final-balance.ts).
 */
export async function sendFinalBalance(projectId: string) {
  return sendBookingCommand({
    type: "sendFinalBalance",
    idempotencyKey: `final_${projectId}_${crypto.randomUUID()}`,
    input: { projectId },
  });
}

/**
 * "Don't charge sales tax on this job" (owner/admin). See
 * functions/src/booking/job-sales-tax.ts; firestore.rules refuses the field
 * from a browser write.
 */
export async function setJobSalesTaxExempt(input: { projectId: string; exempt: boolean }) {
  return sendBookingCommand({
    type: "setJobSalesTaxExempt",
    idempotencyKey: `sales_tax_${input.projectId}_${crypto.randomUUID()}`,
    input,
  });
}

/**
 * Void a bill in StudioCue and at the provider (owner/admin). The server
 * refuses a bill with money on it; see functions/src/booking/invoice-corrections.ts.
 */
export async function voidInvoice(input: { projectId: string; invoiceId: string; reason: string }) {
  return sendBookingCommand({
    type: "voidInvoice",
    idempotencyKey: `void_${input.invoiceId}_${crypto.randomUUID()}`,
    input,
  });
}

/**
 * Correct a payment a person recorded, by a record that supersedes it. The
 * amount is what actually arrived; the server decides what that makes of the
 * invoice and refuses anything the provider would contradict.
 */
export async function correctPaymentRecord(input: {
  projectId: string;
  invoiceId: string;
  amountCents: number;
  paidAt: string;
  method: string;
  reference: string | null;
  reason: string;
}) {
  return sendBookingCommand({
    type: "correctPaymentRecord",
    idempotencyKey: `correct_${input.invoiceId}_${crypto.randomUUID()}`,
    input,
  });
}

/**
 * Record a payment — the whole balance or part of it — against a retainer or
 * final bill. The server checks it against the balance and records it in
 * QuickBooks or Stripe too (functions/src/booking/invoice-payments.ts).
 */
export async function recordInvoicePayment(input: {
  projectId: string;
  invoiceId: string;
  amountCents: number;
  paidAt: string;
  method: string;
  reference: string | null;
}) {
  return sendBookingCommand({
    type: "recordInvoicePayment",
    idempotencyKey: `payment_${input.invoiceId}_${crypto.randomUUID()}`,
    input: { ...input, attestation: true },
  });
}

/**
 * Send a final bill held for review. `confirmAmountCents` is the figure the
 * studio was shown; the server works the balance out again and refuses if it
 * has changed, so it never takes the amount from here.
 */
export async function approveFinalInvoice(input: {
  projectId: string;
  invoiceId: string;
  confirmAmountCents: number;
}) {
  return sendBookingCommand({
    type: "approveFinalInvoice",
    idempotencyKey: `approve_final_${input.invoiceId}_${crypto.randomUUID()}`,
    input,
  });
}

/**
 * A bill held in QuickBooks for the studio to check: send it with
 * QuickBooks' tax, without tax, or have QuickBooks work the tax out again
 * once the couple's billing address is on record. The server checks the
 * figure the studio confirmed (functions/src/booking/held-invoice-send.ts).
 */
export async function sendHeldInvoice(input: {
  projectId: string;
  invoiceId: string;
  action: "send_with_tax" | "send_without_tax" | "recalculate";
  confirmAmountCents: number | null;
}) {
  return sendBookingCommand({
    type: "sendHeldInvoice",
    idempotencyKey: `held_${input.action}_${input.invoiceId}_${crypto.randomUUID()}`.slice(0, 160),
    input,
  });
}

/* ---------------------------------------------------------------------------
 * Importing bookings a studio already has.
 *
 * Owner/admin commands on bookingCommand; the server decides everything that
 * matters (see functions/src/imports/commands.ts). These only carry the call.
 * ------------------------------------------------------------------------- */

export type ExistingBookingPreview = {
  key: string;
  issues: ExistingBookingIssue[];
  knownClients: Array<{ contactId: string; displayName: string } | null>;
  alreadyImported: { projectId: string; name: string; state: string } | null;
  sameDayBookings: Array<{ projectId: string; name: string }>;
};

export type ImportedBookingResult = {
  projectId: string;
  name: string;
  state: string;
  contactsCreated: number;
  contactsMatched: number;
  paidCents: number;
  workflow: { started: boolean; checkpointCount?: number; reason?: string };
  warnings: string[];
};

export async function previewExistingBookings(
  bookings: ExistingBooking[],
): Promise<{ today: string; bookings: ExistingBookingPreview[] } | null> {
  const result = await sendBookingCommand({
    type: "previewExistingBookings",
    idempotencyKey: crypto.randomUUID(),
    input: { bookings },
  });
  if (result.mode === "preview") return null;
  return result.payload as { today: string; bookings: ExistingBookingPreview[] };
}

/**
 * Import one booking, then file its signed copy when there is one.
 *
 * The copy goes in after the project exists, because a contract lives in its
 * project's folder. It is filed as client-visible — the couple can see their
 * own signed contract in their portal — and not "shared", which would also
 * open it to crew, fee and all. If filing the copy fails the booking is still
 * imported, and the result says so rather than reporting a failure that
 * isn't one.
 */
export async function importExistingBooking(input: {
  booking: ExistingBooking;
  source: "form" | "cue" | "spreadsheet";
  batchId: string | null;
  signedCopy: File | null;
  /** Stable per booking, so a retry never imports it twice. */
  idempotencyKey?: string;
}): Promise<
  | { mode: "preview" }
  | { mode: "live"; result: ImportedBookingResult; signedCopyAttached: boolean }
> {
  const imported = await sendBookingCommand({
    type: "importExistingBooking",
    idempotencyKey: input.idempotencyKey ?? crypto.randomUUID(),
    input: {
      booking: input.booking,
      source: input.source,
      batchId: input.batchId,
    },
  });
  if (imported.mode === "preview") return { mode: "preview" };
  const result = imported.payload as ImportedBookingResult;
  if (!input.signedCopy) return { mode: "live", result, signedCopyAttached: false };

  try {
    const client = getFirebaseClient();
    const user = getAuth(client.app).currentUser;
    if (!user) throw new Error("Sign in before attaching a signed copy.");
    const membership = await activeMembership(client.firestore, user.uid);
    const tenantId = membership.data().tenantId as string;
    const storage = getStorage(client.app);
    if (
      process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === "true" &&
      !signedAgreementEmulatorConnected
    ) {
      connectStorageEmulator(storage, "127.0.0.1", 9199);
      signedAgreementEmulatorConnected = true;
    }
    const safeName = input.signedCopy.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120);
    const documentPath = `tenants/${tenantId}/projects/${result.projectId}/contracts/${crypto.randomUUID()}-${safeName}`;
    await uploadBytes(ref(storage, documentPath), input.signedCopy, {
      contentType: input.signedCopy.type,
      customMetadata: { visibility: "client", scanStatus: "pending" },
    });
    await sendBookingCommand({
      type: "attachImportedSignedCopy",
      idempotencyKey: crypto.randomUUID(),
      input: { projectId: result.projectId, documentPath },
    });
    return { mode: "live", result, signedCopyAttached: true };
  } catch {
    return { mode: "live", result, signedCopyAttached: false };
  }
}

/**
 * File the signed agreement against a booking that was imported.
 *
 * The same upload and the same command the import performs when its form
 * carried a file — lifted out so it can be done afterwards, which is the only
 * way a bulk-imported book of weddings can ever get its paper attached.
 */
export async function attachSignedCopyToImportedBooking(input: {
  projectId: string;
  signedCopy: File;
}): Promise<{ mode: "preview" } | { mode: "live" }> {
  if (!process.env.NEXT_PUBLIC_BOOKING_FUNCTIONS_URL) return { mode: "preview" };
  const client = getFirebaseClient();
  const user = getAuth(client.app).currentUser;
  if (!user) throw new Error("Sign in before attaching a signed copy.");
  const membership = await activeMembership(client.firestore, user.uid);
  const tenantId = membership.data().tenantId as string;
  const storage = getStorage(client.app);
  if (
    process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === "true" &&
    !signedAgreementEmulatorConnected
  ) {
    connectStorageEmulator(storage, "127.0.0.1", 9199);
    signedAgreementEmulatorConnected = true;
  }
  const safeName = input.signedCopy.name
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(-120);
  // The prefix the command validates against, so a request cannot file
  // somebody else's document against this couple.
  const documentPath = `tenants/${tenantId}/projects/${input.projectId}/contracts/${crypto.randomUUID()}-${safeName}`;
  await uploadBytes(ref(storage, documentPath), input.signedCopy, {
    contentType: input.signedCopy.type,
    // The couple's paper, not the crew's — the same visibility the import and
    // the hand-recorded path both use.
    customMetadata: { visibility: "client", scanStatus: "pending" },
  });
  await sendBookingCommand({
    type: "attachImportedSignedCopy",
    idempotencyKey: crypto.randomUUID(),
    input: { projectId: input.projectId, documentPath },
  });
  return { mode: "live" };
}

export async function bringImportedBookingLive(input: {
  projectId: string;
  calendarAndFolders: boolean;
}) {
  return sendBookingCommand({
    type: "bringImportedBookingLive",
    idempotencyKey: crypto.randomUUID(),
    input,
  });
}

/** What QuickBooks shows these clients have paid. Read-only; a prefill. */
export async function lookupQuickBooksPayments(
  emails: string[],
): Promise<{ mock: boolean; clients: QuickBooksClientHistory[] } | null> {
  const result = await sendBookingCommand({
    type: "lookupQuickBooksPayments",
    idempotencyKey: crypto.randomUUID(),
    input: { emails },
  });
  if (result.mode === "preview") return null;
  return result.payload as { mock: boolean; clients: QuickBooksClientHistory[] };
}

/**
 * "Ask them" / "Ask again": email the couple a link to add their billing
 * address, so QuickBooks can work out the sales tax on their final
 * (functions/src/billing/billing-address-request.ts).
 */
export async function requestBillingAddress(projectId: string) {
  return sendBookingCommand({
    type: "requestBillingAddress",
    idempotencyKey: `billing_address_${projectId}_${crypto.randomUUID()}`.slice(0, 160),
    input: { projectId },
  });
}
