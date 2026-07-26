import { randomUUID } from "node:crypto";
import {
  normalizeEmail,
  normalizePhone,
  type Contact,
} from "@/features/contacts/schema";
import {
  createLeadDuplicateKey,
  detectMissingLeadInformation,
  publicLeadIntakeSchema,
  type Lead,
  type PublicLeadIntake,
} from "@/features/leads/schema";

export type TenantLeadSettings = {
  tenantId: string;
  tenantSlug: string;
  defaultEventTypeId: string;
  defaultAssigneeId: string | null;
  availabilityStatus: "available" | "conflict" | "unknown";
};

export interface LeadIntakeStore {
  findTenantBySlug(slug: string): Promise<TenantLeadSettings | null>;
  findContactByEmail(tenantId: string, normalizedEmail: string): Promise<Contact | null>;
  findLeadByDuplicateKey(tenantId: string, duplicateKey: string): Promise<Lead | null>;
  createContact(contact: Contact): Promise<void>;
  createLead(lead: Lead): Promise<void>;
}

export type LeadIntakeResult = {
  leadId: string;
  duplicate: boolean;
  duplicateOfLeadId: string | null;
  availabilityStatus: "available" | "conflict" | "unknown";
  missingInformation: string[];
};

export class LeadIntakeService {
  constructor(
    private readonly store: LeadIntakeStore,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly createId: () => string = () => randomUUID(),
  ) {}

  async submit(rawInput: unknown): Promise<LeadIntakeResult> {
    const input: PublicLeadIntake = publicLeadIntakeSchema.parse(rawInput);
    const settings = await this.store.findTenantBySlug(input.tenantSlug);
    if (!settings) throw new Error("Inquiry form is unavailable.");

    const normalizedEmail = normalizeEmail(input.email);
    const normalizedPhone = normalizePhone(input.phone);
    const duplicateKey = createLeadDuplicateKey(input);
    const [existingContact, duplicateLead] = await Promise.all([
      this.store.findContactByEmail(settings.tenantId, normalizedEmail),
      this.store.findLeadByDuplicateKey(settings.tenantId, duplicateKey),
    ]);
    const timestamp = this.now();
    const contactId = existingContact?.id ?? this.createId();
    const leadId = this.createId();
    const systemActor = "public-lead-intake";
    const missingInformation = detectMissingLeadInformation(input);

    if (!existingContact) {
      await this.store.createContact({
        id: contactId,
        tenantId: settings.tenantId,
        firstName: input.firstName,
        lastName: input.lastName,
        displayName: `${input.firstName} ${input.lastName}`.trim(),
        email: input.email,
        normalizedEmail,
        phone: input.phone,
        normalizedPhone,
        company: null,
        contactTypes: ["prospect"],
        projectIds: [],
        portalUserId: null,
        marketingConsent: input.consent,
        notes: input.partnerName ? `Partner: ${input.partnerName}` : null,
        createdAt: timestamp,
        updatedAt: timestamp,
        createdBy: systemActor,
        updatedBy: systemActor,
        archivedAt: null,
      });
    }

    await this.store.createLead({
      id: leadId,
      tenantId: settings.tenantId,
      projectId: null,
      primaryContactId: contactId,
      status: "new",
      eventTypeId: settings.defaultEventTypeId,
      eventTypeLabel: input.eventType,
      eventDate: input.eventDate,
      venue: input.venue,
      city: input.city,
      estimatedGuestCount: input.estimatedGuestCount,
      servicesRequested: input.servicesRequested,
      budgetRange: input.budgetRange,
      referralSource: input.referralSource,
      message: input.message,
      assignedUserId: settings.defaultAssigneeId,
      duplicateKey,
      duplicateOfLeadId: duplicateLead?.id ?? null,
      availabilityStatus: settings.availabilityStatus,
      aiSummary: null,
      missingInformation,
      suggestedConsultationQuestions: [],
      consentRecordedAt: timestamp,
      source: input.source,
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy: systemActor,
      updatedBy: systemActor,
      archivedAt: null,
    });

    return {
      leadId,
      duplicate: Boolean(duplicateLead),
      duplicateOfLeadId: duplicateLead?.id ?? null,
      availabilityStatus: settings.availabilityStatus,
      missingInformation,
    };
  }
}
