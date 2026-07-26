import type {
  AccountingProvider,
  AvailabilityWindow,
  CalendarEventInput,
  CalendarProvider,
  CustomerInput,
  EnvelopeInput,
  InvoiceInput,
  MeetingInput,
  MeetingProvider,
  ProviderConnectionResult,
  ProviderContext,
  ProviderHealth,
  SignatureProvider,
  StorageProvider,
} from "@/server/integrations/contracts";

abstract class MockConnection {
  abstract readonly key: string;
  async connect(context: ProviderContext, authorizationCode: string): Promise<ProviderConnectionResult> {
    void authorizationCode;
    return { providerAccountId: `mock_${this.key}_${context.tenantId}`, displayName: `${this.key} mock`, connectedAt: new Date().toISOString() };
  }
  async disconnect(context: ProviderContext): Promise<void> { void context; }
  async refresh(context: ProviderContext): Promise<void> { void context; }
  async healthCheck(context: ProviderContext): Promise<ProviderHealth> {
    void context;
    return { status: "healthy", checkedAt: new Date().toISOString(), message: "Development mock connected.", latencyMs: 0 };
  }
}

export class MockGoogleCalendarProvider extends MockConnection implements CalendarProvider {
  readonly key = "google_calendar";
  async getAvailability(
    context: ProviderContext,
    input: { startsAt: string; endsAt: string; timezone: string },
  ): Promise<readonly AvailabilityWindow[]> {
    void context;
    return [{ startsAt: input.startsAt, endsAt: input.endsAt, available: true }];
  }
  async createEvent(context: ProviderContext, input: CalendarEventInput, idempotencyKey: string) {
    void context; void input;
    return { id: `gcal_${idempotencyKey}`, htmlLink: `https://calendar.google.com/calendar/event?eid=${idempotencyKey}` };
  }
  async updateEvent(context: ProviderContext, eventId: string, input: CalendarEventInput) { void context; void eventId; void input; }
  async cancelEvent(context: ProviderContext, eventId: string) { void context; void eventId; }
}

export class MockZoomProvider extends MockConnection implements MeetingProvider {
  readonly key = "zoom";
  async createMeeting(context: ProviderContext, input: MeetingInput, idempotencyKey: string) {
    void context; void input;
    return { id: `zoom_${idempotencyKey}`, joinUrl: `https://zoom.example.test/j/${idempotencyKey}`, startUrl: `https://zoom.example.test/s/${idempotencyKey}` };
  }
  async updateMeeting(context: ProviderContext, meetingId: string, input: MeetingInput) { void context; void meetingId; void input; }
  async cancelMeeting(context: ProviderContext, meetingId: string) { void context; void meetingId; }
}

export class MockQuickBooksProvider extends MockConnection implements AccountingProvider {
  readonly key = "quickbooks";
  async searchCustomers(context: ProviderContext, email: string) {
    void context;
    return email.endsWith("@existing.test") ? [{ id: "qbo_customer_existing", displayName: email }] : [];
  }
  async createCustomer(context: ProviderContext, input: CustomerInput) {
    void context;
    return { id: `qbo_customer_${input.primaryEmail.replaceAll(/[^a-z0-9]/gi, "_")}` };
  }
  async createInvoice(context: ProviderContext, input: InvoiceInput, idempotencyKey: string) {
    void context; void input;
    return { id: `qbo_invoice_${idempotencyKey}`, hostedUrl: `https://pay.example.test/${idempotencyKey}` };
  }
  async getInvoice(context: ProviderContext, invoiceId: string) {
    void context;
    return { id: invoiceId, status: "paid", amountCents: 100000, balanceCents: 0 };
  }
}

export class MockDocusignProvider extends MockConnection implements SignatureProvider {
  readonly key = "docusign";
  async createEnvelope(context: ProviderContext, input: EnvelopeInput, idempotencyKey: string) {
    void context; void input;
    return { id: `envelope_${idempotencyKey}`, status: "sent" };
  }
  async getEnvelope(context: ProviderContext, envelopeId: string) { void context; return { id: envelopeId, status: "completed" }; }
  async resendEnvelope(context: ProviderContext, envelopeId: string) { void context; void envelopeId; }
  async voidEnvelope(context: ProviderContext, envelopeId: string, reason: string) { void context; void envelopeId; void reason; }
  async downloadCompletedDocuments(context: ProviderContext, envelopeId: string) {
    void context; void envelopeId;
    return { signedPdf: new Uint8Array([37, 80, 68, 70]), completionCertificate: new Uint8Array([37, 80, 68, 70]) };
  }
}

export class MockDropboxProvider extends MockConnection implements StorageProvider {
  readonly key = "dropbox";
  async createFolder(context: ProviderContext, path: string, idempotencyKey: string) {
    void context;
    return { id: `dropbox_folder_${idempotencyKey}`, canonicalPath: path };
  }
  async uploadFile(context: ProviderContext, input: { path: string; bytes: Uint8Array; contentType: string }, idempotencyKey: string) {
    void context; void input.bytes; void input.contentType;
    return { id: `dropbox_file_${idempotencyKey}`, revision: "1", canonicalPath: input.path };
  }
  async downloadFile(context: ProviderContext, fileId: string) { void context; void fileId; return new Uint8Array(); }
  async temporaryLink(context: ProviderContext, fileId: string) {
    void context;
    return { url: `https://dropbox.example.test/${fileId}`, expiresAt: new Date(Date.now() + 14_400_000).toISOString() };
  }
}
