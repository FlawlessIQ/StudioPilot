import { bookingGateResultSchema, type BookingGateEvidence, type BookingGateResult } from "@/features/booking/schema";

const labels: Readonly<Record<keyof BookingGateEvidence, { label: string; source: BookingGateResult["requirements"][number]["source"] }>> = {
  contractCompleted: { label: "Docusign contract completed", source: "docusign" },
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
}): BookingGateResult {
  const effective = {
    contractCompleted: input.evidence.contractCompleted,
    retainerInvoiceCreated: input.evidence.retainerInvoiceCreated,
    retainerSatisfied: input.evidence.retainerSatisfied || input.evidence.retainerExceptionApproved,
    eventDateAvailable: input.evidence.eventDateAvailable,
    requiredContactsComplete: input.evidence.requiredContactsComplete,
  };
  const requirements = (Object.keys(effective) as (keyof typeof effective)[]).map((key) => ({
    key,
    label: labels[key].label,
    passed: effective[key],
    source: effective[key] && key === "retainerSatisfied" && input.evidence.retainerExceptionApproved
      ? "approved_exception" as const
      : labels[key].source,
  }));
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
