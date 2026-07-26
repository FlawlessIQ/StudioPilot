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

export type OAuthConnectionRequest = {
  authorizationCode: string;
  redirectUri: string;
};

export type AvailabilityWindow = {
  startsAt: string;
  endsAt: string;
  available: boolean;
};

export type CalendarEventInput = {
  title: string;
  description: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  location: string | null;
  attendeeEmails: readonly string[];
  remindersMinutes: readonly number[];
};

export type MeetingInput = {
  topic: string;
  startsAt: string;
  durationMinutes: number;
  timezone: string;
  waitingRoom: boolean;
  passwordRequired: boolean;
};

export type CustomerInput = {
  displayName: string;
  primaryEmail: string;
  phone: string | null;
};

export type InvoiceInput = {
  customerId: string;
  projectId: string;
  currency: string;
  dueDate: string;
  memo: string;
  lineItems: readonly {
    description: string;
    quantity: number;
    unitAmountCents: number;
  }[];
};

export type EnvelopeInput = {
  templateId: string;
  subject: string;
  mergeFields: Readonly<Record<string, string>>;
  signers: readonly {
    name: string;
    email: string;
    role: string;
    order: number;
  }[];
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
  searchCustomers(context: ProviderContext, email: string): Promise<readonly { id: string; displayName: string }[]>;
  createCustomer(context: ProviderContext, input: CustomerInput): Promise<{ id: string }>;
  createInvoice(
    context: ProviderContext,
    input: InvoiceInput,
    idempotencyKey: string,
  ): Promise<{ id: string; hostedUrl: string | null }>;
  getInvoice(context: ProviderContext, invoiceId: string): Promise<{
    id: string;
    status: string;
    amountCents: number;
    balanceCents: number;
  }>;
}

export interface CalendarProvider extends ProviderAdapter {
  getAvailability(
    context: ProviderContext,
    input: { startsAt: string; endsAt: string; timezone: string },
  ): Promise<readonly AvailabilityWindow[]>;
  createEvent(
    context: ProviderContext,
    input: CalendarEventInput,
    idempotencyKey: string,
  ): Promise<{ id: string; htmlLink: string | null }>;
  updateEvent(context: ProviderContext, eventId: string, input: CalendarEventInput): Promise<void>;
  cancelEvent(context: ProviderContext, eventId: string): Promise<void>;
}

export interface MeetingProvider extends ProviderAdapter {
  createMeeting(
    context: ProviderContext,
    input: MeetingInput,
    idempotencyKey: string,
  ): Promise<{ id: string; joinUrl: string; startUrl: string }>;
  updateMeeting(context: ProviderContext, meetingId: string, input: MeetingInput): Promise<void>;
  cancelMeeting(context: ProviderContext, meetingId: string): Promise<void>;
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
  downloadFile(context: ProviderContext, fileId: string): Promise<Uint8Array>;
  temporaryLink(context: ProviderContext, fileId: string): Promise<{ url: string; expiresAt: string }>;
}

export interface SignatureProvider extends ProviderAdapter {
  createEnvelope(
    context: ProviderContext,
    input: EnvelopeInput,
    idempotencyKey: string,
  ): Promise<{ id: string; status: string }>;
  getEnvelope(context: ProviderContext, envelopeId: string): Promise<{ id: string; status: string }>;
  resendEnvelope(context: ProviderContext, envelopeId: string): Promise<void>;
  voidEnvelope(context: ProviderContext, envelopeId: string, reason: string): Promise<void>;
  downloadCompletedDocuments(context: ProviderContext, envelopeId: string): Promise<{
    signedPdf: Uint8Array;
    completionCertificate: Uint8Array;
  }>;
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
