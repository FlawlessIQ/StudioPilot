import type { InsuranceRequest } from "@/features/insurance/schema";

export interface CoiStore {
  getRequest(tenantId: string, requestId: string): Promise<InsuranceRequest | null>;
  recordDecision(input: { requestId: string; actorId: string; decision: "approved"|"rejected"; reason: string; timestamp: string }): Promise<void>;
}
export class CoiService {
  constructor(private readonly store: CoiStore, private readonly now = () => new Date().toISOString()) {}
  async decide(input: { tenantId: string; requestId: string; actorId: string; canApprove: boolean; decision: "approved"|"rejected"; reason: string }) {
    if (!input.canApprove) throw new Error("COI approval permission required.");
    if (input.reason.trim().length < 5) throw new Error("A review reason is required.");
    const request = await this.store.getRequest(input.tenantId, input.requestId);
    if (!request || !["under_review", "correction_required"].includes(request.status)) throw new Error("COI is not awaiting a human decision.");
    await this.store.recordDecision({ requestId: input.requestId, actorId: input.actorId, decision: input.decision, reason: input.reason.trim(), timestamp: this.now() });
  }
}
