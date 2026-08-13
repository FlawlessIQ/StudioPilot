export type WorkflowEvidence = Record<string, unknown> & { id?: string };

export type CapabilityStatus = "operational" | "partial" | "unproven";

export type WorkflowCapability = {
  id: string;
  stage: string;
  label: string;
  status: CapabilityStatus;
};

const capabilities: WorkflowCapability[] = [
  ["MIG-01", "Studio setup", "Secure source ingestion", "operational"],
  ["MIG-02", "Studio setup", "Asset classification and extraction", "operational"],
  ["MIG-03", "Studio setup", "Variable and signer mapping", "operational"],
  ["MIG-04", "Studio setup", "Workflow inference", "operational"],
  ["MIG-05", "Studio setup", "Review, activation, versioning, rollback", "operational"],
  ["MIG-06", "Studio setup", "Migration health check", "operational"],
  ["CORE-01", "Workspace", "Lifecycle project workspace", "operational"],
  ["CORE-02", "Workspace", "Prepared-work approval queue", "operational"],
  ["CORE-03", "Workspace", "Automation receipts and recovery", "operational"],
  ["CORE-04", "Workspace", "Universal search and commands", "operational"],
  ["CORE-05", "Workspace", "Mobile daily agenda", "operational"],
  ["INQ-01", "Inquiry", "Inquiry extraction and deduplication", "operational"],
  ["INQ-02", "Inquiry", "Studio-voice response draft", "operational"],
  ["INQ-03", "Inquiry", "Progressive missing-information intake", "partial"],
  ["INQ-04", "Inquiry", "Availability-aware consultation", "operational"],
  ["INQ-05", "Inquiry", "Consultation brief and transcript", "operational"],
  ["BOOK-01", "Booking", "Package recommendations", "operational"],
  ["BOOK-02", "Booking", "Proposal draft and approval", "operational"],
  ["BOOK-03", "Booking", "Contract generation", "operational"],
  ["BOOK-04", "Booking", "Retainer invoice draft", "operational"],
  ["BOOK-05", "Booking", "Authoritative booking orchestration", "operational"],
  ["PLAN-01", "Planning", "Unified questionnaire", "operational"],
  ["PLAN-02", "Planning", "Fact-gap and contradiction detection", "operational"],
  ["PLAN-03", "Planning", "Reusable timing rules", "operational"],
  ["PLAN-04", "Planning", "Explainable schedule draft", "operational"],
  ["PLAN-05", "Planning", "Schedule impact and acknowledgement", "operational"],
  ["PLAN-06", "Planning", "COI extraction and review", "operational"],
  ["FIN-01", "Finance", "Final invoice preparation", "operational"],
  ["FIN-02", "Finance", "Balance discrepancy explanation", "operational"],
  ["CREW-01", "Crew", "Crew readiness profiles", "operational"],
  ["CREW-02", "Crew", "Sequential offer cascade", "operational"],
  ["CREW-03", "Crew", "Calendar and live schedule", "operational"],
  ["CREW-04", "Crew", "Conflict and travel reasoning", "operational"],
  ["EVENT-01", "Event", "Role-scoped event brief", "operational"],
  ["EVENT-02", "Event", "Offline schedule and acknowledgement", "operational"],
  ["DEL-01", "Delivery", "Client artifact hub", "operational"],
  ["DEL-02", "Delivery", "Gallery and album workflow", "operational"],
  ["DEL-03", "Delivery", "Evidence-aware album reminders", "operational"],
  ["DEL-04", "Delivery", "Configurable review sequence", "operational"],
  ["DEL-05", "Delivery", "Deterministic closeout", "operational"],
  ["OPS-01", "Operations", "Verified time-saved analytics", "operational"],
  ["OPS-02", "Operations", "Automation quality analytics", "operational"],
  ["OPS-03", "Operations", "Risk and workload forecast", "partial"],
  ["OPS-04", "Operations", "Vertical starter kits", "operational"],
].map(([id, stage, label, status]) => ({
  id,
  stage,
  label,
  status: status as CapabilityStatus,
}));

const number = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const object = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const percent = (numerator: number, denominator: number) =>
  denominator ? Math.round((numerator / denominator) * 100) : null;

export function workflowScorecard(input: {
  productEvents: WorkflowEvidence[];
  aiActions: WorkflowEvidence[];
  actionReceipts: WorkflowEvidence[];
  automationRuns: WorkflowEvidence[];
  providerJobs: WorkflowEvidence[];
  emailJobs: WorkflowEvidence[];
}) {
  const operational = capabilities.filter(
    (capability) => capability.status === "operational",
  ).length;
  const partial = capabilities.filter(
    (capability) => capability.status === "partial",
  ).length;
  const coverageScore = Math.round(
    ((operational + partial * 0.5) / capabilities.length) * 100,
  );

  const observedEvents = input.productEvents.filter((event) => {
    const properties = object(event.properties);
    return (
      properties.workflowStep === true ||
      typeof properties.executionMode === "string"
    );
  });
  const automaticSteps = observedEvents.filter((event) => {
    const mode = String(object(event.properties).executionMode ?? "");
    return ["automatic", "ai_prepared", "policy_automatic"].includes(mode);
  }).length;
  const manualSteps = observedEvents.filter(
    (event) => object(event.properties).executionMode === "manual",
  ).length;
  const automationScore = percent(automaticSteps, automaticSteps + manualSteps);

  const approvals = observedEvents.filter(
    (event) => object(event.properties).humanRole === "approval",
  ).length;
  const exceptions = observedEvents.filter(
    (event) => object(event.properties).humanRole === "exception",
  ).length;
  const dataEntry = observedEvents.filter(
    (event) => object(event.properties).humanRole === "data_entry",
  ).length;
  const routineManual = observedEvents.filter(
    (event) => object(event.properties).humanRole === "routine_execution",
  ).length;
  const approvalLedScore = percent(
    approvals + exceptions,
    approvals + exceptions + dataEntry + routineManual,
  );

  const aiDecisions = input.aiActions.filter((action) =>
    ["approved", "rejected", "dismissed", "executed"].includes(
      String(action.status),
    ),
  );
  const editedAi = aiDecisions.filter(
    (action) => Object.keys(object(object(action.decision).editDelta)).length > 0,
  ).length;
  const terminal = [
    ...input.actionReceipts,
    ...input.automationRuns,
    ...input.providerJobs,
    ...input.emailJobs,
  ].filter((record) =>
    ["completed", "succeeded", "failed", "dead_letter"].includes(
      String(record.status),
    ),
  );
  const failed = terminal.filter((record) =>
    ["failed", "dead_letter"].includes(String(record.status)),
  ).length;
  const verifiedSecondsSaved = input.productEvents.reduce((sum, event) => {
    const handling = object(event.handling);
    const method = String(handling.measurementMethod ?? "");
    return ["timer", "workflow_timestamps", "pilot_observation"].includes(method)
      ? sum + Math.max(0, number(handling.verifiedSecondsSaved))
      : sum;
  }, 0);

  return {
    capabilities,
    coverage: {
      score: coverageScore,
      operational,
      partial,
      total: capabilities.length,
    },
    automation: {
      score: automationScore,
      automaticSteps,
      manualSteps,
      observedSteps: automaticSteps + manualSteps,
    },
    approvalLed: {
      score: approvalLedScore,
      approvals,
      exceptions,
      dataEntry,
      routineManual,
      observedHumanTouches: approvals + exceptions + dataEntry + routineManual,
    },
    quality: {
      aiDecisions: aiDecisions.length,
      aiEditRate: percent(editedAi, aiDecisions.length),
      terminalExecutions: terminal.length,
      failedExecutions: failed,
      reliability: percent(terminal.length - failed, terminal.length),
      verifiedMinutesSaved: Math.round(verifiedSecondsSaved / 60),
    },
  };
}

export const workflowCapabilityRegistry = capabilities;
