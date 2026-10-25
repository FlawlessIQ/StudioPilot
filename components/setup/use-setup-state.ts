"use client";

import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { useTenantDocuments } from "@/components/live/tenant-records";
import { isCataloguePackage } from "@/features/packages/one-off";
import { useWorkspace } from "@/features/auth/workspace-context";
import {
  askedSetupGaps,
  setupComplete,
  setupGaps,
  type SetupGap,
  type SetupState,
} from "@/features/today/setup-gaps";
import { getFirebaseClient } from "@/lib/firebase/client";
import { dataIsLive } from "@/lib/runtime-mode";
import { nativeSigningOn } from "@/features/contracts/rollout";
import { inquiryFormChoices } from "@/features/questionnaires/inquiry-form-setting";
import { hoursSummary } from "@/features/setup/hours-summary";
import { offeredKindsSummary } from "@/features/setup/work-kinds";

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
  /** Read the tenant-keyed documents again, after an answer is saved here. */
  refresh: () => void;
  /** Google Calendar is connected. Offered beside hours; not a question of its own. */
  calendarConnected: boolean;
  /**
   * A way in is set up and nothing has come through it yet: the studio
   * finished a route's guide or copied its form link (the `inquiry_capture`
   * outside step, waiting). Counts as answered — the studio has done its
   * part, and Today brings it back if nothing arrives (outside-steps).
   */
  inquiryWaiting: boolean;
  /** What each answered question said, in words, to show back beside it. */
  answers: {
    /** The kinds the inquiry form offers: "Wedding and Portraits". */
    work: string | null;
    /** Call hours: "Mon–Fri, 9 AM–5 PM". */
    availability: string | null;
    /** Active price-list packages. */
    packages: number;
    /** StudioCue's own agreement saved, or the studio sends its own. */
    agreement: "native" | "own" | null;
  };
} {
  const workspace = useWorkspace();
  const manages = workspace.role === "studio_owner" || workspace.role === "studio_admin";
  // The tenant document, for its outside steps (owners and admins read it).
  const tenants = useTenantDocuments("tenants", { enabled: manages });
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
    recordsOwnSignatures: boolean;
    nativeAgreement: boolean;
    nativeSigning: boolean;
    availability: boolean;
    captured: boolean;
    coi: boolean;
    /** The inquiry form has been saved; undefined when it can't be read. */
    work: boolean | undefined;
    /** The inquiry page's form has been chosen, or "none" chosen; undefined when it can't be read. */
    inquiryForm: boolean | undefined;
    /** The saved form's kinds, in words. */
    kinds: string | null;
    /** The saved call hours, in words. */
    hours: string | null;
  } | null>(null);

  const [reads, setReads] = useState(0);
  useEffect(() => {
    if (!dataIsLive || workspace.loading || !workspace.tenantId) return;
    let active = true;
    const { firestore } = getFirebaseClient();
    void Promise.all([
      getDoc(doc(firestore, "tenants", workspace.tenantId)).catch(() => null),
      getDoc(
        doc(firestore, "consultationSettings", workspace.tenantId),
      ).catch(() => null),
      getDoc(doc(firestore, "tenantFeatures", workspace.tenantId)).catch(() => null),
      // Owner/admin-readable; for anyone else the read fails and leads decide.
      getDoc(doc(firestore, "leadCaptureSettings", workspace.tenantId)).catch(() => null),
      // Managers only; a missing doc reads as "not said yet".
      getDoc(doc(firestore, "coiSettings", workspace.tenantId)).catch(() => null),
    ]).then(([tenant, availability, features, capture, coi]) => {
      if (!active) return;
      const contractSettings = tenant?.get("defaultContractSettings") as
        | Record<string, unknown>
        | undefined;
      const templateId = text(contractSettings?.templateId);
      const nativeSigning = nativeSigningOn(features?.exists() ? features.data() : null);
      // Availability counts as set when the studio has published windows,
      // or has deliberately chosen open-by-default hours.
      const windows = availability?.get("windows");
      setTenantDocs({
        agreement: Boolean(templateId),
        // "I send my own agreement and record the signature": an answer, and
        // for most studios the true one (setSignatureMode).
        recordsOwnSignatures: text(contractSettings?.signatureMode) === "record_own",
        nativeSigning,
        // StudioCue's own agreement counts only where StudioCue writes contracts.
        nativeAgreement:
          nativeSigning && Boolean(text(contractSettings?.agreementTemplateId)),
        availability:
          (Array.isArray(windows) && windows.length > 0) ||
          text(availability?.get("mode")) === "open_default",
        // A real capture, or the studio's own test coming through.
        captured:
          Boolean(text(capture?.get("lastCaptureAt"))) ||
          Boolean(text(capture?.get("lastTestCaptureAt"))),
        coi: Boolean(coi?.exists()),
        work: capture ? Boolean(capture.get("inquiryForm")) : undefined,
        // Null is "no form": an answer. Absent is never asked.
        inquiryForm: capture ? capture.get("inquiryEventForm") !== undefined : undefined,
        kinds: offeredKindsSummary(
          (capture?.get("inquiryForm") as { eventTypes?: unknown } | undefined)?.eventTypes,
        ),
        hours: hoursSummary(windows),
      });
    });
    return () => {
      active = false;
    };
  }, [workspace.loading, workspace.tenantId, reads]);

  const calendarConnected = (connections.records ?? []).some(
    (connection) =>
      text(connection.provider) === "google_calendar" && text(connection.status) === "connected",
  );
  const signingConnected = (connections.records ?? []).some(
    (connection) =>
      ["docusign", "dropbox_sign"].includes(text(connection.provider)) &&
      text(connection.status) === "connected",
  );
  // Finishing a route's guide (or copying the form link) records the step as
  // waiting (components/intake/lead-capture-setup.tsx). Setup used to show
  // the question exactly as before, so a studio that had just pasted the form
  // into its site was left wondering whether anything had saved.
  const tenantRecord = (tenants.records ?? []).find((record) => record.id === workspace.tenantId);
  const outsideSteps = (tenantRecord?.outsideSteps ?? {}) as Record<string, { state?: unknown } | undefined>;
  const captureStepWaiting = text(outsideSteps.inquiry_capture?.state) === "waiting";
  const activePackages = (packages.records ?? []).filter(
    (item) => item.active === true && isCataloguePackage(item),
  ).length;

  const captured =
    Boolean(tenantDocs?.captured) ||
    (leads.records ?? []).some(
      (lead) => Boolean(text(lead.captureId)) || text(lead.source) === "public_inquiry",
    );
  const state: SetupState = {
    // A one-off for one couple is not a price list (features/packages/one-off.ts).
    hasActivePackage: activePackages > 0,
    // A configured default template or a connected signing provider both
    // mean the studio can send an agreement without pasting an id.
    hasAgreementTemplate:
      Boolean(tenantDocs?.agreement) ||
      Boolean(tenantDocs?.recordsOwnSignatures) ||
      Boolean(tenantDocs?.nativeAgreement) ||
      signingConnected,
    nativeSigning: Boolean(tenantDocs?.nativeSigning),
    hasQuestionnaireTemplate: (questionnaireTemplates.records ?? []).some(
      (item) => text(item.status) === "active",
    ),
    hasConsultationAvailability: Boolean(tenantDocs?.availability),
    // Inquiries reach StudioCue: captured (forwarded, or the form emailing
    // StudioCue directly), a passed test, or StudioCue's own inquiry form.
    hasCoiSettings: tenantDocs ? tenantDocs.coi : undefined,
    // Said by saving the form's types, or long since shown by the jobs a
    // studio already has — an established studio isn't asked again.
    hasChosenWork:
      tenantDocs?.work === undefined
        ? undefined
        : tenantDocs.work || (projects.records ?? []).length > 0,
    // Asked only when there is a wedding form to choose.
    hasDecidedInquiryForm:
      tenantDocs?.inquiryForm === undefined
        ? undefined
        : tenantDocs.inquiryForm ||
          !inquiryFormChoices(questionnaireTemplates.records ?? []).some((choice) => choice.forWeddings),
    hasInquiryCapture: captured || captureStepWaiting,
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

  const everything = setupGaps(state, {
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
    // Couples who could book a call: open leads that aren't a job yet, and
    // jobs still at the inquiry stage (every dated inquiry is one).
    openInquiries:
      (leads.records ?? []).filter(
        (lead) =>
          !text(lead.projectId) &&
          lead.needsConfirmation !== true &&
          !["converted", "lost", "archived"].includes(text(lead.status).toLowerCase()),
      ).length +
      (projects.records ?? []).filter(
        (project) => text(project.state) === "LEAD" && !project.archivedAt,
      ).length,
  }, workspace.tenantTrade);
  // Only what this studio's setup asks: a vendor's four, a photographer's
  // seven. Every screen reading this hook — setup, Help's checklist, Today's
  // card and its act lane — then agrees on what is left.
  const gaps = askedSetupGaps(everything, workspace.tenantTrade);

  return {
    state,
    gaps,
    complete: setupComplete(state, workspace.tenantTrade),
    refresh: () => setReads((count) => count + 1),
    calendarConnected,
    inquiryWaiting: captureStepWaiting && !captured,
    answers: {
      work: tenantDocs?.kinds ?? null,
      availability: tenantDocs?.hours ?? null,
      packages: activePackages,
      // How "How do your clients sign?" was answered: StudioCue's agreement,
      // or their own sent elsewhere (setup-conversation.tsx doneText).
      agreement: tenantDocs?.nativeAgreement
        ? ("native" as const)
        : tenantDocs?.recordsOwnSignatures
          ? ("own" as const)
          : null,
    },
    // The tenant document too, for a manager: its outside steps can answer
    // "How do inquiries reach you?", which otherwise flickered open first.
    loading:
      dataIsLive &&
      (packages.records === null || tenantDocs === null || (manages && tenants.records === null)),
  };
}
