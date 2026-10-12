"use client";

import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { isSalesConsultation } from "@/features/consultations/purpose";
import { useTenantDocuments } from "@/components/live/tenant-records";
import { projectThread, type ThreadEntry } from "@/features/journey/thread";
import { useWorkspace } from "@/features/auth/workspace-context";
import { getFirebaseClient } from "@/lib/firebase/client";
import { dataIsLive } from "@/lib/runtime-mode";

const text = (value: unknown): string =>
  typeof value === "string" ? value : "";

type Row = Record<string, unknown> & { id: string };

/**
 * The message this job was made from on New job, when it was
 * (`jobSourceMessages/{projectId}`, functions/src/crm/job-source-message.ts).
 *
 * Read by its id, not with the tenant-wide collections above: those reads are
 * capped and unordered, so a busy studio's older job would silently lose its
 * first entry. Studio-only by rule; anyone the rules refuse, and every job
 * without one, simply has none.
 */
function useJobSourceMessage(projectId: string): Row | null {
  const workspace = useWorkspace();
  const [found, setFound] = useState<{ projectId: string; row: Row | null } | null>(null);
  useEffect(() => {
    if (!dataIsLive || workspace.loading || !workspace.tenantId || !projectId) return;
    let active = true;
    const tenantId = workspace.tenantId;
    const { firestore } = getFirebaseClient();
    void getDoc(doc(firestore, "jobSourceMessages", projectId))
      .then((snapshot) => {
        const data = snapshot.exists() ? snapshot.data() : null;
        if (active)
          setFound({
            projectId,
            row: data && data.tenantId === tenantId ? ({ id: snapshot.id, ...data } as Row) : null,
          });
      })
      .catch(() => {
        if (active) setFound({ projectId, row: null });
      });
    return () => {
      active = false;
    };
  }, [projectId, workspace.loading, workspace.tenantId]);
  return found?.projectId === projectId ? found.row : null;
}

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
  // The studio's trade words the entries: a DJ's vibe call, a makeup artist's quote.
  const trade = useWorkspace().tenantTrade;
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
  const sourceMessage = useJobSourceMessage(input.projectId);

  const mine = (rows: Row[] | null) =>
    (rows ?? []).filter((item) => item.projectId === input.projectId);

  const projectConsultations = mine(consultations.records);
  // Still to happen: "Log a call" writes against this one, and a cancelled
  // or replaced consultation is not a call to log.
  // The sales call only: "Log a call" runs the consultation brief, which the
  // final details call must never do (features/consultations/purpose.ts).
  const openConsultation = projectConsultations
    .filter((item) => isSalesConsultation(item) && text(item.status) === "scheduled" && !item.archivedAt)
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
    sourceMessage,
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
    trade,
    // An offer's last day on the studio's own clock, as the quote's
    // "Valid through" reads it.
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
  });

  return { entries, openConsultationId: openConsultation?.id ?? null };
}
