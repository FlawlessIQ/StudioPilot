import {
  workflowCapabilityRegistry,
  type CapabilityStatus,
} from "@/features/operations/workflow-scorecard";

type PhotographerMode =
  | "automatic"
  | "approval"
  | "exception"
  | "manual"
  | "creative";

export type ImplementationWorkflow = {
  id: string;
  capabilityId: string;
  label: string;
  mode: PhotographerMode;
  repeatable: boolean;
  evidence: string;
};

const workflows: ImplementationWorkflow[] = [
  { id: "setup-upload", capabilityId: "MIG-01", label: "Upload existing studio material", mode: "manual", repeatable: false, evidence: "studio import session" },
  { id: "setup-recreate", capabilityId: "MIG-05", label: "Review recreated templates and workflows", mode: "approval", repeatable: false, evidence: "versioned import activation" },
  { id: "inquiry-capture", capabilityId: "INQ-01", label: "Capture and deduplicate an inquiry", mode: "automatic", repeatable: true, evidence: "lead intake service" },
  { id: "inquiry-reply", capabilityId: "INQ-02", label: "Prepare and release the inquiry response", mode: "approval", repeatable: true, evidence: "AI communication approval queues delivery" },
  { id: "missing-details", capabilityId: "INQ-03", label: "Identify and request missing client details", mode: "exception", repeatable: true, evidence: "progressive missing-information prompts" },
  { id: "consultation-booking", capabilityId: "INQ-04", label: "Offer conflict-free consultation times", mode: "automatic", repeatable: true, evidence: "availability-aware public scheduling" },
  { id: "consultation-capture", capabilityId: "INQ-05", label: "Import Zoom consultation notes", mode: "automatic", repeatable: true, evidence: "signed Zoom summary webhook" },
  { id: "consultation-brief", capabilityId: "INQ-05", label: "Prepare the cited consultation brief", mode: "approval", repeatable: true, evidence: "consultation analysis action" },
  { id: "package-fit", capabilityId: "BOOK-01", label: "Recommend a grounded package", mode: "approval", repeatable: true, evidence: "package snapshot recommendation" },
  { id: "proposal", capabilityId: "BOOK-02", label: "Prepare the proposal", mode: "approval", repeatable: true, evidence: "immutable proposal review" },
  { id: "booking-release", capabilityId: "BOOK-05", label: "Release contract and retainer sequence", mode: "approval", repeatable: true, evidence: "one booking sequence approval" },
  { id: "booking-evidence", capabilityId: "BOOK-05", label: "Monitor signature and payment evidence", mode: "automatic", repeatable: true, evidence: "provider-driven booking orchestration" },
  { id: "booking-setup", capabilityId: "BOOK-05", label: "Create booked-project operations", mode: "automatic", repeatable: true, evidence: "idempotent booking side effects" },
  { id: "questionnaire-prefill", capabilityId: "PLAN-01", label: "Prefill known client details", mode: "automatic", repeatable: true, evidence: "verified questionnaire provenance" },
  { id: "planning-package", capabilityId: "PLAN-02", label: "Turn answers into a sourced planning package", mode: "automatic", repeatable: true, evidence: "questionnaire planning facts" },
  { id: "planning-followup", capabilityId: "PLAN-02", label: "Request unresolved planning details", mode: "approval", repeatable: true, evidence: "AI follow-up approval queues delivery" },
  { id: "schedule-draft", capabilityId: "PLAN-04", label: "Prepare an explainable schedule", mode: "approval", repeatable: true, evidence: "fact and timing-rule schedule draft" },
  { id: "schedule-impact", capabilityId: "PLAN-05", label: "Detect changes and renew acknowledgements", mode: "exception", repeatable: true, evidence: "immutable schedule impact" },
  { id: "coi", capabilityId: "PLAN-06", label: "Extract and compare venue insurance", mode: "approval", repeatable: true, evidence: "inbound COI review" },
  { id: "final-invoice", capabilityId: "FIN-01", label: "Prepare the final invoice", mode: "approval", repeatable: true, evidence: "provider-reconciled invoice draft" },
  { id: "finance-exception", capabilityId: "FIN-02", label: "Explain a balance discrepancy", mode: "exception", repeatable: true, evidence: "provider discrepancy explanation" },
  { id: "crew-plan", capabilityId: "CREW-04", label: "Rank eligible crew", mode: "approval", repeatable: true, evidence: "availability, conflict, travel, and document ranking" },
  { id: "crew-cascade", capabilityId: "CREW-02", label: "Fill approved crew roles in sequence", mode: "automatic", repeatable: true, evidence: "one-approval multi-role cascade" },
  { id: "crew-ack", capabilityId: "CREW-03", label: "Collect current schedule acknowledgement", mode: "automatic", repeatable: true, evidence: "version-aware crew acknowledgement" },
  { id: "event-brief", capabilityId: "EVENT-01", label: "Prepare the event-day brief", mode: "automatic", repeatable: true, evidence: "proactive current/next event snapshot" },
  { id: "photograph-event", capabilityId: "EVENT-01", label: "Photograph the event", mode: "creative", repeatable: true, evidence: "intentionally human creative work" },
  { id: "edit-gallery", capabilityId: "DEL-02", label: "Curate and edit the photographs", mode: "creative", repeatable: true, evidence: "intentionally human creative work" },
  { id: "gallery-capture", capabilityId: "DEL-02", label: "Capture gallery provider release details", mode: "automatic", repeatable: true, evidence: "secure per-project gallery inbox" },
  { id: "delivery-release", capabilityId: "DEL-02", label: "Release the gallery and client follow-ups", mode: "approval", repeatable: true, evidence: "prefilled gallery approval" },
  { id: "album-reminders", capabilityId: "DEL-03", label: "Run album reminders until evidence arrives", mode: "automatic", repeatable: true, evidence: "evidence-aware reminder stops" },
  { id: "review-sequence", capabilityId: "DEL-04", label: "Run the review sequence", mode: "automatic", repeatable: true, evidence: "portal-first review scheduler" },
  { id: "closeout", capabilityId: "DEL-05", label: "Approve deterministic closeout", mode: "approval", repeatable: true, evidence: "evidence-gated closeout" },
  { id: "daily-command", capabilityId: "CORE-02", label: "Prioritize approvals, exceptions, and active work", mode: "automatic", repeatable: true, evidence: "daily command center" },
  { id: "recovery", capabilityId: "CORE-03", label: "Route failed automation for recovery", mode: "exception", repeatable: true, evidence: "receipts, retry, and dead-letter recovery" },
];

const statusWeight: Record<CapabilityStatus, number> = {
  operational: 1,
  partial: 0.5,
  unproven: 0,
};

const percent = (value: number, total: number) =>
  total ? Math.round((value / total) * 100) : 0;

export function implementationReadinessScorecard() {
  const capabilityStatus = new Map(
    workflowCapabilityRegistry.map((capability) => [
      capability.id,
      capability.status,
    ]),
  );
  const weighted = (workflow: ImplementationWorkflow) =>
    statusWeight[capabilityStatus.get(workflow.capabilityId) ?? "unproven"];
  const operational = workflowCapabilityRegistry.filter(
    (capability) => capability.status === "operational",
  ).length;
  const partial = workflowCapabilityRegistry.filter(
    (capability) => capability.status === "partial",
  ).length;
  const repeatable = workflows.filter(
    (workflow) => workflow.repeatable && workflow.mode !== "creative",
  );
  const automatedPreparation = repeatable.filter((workflow) =>
    ["automatic", "approval", "exception"].includes(workflow.mode),
  );
  const humanTouches = repeatable.filter((workflow) =>
    ["approval", "exception", "manual"].includes(workflow.mode),
  );
  const approvalLed = humanTouches.filter((workflow) =>
    ["approval", "exception"].includes(workflow.mode),
  );

  return {
    workflows: workflows.map((workflow) => ({
      ...workflow,
      status: capabilityStatus.get(workflow.capabilityId) ?? "unproven",
    })),
    coverage: {
      score: percent(
        operational + partial * 0.5,
        workflowCapabilityRegistry.length,
      ),
      operational,
      partial,
      total: workflowCapabilityRegistry.length,
    },
    automation: {
      score: percent(
        automatedPreparation.reduce((sum, workflow) => sum + weighted(workflow), 0),
        repeatable.length,
      ),
      prepared: automatedPreparation.length,
      eligible: repeatable.length,
    },
    approvalLed: {
      score: percent(
        approvalLed.reduce((sum, workflow) => sum + weighted(workflow), 0),
        humanTouches.length,
      ),
      approvalOrExceptionTouches: approvalLed.length,
      manualRoutineTouches: humanTouches.filter((workflow) => workflow.mode === "manual").length,
      evaluatedTouches: humanTouches.length,
    },
  };
}

export const implementationWorkflowRegistry = workflows;
