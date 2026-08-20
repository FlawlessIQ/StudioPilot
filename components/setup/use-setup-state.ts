"use client";

import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { useTenantDocuments } from "@/components/live/tenant-records";
import { useWorkspace } from "@/features/auth/workspace-context";
import {
  setupComplete,
  setupGaps,
  type SetupGap,
  type SetupState,
} from "@/features/today/setup-gaps";
import { getFirebaseClient } from "@/lib/firebase/client";
import { dataIsLive } from "@/lib/runtime-mode";

const text = (value: unknown): string =>
  typeof value === "string" ? value : "";

/**
 * What the studio has configured, and which gaps are blocking real work.
 *
 * Read from the same cached collections everything else uses, plus two
 * tenant-keyed documents (the agreement default and consultation hours)
 * that live outside the collection cache.
 */
export function useSetupState(): {
  state: SetupState;
  gaps: SetupGap[];
  complete: boolean;
  loading: boolean;
} {
  const workspace = useWorkspace();
  const packages = useTenantDocuments("packages");
  const questionnaireTemplates = useTenantDocuments("questionnaireTemplates");
  const projects = useTenantDocuments("projects");
  const proposals = useTenantDocuments("proposals");
  const contracts = useTenantDocuments("contracts");
  const questionnaires = useTenantDocuments("questionnaireResponses");
  const leads = useTenantDocuments("leads");
  const connections = useTenantDocuments("integrationConnections");
  const [tenantDocs, setTenantDocs] = useState<{
    agreement: boolean;
    availability: boolean;
  } | null>(null);

  useEffect(() => {
    if (!dataIsLive || workspace.loading || !workspace.tenantId) return;
    let active = true;
    const { firestore } = getFirebaseClient();
    void Promise.all([
      getDoc(doc(firestore, "tenants", workspace.tenantId)).catch(() => null),
      getDoc(
        doc(firestore, "consultationSettings", workspace.tenantId),
      ).catch(() => null),
    ]).then(([tenant, availability]) => {
      if (!active) return;
      const templateId = text(
        (tenant?.get("defaultContractSettings") as
          | Record<string, unknown>
          | undefined)?.templateId,
      );
      // Availability counts as set when the studio has published windows,
      // or has deliberately chosen open-by-default hours.
      const windows = availability?.get("windows");
      setTenantDocs({
        agreement: Boolean(templateId),
        availability:
          (Array.isArray(windows) && windows.length > 0) ||
          text(availability?.get("mode")) === "open_default",
      });
    });
    return () => {
      active = false;
    };
  }, [workspace.loading, workspace.tenantId]);

  const signingConnected = (connections.records ?? []).some(
    (connection) =>
      ["docusign", "dropbox_sign"].includes(text(connection.provider)) &&
      text(connection.status) === "connected",
  );

  const state: SetupState = {
    hasActivePackage: (packages.records ?? []).some(
      (item) => item.active === true,
    ),
    // A configured default template or a connected signing provider both
    // mean the studio can send an agreement without pasting an id.
    hasAgreementTemplate: Boolean(tenantDocs?.agreement) || signingConnected,
    hasQuestionnaireTemplate: (questionnaireTemplates.records ?? []).some(
      (item) => text(item.status) === "active",
    ),
    hasConsultationAvailability: Boolean(tenantDocs?.availability),
  };

  const nameOf = (projectId: unknown) =>
    text(
      (projects.records ?? []).find((project) => project.id === projectId)
        ?.name,
    ) || "A job";

  const acceptedProposalProjects = new Set(
    (proposals.records ?? [])
      .filter((proposal) => text(proposal.status) === "accepted")
      .map((proposal) => text(proposal.projectId)),
  );
  const contractedProjects = new Set(
    (contracts.records ?? []).map((contract) => text(contract.projectId)),
  );
  const formedProjects = new Set(
    (questionnaires.records ?? []).map((response) =>
      text(response.projectId),
    ),
  );

  const gaps = setupGaps(state, {
    projectsNeedingPackage: (projects.records ?? [])
      .filter(
        (project) =>
          ["CONSULTATION", "PROPOSAL"].includes(text(project.state)) &&
          typeof project.packageSnapshotId !== "string",
      )
      .map((project) => text(project.name) || "A job"),
    projectsNeedingAgreement: [...acceptedProposalProjects]
      .filter((projectId) => projectId && !contractedProjects.has(projectId))
      .map(nameOf),
    projectsNeedingForm: (projects.records ?? [])
      .filter(
        (project) =>
          ["BOOKED", "PLANNING"].includes(text(project.state)) &&
          !formedProjects.has(project.id),
      )
      .map((project) => text(project.name) || "A job"),
    openInquiries: (leads.records ?? []).filter(
      (lead) =>
        !["converted", "lost", "archived"].includes(
          text(lead.status).toLowerCase(),
        ),
    ).length,
  });

  return {
    state,
    gaps,
    complete: setupComplete(state),
    loading: dataIsLive && (packages.records === null || tenantDocs === null),
  };
}
