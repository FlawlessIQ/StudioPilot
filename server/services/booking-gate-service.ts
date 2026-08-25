import { bookingGateResultSchema, type BookingGateEvidence, type BookingGateResult } from "@/features/booking/schema";
import { bookingGateRequirements } from "@/features/booking/gate-requirements";

type SigningProvider = "docusign" | "dropbox_sign";

const signingLabels: Readonly<Record<SigningProvider, string>> = {
  docusign: "Docusign contract completed",
  dropbox_sign: "Dropbox Sign contract completed",
};

// The attestation flags are excluded alongside the requirements they
// satisfy: each feeds one requirement, which is labelled by whichever
// authority satisfied it, rather than appearing as a row of its own.
const labels: Readonly<Record<Exclude<keyof BookingGateEvidence, "contractCompleted" | "contractAttestedManually" | "retainerAttestedManually">, { label: string; source: BookingGateResult["requirements"][number]["source"] }>> = {
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
  // Same for the money. With no invoicing provider connected StudioCue
  // cannot raise a retainer and so can never watch one clear; the studio
  // takes the transfer and says so. Naming QuickBooks on a payment
  // QuickBooks never saw is exactly the blurring these fields exist to
  // prevent.
  //
  // An attestation outranks an approved exception in the label because it
  // is the stronger claim about the same requirement: the exception says
  // the studio proceeded without the money, the attestation says the money
  // is in. When both are recorded, the money arriving is what happened.
  const retainerAttested = input.evidence.retainerAttestedManually;
  const retainerCreatedMeta = retainerAttested
    ? { label: "Retainer recorded by the studio", source: "manual_attestation" as const }
    : labels.retainerInvoiceCreated;
  const retainerSatisfiedMeta = retainerAttested
    ? { label: "Retainer received outside StudioCue", source: "manual_attestation" as const }
    : labels.retainerSatisfied;
  // The one definition of how evidence folds into requirements, shared
  // with the Cloud Function that actually books the job.
  const effective = bookingGateRequirements({
    contractCompleted: input.evidence.contractCompleted,
    contractAttestedManually: input.evidence.contractAttestedManually,
    retainerInvoiceCreated: input.evidence.retainerInvoiceCreated,
    retainerAttestedManually: retainerAttested,
    retainerSatisfied: input.evidence.retainerSatisfied,
    retainerExceptionApproved: input.evidence.retainerExceptionApproved,
    eventDateAvailable: input.evidence.eventDateAvailable,
    requiredContactsComplete: input.evidence.requiredContactsComplete,
  });
  const metaFor = (key: keyof typeof effective) => {
    if (key === "contractCompleted") return contractCompletedMeta;
    if (key === "retainerInvoiceCreated") return retainerCreatedMeta;
    if (key === "retainerSatisfied") return retainerSatisfiedMeta;
    return labels[key];
  };
  const requirements = (Object.keys(effective) as (keyof typeof effective)[]).map((key) => {
    const meta = metaFor(key);
    return {
      key,
      label: meta.label,
      passed: effective[key],
      source:
        effective[key] &&
        key === "retainerSatisfied" &&
        input.evidence.retainerExceptionApproved &&
        !retainerAttested
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
