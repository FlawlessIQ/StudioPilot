"use client";

import { getAppCheckToken } from "@/lib/firebase/app-check";
import { getFirebaseClient } from "@/lib/firebase/client";
import { withTimeout } from "@/lib/async/with-timeout";

export type ClientPortalProject = {
  id: string;
  name: string;
  eventType: string;
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
