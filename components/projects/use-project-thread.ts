"use client";

import { useTenantDocuments } from "@/components/live/tenant-records";
import { projectThread, type ThreadEntry } from "@/features/journey/thread";

const text = (value: unknown): string =>
  typeof value === "string" ? value : "";

type Row = Record<string, unknown> & { id: string };

/**
 * The job's thread, assembled from the same tenant-wide cached collections
 * the rest of the project page already reads. One extra render, no extra
 * requests.
 */
export function useProjectThread(input: {
  projectId: string;
  projectName: string;
  projectCreatedAt: string | null;
  contactIds: string[];
  leadId: string | null;
}): { entries: ThreadEntry[]; openConsultationId: string | null } {
  const leads = useTenantDocuments("leads");
  const contacts = useTenantDocuments("contacts");
  const consultations = useTenantDocuments("consultations");
  const proposals = useTenantDocuments("proposals");
  const contracts = useTenantDocuments("contracts");
  const invoices = useTenantDocuments("invoiceReferences");
  const questionnaires = useTenantDocuments("questionnaireResponses");
  const schedules = useTenantDocuments("schedules");
  const crewAssignments = useTenantDocuments("crewAssignments");
  const insuranceRequests = useTenantDocuments("insuranceRequests");
  const deliveries = useTenantDocuments("deliveryRecords");
  const messages = useTenantDocuments("messages");
  const actionReceipts = useTenantDocuments("actionReceipts");

  const mine = (rows: Row[] | null) =>
    (rows ?? []).filter((item) => item.projectId === input.projectId);

  const projectConsultations = mine(consultations.records);
  const openConsultation = projectConsultations
    .filter((item) => text(item.status) !== "completed")
    .sort((left, right) =>
      text(right.startsAt).localeCompare(text(left.startsAt)),
    )[0];

  // The client's first name makes the thread read like a conversation
  // ("Ava got in touch") instead of a log ("Client got in touch").
  const contact = (contacts.records ?? []).find((item) =>
    input.contactIds.includes(item.id),
  );
  const clientName =
    text(contact?.firstName) ||
    text(contact?.displayName).split(" ")[0] ||
    null;

  const entries = projectThread({
    projectId: input.projectId,
    projectName: input.projectName,
    projectCreatedAt: input.projectCreatedAt,
    clientName,
    lead:
      (leads.records ?? []).find(
        (item) =>
          item.id === input.leadId || item.projectId === input.projectId,
      ) ?? null,
    consultations: projectConsultations,
    proposals: mine(proposals.records),
    contracts: mine(contracts.records),
    invoices: mine(invoices.records),
    questionnaires: mine(questionnaires.records),
    schedules: mine(schedules.records),
    crewAssignments: mine(crewAssignments.records),
    insuranceRequests: mine(insuranceRequests.records),
    deliveries: mine(deliveries.records),
    messages: mine(messages.records),
    actionReceipts: mine(actionReceipts.records),
  });

  return { entries, openConsultationId: openConsultation?.id ?? null };
}
