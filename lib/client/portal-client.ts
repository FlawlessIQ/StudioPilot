"use client";

import { getAppCheckToken } from "@/lib/firebase/app-check";
import { getFirebaseClient } from "@/lib/firebase/client";
import { withTimeout } from "@/lib/async/with-timeout";
import type { BillingAddress } from "@/features/contacts/schema";
import type { BillingAddressRequirement, SigningKind } from "@/features/contacts/billing-address-signing";
import type { FinalDetailsView } from "@/features/planning/final-details-view";

export type ClientPortalProject = {
  id: string;
  name: string;
  eventType: string;
  /** The kind of work (features/job-kinds); older responses omit it. */
  eventKind?: string;
  /** How the job is paid: deposit_and_balance, paid_in_full, on_the_day or invoice_after. */
  paymentShape?: string;
  eventDate: string | null;
  timezone: string | null;
  venueName: string | null;
  city: string | null;
  leadPhotographerName: string | null;
  clientStage: string;
  clientProgress: number;
  clientCheckpointCount: number;
  nextClientAction: {
    name: string;
    description: string | null;
    dueDate: string | null;
    ownerType: string | null;
    responsibility: "client" | "studio";
    href: string;
    actionLabel: string;
  };
  navigation: {
    proposal: boolean;
    package: boolean;
    contract: boolean;
    payments: boolean;
    questionnaire: boolean;
    schedule: boolean;
    files: boolean;
    delivery: boolean;
    reviews: boolean;
  };
  milestones: Array<{
    id: string;
    label: string;
    description: string;
    status: "complete" | "current" | "upcoming";
  }>;
  checkpoints: Array<{
    id: string;
    name: string;
    description: string | null;
    status: string;
    dueDate: string | null;
    ownerType: string | null;
    actionHref?: string | null;
    actionLabel?: string | null;
  }>;
};

export type ClientPortalProjectSummary = Pick<
  ClientPortalProject,
  "id" | "name" | "eventType" | "eventDate" | "venueName" | "city" | "clientStage"
>;

export type ClientPortalCollection =
  | "proposals"
  | "packageSnapshots"
  | "contracts"
  | "invoiceReferences"
  | "questionnaireResponses"
  | "schedules"
  | "documents"
  | "messages"
  | "deliveryRecords"
  | "albumWorkflows"
  | "reviewRequests";

async function portalRequest<T>(body: Record<string, unknown>): Promise<T> {
  const { auth } = getFirebaseClient();
  const user = auth.currentUser;
  if (!user) throw new Error("Sign in to access your project.");
  const appCheckToken = await getAppCheckToken();
  const response = await withTimeout(fetch("/api/client/portal", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${await user.getIdToken()}`,
      ...(appCheckToken ? { "x-firebase-appcheck": appCheckToken } : {}),
      // The device a couple signs from. App Hosting's proxy replaces the
      // user agent, so the certificate read "Google" (production, 2026-09-25).
      "x-studiohub-user-agent": navigator.userAgent.slice(0, 400),
    },
    body: JSON.stringify(body),
  }), 15_000, "Your project took too long to load. Try again.");
  const result = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(result.error ?? "Your project could not be loaded.");
  }
  return result;
}

export function getClientPortalProject(tenantId: string, projectId: string) {
  return portalRequest<ClientPortalProject>({
    type: "project",
    tenantId,
    projectId,
  });
}

export function getClientPortalProjects(tenantId: string) {
  return portalRequest<{ projects: ClientPortalProjectSummary[] }>({
    type: "projects",
    tenantId,
  });
}

export function getClientPortalRecords(
  tenantId: string,
  projectId: string,
  collection: ClientPortalCollection,
) {
  return portalRequest<{ records: Array<Record<string, unknown> & { id: string }> }>({
    type: "records",
    tenantId,
    projectId,
    collection,
  });
}

export function sendClientPortalMessage(
  tenantId: string,
  projectId: string,
  input: {
    subject: string;
    body: string;
    context: string | null;
    replyToMessageId: string | null;
    attachments: Array<{
      storagePath: string;
      name: string;
      contentType: string;
      sizeBytes: number;
      scanStatus: "pending";
    }>;
    idempotencyKey: string;
  },
) {
  return portalRequest<{ id: string; status: string }>({
    type: "send_message",
    tenantId,
    projectId,
    ...input,
  });
}

export function decideClientProposal(
  tenantId: string,
  projectId: string,
  proposalId: string,
  decision: "accepted" | "declined",
  reason: string | null,
) {
  return portalRequest<{
    proposalId: string;
    status: "accepted" | "declined";
    projectState: string;
    alreadyComplete: boolean;
  }>({
    type: "decide_proposal",
    tenantId,
    projectId,
    proposalId,
    decision,
    reason,
    idempotencyKey: crypto.randomUUID(),
  });
}

export function getClientAvailablePackages(
  tenantId: string,
  projectId: string,
) {
  return portalRequest<{
    packages: Array<Record<string, unknown> & { id: string }>;
  }>({
    type: "available_packages",
    tenantId,
    projectId,
  });
}

export type ClientPackageAdditions = {
  canRequest: boolean;
  /** Whether they can ask to move their date. */
  canRequestDate?: boolean;
  /** Signed: the studio answers with a booking change for them to sign. */
  signed?: boolean;
  options: Array<Record<string, unknown> & { id: string }>;
  requests: Array<{
    id: string;
    kind?: string;
    requestedDate?: string | null;
    packageId: string;
    packageName: string;
    status: string;
    createdAt: string;
  }>;
};

/** What the couple could ask to add to their booking, and what they've asked. */
export function getClientPackageAdditions(tenantId: string, projectId: string) {
  return portalRequest<ClientPackageAdditions>({ type: "package_additions", tenantId, projectId });
}

/** Ask the studio to add a package; the studio approves, then a revised proposal follows. */
export function requestClientPackage(tenantId: string, projectId: string, packageId: string, note: string | null) {
  return portalRequest<{ requestId: string; status: string }>({
    type: "request_package",
    tenantId,
    projectId,
    packageId,
    note,
    idempotencyKey: crypto.randomUUID(),
  });
}

/** Ask the studio to move the wedding date; it lands on their Today. */
export function requestClientDateChange(tenantId: string, projectId: string, eventDate: string, note: string | null) {
  return portalRequest<{ requestId: string; status: string }>({
    type: "request_date_change",
    tenantId,
    projectId,
    eventDate,
    note,
    idempotencyKey: crypto.randomUUID(),
  });
}

export function selectClientPackage(
  tenantId: string,
  projectId: string,
  packageId: string,
  selectedAddOns: Array<{ addOnId: string; quantity: number }>,
) {
  return portalRequest<{
    snapshotId: string;
    totalCents: number;
    retainerCents: number;
  }>({
    type: "select_package",
    tenantId,
    projectId,
    packageId,
    selectedAddOns,
    idempotencyKey: crypto.randomUUID(),
  });
}

export type ClientAutopayStatus = {
  available: boolean;
  mock: boolean;
  tokenUrl: string | null;
  amountCents: number;
  currency: string;
  dueDate: string | null;
  consentText: string;
  method: {
    id: string;
    status: string;
    brand: string | null;
    last4: string | null;
    expMonth: string | null;
    expYear: string | null;
    failureCode: string | null;
  } | null;
};

export function getClientAutopayStatus(tenantId: string, projectId: string) {
  return portalRequest<ClientAutopayStatus>({ type: "autopay_status", tenantId, projectId });
}

export function saveClientAutopayCard(tenantId: string, projectId: string, cardToken: string) {
  return portalRequest<{ paymentMethodId: string; status: string }>({
    type: "save_card",
    tenantId,
    projectId,
    cardToken,
    consent: true,
    idempotencyKey: crypto.randomUUID(),
  });
}

export function removeClientAutopayCard(tenantId: string, projectId: string, paymentMethodId: string) {
  return portalRequest<{ paymentMethodId: string; status: string }>({
    type: "remove_card",
    tenantId,
    projectId,
    paymentMethodId,
  });
}

/**
 * Tokenise card details with Intuit directly from the browser.
 *
 * The card number goes to Intuit and nowhere else; StudioCue only ever sees
 * the single-use token that comes back.
 */
export async function tokenizeCardWithIntuit(
  tokenUrl: string,
  card: { number: string; expMonth: string; expYear: string; cvc: string; name: string; postalCode: string },
): Promise<string> {
  const response = await withTimeout(
    fetch(tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        card: {
          number: card.number.replace(/\D/g, ""),
          expMonth: card.expMonth.padStart(2, "0"),
          expYear: card.expYear.length === 2 ? `20${card.expYear}` : card.expYear,
          cvc: card.cvc,
          name: card.name,
          address: { postalCode: card.postalCode },
        },
      }),
    }),
    15_000,
    "The card check took too long. Try again.",
  );
  const body = (await response.json().catch(() => ({}))) as { value?: string };
  if (!response.ok || !body.value) throw new Error("CARD_DETAILS_REJECTED");
  return body.value;
}

/** First open of a StudioCue contract by the person it is addressed to. */
export function viewClientContract(tenantId: string, projectId: string, contractId: string) {
  return portalRequest<{ viewed: boolean }>({
    type: "view_contract",
    tenantId,
    projectId,
    contractId,
  });
}

/**
 * Sign a StudioCue contract. The hash is of the text the page showed; the
 * server refuses if it is no longer the stored one. A refusal arrives as an
 * Error whose message is the refusal code (features/contracts/signing-policy).
 */
export function signClientContract(input: {
  tenantId: string;
  projectId: string;
  contractId: string;
  documentHash: string;
  typedName: string;
  consentVersion: string;
  idempotencyKey: string;
  /** The billing address step's answer; null or absent when it asked nothing or was left blank. */
  billingAddress?: BillingAddress | null;
}) {
  return portalRequest<{
    contractId: string;
    status: string;
    projectState: string;
    alreadySigned: boolean;
  }>({
    type: "sign_contract",
    ...input,
    consent: true,
  });
}

/** The couple signs the booking agreement — both parts, one act (H2). */
export function signClientCombinedAgreement(input: {
  tenantId: string;
  projectId: string;
  contractId: string;
  documentHash: string;
  typedNameTerms: string;
  typedNameCoverage: string;
  consentVersion: string;
  idempotencyKey: string;
  /** The billing address step's answer; null or absent when it asked nothing or was left blank. */
  billingAddress?: BillingAddress | null;
}) {
  return portalRequest<{
    contractId: string;
    status: string;
    projectState: string;
    alreadySigned: boolean;
  }>({
    type: "sign_combined_agreement",
    ...input,
    consent: true,
  });
}

export type ClientBookingChange = {
  id: string;
  status: string;
  /** Set when the studio withdrew a change it had sent (status "cancelled"). */
  withdrawnAt?: string | null;
  changes: string[];
  document: unknown;
  documentHash: string | null;
  studioSignerName: string;
  sentAt: string | null;
  signedAt: string | null;
};

/**
 * What the signing sheet asks about the billing address — "required",
 * "optional" or "hidden", from the studio's tax setting — and the signer's
 * own address to prefill (server/contracts/signing-billing-address.ts).
 */
export function getSigningBillingAddressStep(tenantId: string, projectId: string, kind: SigningKind) {
  return portalRequest<{
    step: BillingAddressRequirement;
    onFile: BillingAddress | null;
    /** An address they gave on one of the job's forms, offered when none is on file. */
    suggested?: { address: BillingAddress; question: string } | null;
  }>({
    type: "billing_address_step",
    tenantId,
    projectId,
    kind,
  });
}

/** Their final details, once their studio's timeline has locked them (server/planning/final-details.ts). */
export function getFinalDetails(tenantId: string, projectId: string) {
  return portalRequest<{ details: FinalDetailsView | null }>({ type: "final_details", tenantId, projectId });
}

/** The couple confirming their final details, by typed name, as they were shown them. */
export function confirmFinalDetailsRequest(tenantId: string, projectId: string, typedName: string, snapshotHash: string) {
  return portalRequest<{ confirmedAt: string }>({ type: "confirm_final_details", tenantId, projectId, typedName, snapshotHash, consent: true });
}

/** Whether the studio is waiting on this couple's billing address (server/billing/billing-address-request.ts). */
export function getBillingAddressRequest(tenantId: string, projectId: string) {
  return portalRequest<{ needed: boolean }>({ type: "billing_address_request", tenantId, projectId });
}

/** The couple's billing address, given because the studio asked; saved to their own contact. */
export function confirmBillingAddress(tenantId: string, projectId: string, billingAddress: BillingAddress) {
  return portalRequest<{ saved: boolean; recalculating: string[] }>({
    type: "confirm_billing_address",
    tenantId,
    projectId,
    billingAddress,
  });
}

/** A change to a signed booking, waiting for the couple (server/contracts/amendment-signing.ts). */
export function getClientBookingChange(tenantId: string, projectId: string) {
  return portalRequest<{ change: ClientBookingChange | null }>({ type: "booking_change", tenantId, projectId });
}

export function signClientBookingChange(input: {
  tenantId: string;
  projectId: string;
  amendmentId: string;
  documentHash: string;
  typedName: string;
  consentVersion: string;
  idempotencyKey: string;
  /** The billing address step's answer; null or absent when it asked nothing or was left blank. */
  billingAddress?: BillingAddress | null;
}) {
  return portalRequest<{ amendmentId: string; status: string; alreadySigned: boolean }>({
    type: "sign_amendment",
    ...input,
    consent: true,
  });
}
