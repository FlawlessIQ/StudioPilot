import { bookingGateResultSchema, type BookingGateEvidence, type BookingGateResult } from "@/features/booking/schema";

type SigningProvider = "docusign" | "dropbox_sign";

const signingLabels: Readonly<Record<SigningProvider, string>> = {
  docusign: "Docusign contract completed",
  dropbox_sign: "Dropbox Sign contract completed",
};

// `contractAttestedManually` is excluded alongside `contractCompleted`:
// both feed the one signature requirement, which is labelled above by
// whichever authority satisfied it, rather than appearing as a row of its
// own.
const labels: Readonly<Record<Exclude<keyof BookingGateEvidence, "contractCompleted" | "contractAttestedManually">, { label: string; source: BookingGateResult["requirements"][number]["source"] }>> = {
  retainerInvoiceCreated: { label: "QuickBooks retainer invoice created", source: "quickbooks" },
  retainerSatisfied: { label: "Retainer paid", source: "quickbooks" },
  retainerExceptionApproved: { label: "Retainer exception approved", source: "approved_exception" },
  eventDateAvailable: { label: "Event date available", source: "calendar" },
  requiredContactsComplete: { label: "Required contact details complete", source: "project" },
};

export function evaluateBookingGate(input: {
  tenantId: string;
  projectId: string;
  evidence: BookingGateEvidence;
  evaluatedAt: string;
  // Which signing provider the contract was (or would be) completed
  // through — determines the requirement's label/source. Defaults to
  // "docusign" for callers that predate multi-provider signing.
  signingProvider?: SigningProvider;
}): BookingGateResult {
  const signingProvider = input.signingProvider ?? "docusign";
  // Which authority actually satisfied the signature requirement. A
  // provider-verified completion and a studio owner's attestation both pass
  // the gate; the result says which one, because the audit record is the
  // point.
  const contractCompletedMeta =
    input.evidence.contractAttestedManually && !input.evidence.contractCompleted
      ? { label: "Signed agreement recorded by the studio", source: "manual_attestation" as const }
      : { label: signingLabels[signingProvider], source: signingProvider };
  const effective = {
    contractCompleted:
      input.evidence.contractCompleted || input.evidence.contractAttestedManually,
    retainerInvoiceCreated: input.evidence.retainerInvoiceCreated,
    retainerSatisfied: input.evidence.retainerSatisfied || input.evidence.retainerExceptionApproved,
    eventDateAvailable: input.evidence.eventDateAvailable,
    requiredContactsComplete: input.evidence.requiredContactsComplete,
  };
  const requirements = (Object.keys(effective) as (keyof typeof effective)[]).map((key) => {
    const meta = key === "contractCompleted" ? contractCompletedMeta : labels[key];
    return {
      key,
      label: meta.label,
      passed: effective[key],
      source: effective[key] && key === "retainerSatisfied" && input.evidence.retainerExceptionApproved
        ? "approved_exception" as const
        : meta.source,
    };
  });
  return bookingGateResultSchema.parse({
    tenantId: input.tenantId,
    projectId: input.projectId,
    passed: requirements.every((item) => item.passed),
    requirements,
    blockers: requirements.filter((item) => !item.passed).map((item) => item.label),
    evaluatedAt: input.evaluatedAt,
    rulesVersion: 1,
  });
}

export interface BookingCompletionStore {
  getCompletedRun(tenantId: string, idempotencyKey: string): Promise<{ projectId: string } | null>;
  completeAtomically(input: {
    tenantId: string;
    projectId: string;
    idempotencyKey: string;
    folderId: string;
    folderPath: string;
    calendarEventId: string;
    workflowRunId: string;
    portalAccessId: string;
    completedAt: string;
  }): Promise<void>;
}

export interface BookingCompletionSteps {
  createProjectFolders(): Promise<{ id: string; path: string }>;
  createProductionEvent(): Promise<{ id: string }>;
  instantiateWorkflow(): Promise<{ id: string }>;
  activateClientPortal(): Promise<{ id: string }>;
  sendConfirmation(): Promise<{ id: string }>;
}

export class BookingGateService {
  constructor(
    private readonly store: BookingCompletionStore,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async complete(input: {
    tenantId: string;
    projectId: string;
    idempotencyKey: string;
    evidence: BookingGateEvidence;
    steps: BookingCompletionSteps;
  }): Promise<{ completed: boolean; gate: BookingGateResult }> {
    const gate = evaluateBookingGate({
      tenantId: input.tenantId,
      projectId: input.projectId,
      evidence: input.evidence,
      evaluatedAt: this.now(),
    });
    if (!gate.passed) return { completed: false, gate };
    if (await this.store.getCompletedRun(input.tenantId, input.idempotencyKey)) {
      return { completed: true, gate };
    }
    const folder = await input.steps.createProjectFolders();
    const event = await input.steps.createProductionEvent();
    const workflow = await input.steps.instantiateWorkflow();
    const portal = await input.steps.activateClientPortal();
    await input.steps.sendConfirmation();
    await this.store.completeAtomically({
      tenantId: input.tenantId,
      projectId: input.projectId,
      idempotencyKey: input.idempotencyKey,
      folderId: folder.id,
      folderPath: folder.path,
      calendarEventId: event.id,
      workflowRunId: workflow.id,
      portalAccessId: portal.id,
      completedAt: this.now(),
    });
    return { completed: true, gate };
  }
}
