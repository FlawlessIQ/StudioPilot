import { z } from "zod";

export const providerHealthSchema = z.object({
  status: z.enum(["healthy", "degraded", "disconnected", "error"]),
  checkedAt: z.string().datetime(),
  message: z.string().nullable(),
  latencyMs: z.number().int().nonnegative().nullable(),
});

export type ProviderHealth = z.infer<typeof providerHealthSchema>;

export type ProviderContext = {
  tenantId: string;
  correlationId: string;
};

export type ProviderConnectionResult = {
  providerAccountId: string;
  displayName: string;
  connectedAt: string;
};

export type NormalizedProviderError = {
  code: string;
  message: string;
  retryable: boolean;
  providerStatus?: number;
  details?: Record<string, unknown>;
};

export interface ProviderAdapter {
  readonly key: string;
  connect(context: ProviderContext, authorizationCode: string): Promise<ProviderConnectionResult>;
  disconnect(context: ProviderContext): Promise<void>;
  refresh(context: ProviderContext): Promise<void>;
  healthCheck(context: ProviderContext): Promise<ProviderHealth>;
}

export interface AccountingProvider extends ProviderAdapter {
  createCustomer(context: ProviderContext, input: Record<string, unknown>): Promise<{ id: string }>;
  createInvoice(
    context: ProviderContext,
    input: Record<string, unknown>,
    idempotencyKey: string,
  ): Promise<{ id: string; hostedUrl: string | null }>;
}

export interface CalendarProvider extends ProviderAdapter {
  createEvent(
    context: ProviderContext,
    input: Record<string, unknown>,
    idempotencyKey: string,
  ): Promise<{ id: string; htmlLink: string | null }>;
}

export interface MeetingProvider extends ProviderAdapter {
  createMeeting(
    context: ProviderContext,
    input: Record<string, unknown>,
    idempotencyKey: string,
  ): Promise<{ id: string; joinUrl: string; startUrl: string }>;
}

export interface StorageProvider extends ProviderAdapter {
  createFolder(
    context: ProviderContext,
    path: string,
    idempotencyKey: string,
  ): Promise<{ id: string; canonicalPath: string }>;
  uploadFile(
    context: ProviderContext,
    input: { path: string; bytes: Uint8Array; contentType: string },
    idempotencyKey: string,
  ): Promise<{ id: string; revision: string; canonicalPath: string }>;
}

export interface SignatureProvider extends ProviderAdapter {
  createEnvelope(
    context: ProviderContext,
    input: Record<string, unknown>,
    idempotencyKey: string,
  ): Promise<{ id: string; status: string }>;
}

export interface EmailProvider extends ProviderAdapter {
  send(
    context: ProviderContext,
    input: Record<string, unknown>,
    idempotencyKey: string,
  ): Promise<{ messageId: string }>;
}

export interface SmsProvider extends ProviderAdapter {
  send(
    context: ProviderContext,
    input: Record<string, unknown>,
    idempotencyKey: string,
  ): Promise<{ messageId: string }>;
}

export interface BillingProvider extends ProviderAdapter {
  createCheckoutSession(
    context: ProviderContext,
    priceId: string,
    idempotencyKey: string,
  ): Promise<{ id: string; url: string }>;
}

export interface AiProvider extends ProviderAdapter {
  generateStructured<TOutput>(
    context: ProviderContext,
    input: {
      task: "extraction" | "drafting" | "summarization" | "schedule" | "risk" | "explanation";
      prompt: string;
      outputSchema: z.ZodType<TOutput>;
    },
  ): Promise<TOutput>;
}

export type DomainEvent = {
  id: string;
  tenantId: string;
  projectId?: string;
  type: string;
  occurredAt: string;
  source: string;
  correlationId: string;
  payload: Record<string, unknown>;
};
