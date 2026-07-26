import type { AuthorizationContext } from "@/features/auth/authorize";
import { authorize } from "@/features/auth/authorize";
import type { PackageSnapshot } from "@/features/packages/schema";
import { proposalSchema, type Proposal } from "@/features/proposals/schema";
import type { Project } from "@/features/projects/schema";

export interface ProposalStore {
  latestForProject(tenantId: string, projectId: string): Promise<Proposal | null>;
  createVersion(proposal: Proposal, supersededId: string | null): Promise<void>;
}

export class ProposalService {
  constructor(
    private readonly store: ProposalStore,
    private readonly createId: () => string,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async createDraft(
    context: AuthorizationContext,
    input: {
      project: Project;
      packageSnapshot: PackageSnapshot;
      client: { displayName: string; email: string };
      expiresAt: string;
      notes: string | null;
    },
  ): Promise<Proposal> {
    authorize(context, "projects.manage", input.project.id);
    if (input.project.tenantId !== context.tenantId || input.packageSnapshot.tenantId !== context.tenantId) {
      throw new Error("Proposal tenant mismatch.");
    }
    if (input.packageSnapshot.projectId !== input.project.id) {
      throw new Error("Package snapshot belongs to another project.");
    }
    const previous = await this.store.latestForProject(context.tenantId, input.project.id);
    const timestamp = this.now();
    const balanceCents = input.packageSnapshot.totalCents - input.packageSnapshot.retainerCents;
    const proposal = proposalSchema.parse({
      id: this.createId(),
      tenantId: context.tenantId,
      projectId: input.project.id,
      packageSnapshotId: input.packageSnapshot.id,
      version: (previous?.version ?? 0) + 1,
      status: "draft",
      clientSnapshot: input.client,
      eventSnapshot: {
        name: input.project.name,
        eventType: input.project.eventType,
        eventDate: input.project.eventDate,
        timezone: input.project.timezone,
        venue: input.project.venueName,
      },
      pricingSnapshot: {
        currency: input.packageSnapshot.currency,
        packageName: input.packageSnapshot.packageName,
        subtotalCents: input.packageSnapshot.subtotalCents,
        discountCents: input.packageSnapshot.discountCents,
        taxCents: input.packageSnapshot.taxCents,
        retainerCents: input.packageSnapshot.retainerCents,
        totalCents: input.packageSnapshot.totalCents,
        lineItems: [
          { description: input.packageSnapshot.packageName, quantity: 1, unitPriceCents: input.packageSnapshot.basePriceCents, totalCents: input.packageSnapshot.basePriceCents },
          ...input.packageSnapshot.addOns.map((item) => ({
            description: item.name,
            quantity: item.quantity,
            unitPriceCents: item.unitPriceCents,
            totalCents: item.lineTotalCents,
          })),
        ],
      },
      paymentSchedule: [
        { label: "Retainer", amountCents: input.packageSnapshot.retainerCents, dueDate: null },
        { label: "Final balance", amountCents: balanceCents, dueDate: null },
      ],
      expiresAt: input.expiresAt,
      notes: input.notes,
      termsSummary: input.packageSnapshot.terms,
      pdfDocumentId: null,
      sentAt: null,
      viewedAt: null,
      acceptedAt: null,
      supersedesId: previous?.id ?? null,
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy: context.userId,
      updatedBy: context.userId,
      archivedAt: null,
    });
    await this.store.createVersion(proposal, previous?.id ?? null);
    return proposal;
  }
}
