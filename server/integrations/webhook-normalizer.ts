import { createHash } from "node:crypto";
import type { DomainEvent } from "./contracts";

export function normalizeWebhook(input: {
  provider: string;
  providerEventId: string;
  tenantId: string;
  projectId?: string;
  type: string;
  occurredAt: string;
  correlationId: string;
  payload: Record<string, unknown>;
}): DomainEvent {
  return {
    id: createHash("sha256").update(`${input.provider}:${input.providerEventId}`).digest("hex"),
    tenantId: input.tenantId,
    projectId: input.projectId,
    type: input.type,
    occurredAt: input.occurredAt,
    source: input.provider,
    correlationId: input.correlationId,
    payload: input.payload,
  };
}
