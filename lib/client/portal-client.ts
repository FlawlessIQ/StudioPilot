"use client";

import { getAppCheckToken } from "@/lib/firebase/app-check";
import { getFirebaseClient } from "@/lib/firebase/client";

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
  | "reviewRequests";

async function portalRequest<T>(body: Record<string, unknown>): Promise<T> {
  const { auth } = getFirebaseClient();
  const user = auth.currentUser;
  if (!user) throw new Error("Sign in to access your project.");
  const appCheckToken = await getAppCheckToken();
  const response = await fetch("/api/client/portal", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${await user.getIdToken()}`,
      ...(appCheckToken ? { "x-firebase-appcheck": appCheckToken } : {}),
    },
    body: JSON.stringify(body),
  });
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
  body: string,
) {
  return portalRequest<{ id: string; status: string }>({
    type: "send_message",
    tenantId,
    projectId,
    body,
    idempotencyKey: crypto.randomUUID(),
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
