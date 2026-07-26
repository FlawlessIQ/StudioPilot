import assert from "node:assert/strict";
import test from "node:test";
import type { Contact } from "@/features/contacts/schema";
import type { Lead } from "@/features/leads/schema";
import {
  LeadIntakeService,
  type LeadIntakeStore,
  type TenantLeadSettings,
} from "@/server/services/lead-intake-service";

class MemoryLeadStore implements LeadIntakeStore {
  readonly contacts: Contact[] = [];
  readonly leads: Lead[] = [];

  async findTenantBySlug(slug: string): Promise<TenantLeadSettings | null> {
    return slug === "alder-and-muse"
      ? {
          tenantId: "tenant-a",
          tenantSlug: slug,
          defaultEventTypeId: "wedding",
          defaultAssigneeId: "coordinator",
          availabilityStatus: "unknown",
        }
      : null;
  }

  async findContactByEmail(tenantId: string, normalizedEmail: string) {
    return this.contacts.find(
      (contact) =>
        contact.tenantId === tenantId && contact.normalizedEmail === normalizedEmail,
    ) ?? null;
  }

  async findLeadByDuplicateKey(tenantId: string, duplicateKey: string) {
    return this.leads.find(
      (lead) => lead.tenantId === tenantId && lead.duplicateKey === duplicateKey,
    ) ?? null;
  }

  async createContact(contact: Contact) {
    this.contacts.push(contact);
  }

  async createLead(lead: Lead) {
    this.leads.push(lead);
  }
}

const validInquiry = {
  tenantSlug: "alder-and-muse",
  firstName: "Lena",
  lastName: "Ortiz",
  partnerName: "Chris",
  email: "LENA@example.test",
  phone: "(212) 555-0112",
  eventDate: "2027-05-22",
  eventType: "Wedding",
  venue: null,
  city: "Brooklyn",
  estimatedGuestCount: null,
  servicesRequested: ["photography"] as const,
  budgetRange: null,
  referralSource: "Venue",
  message: "We are planning a warm, intimate wedding with documentary coverage.",
  consent: true as const,
  source: "public_inquiry",
  honeypot: "",
};

test("lead intake normalizes contact data and records missing information", async () => {
  const store = new MemoryLeadStore();
  const ids = ["contact-1", "lead-1"];
  const service = new LeadIntakeService(
    store,
    () => "2026-07-26T12:00:00.000Z",
    () => ids.shift() ?? "unexpected",
  );
  const result = await service.submit(validInquiry);

  assert.equal(result.leadId, "lead-1");
  assert.equal(result.duplicate, false);
  assert.deepEqual(result.missingInformation, [
    "venue",
    "budget range",
    "estimated guest count",
  ]);
  assert.equal(store.contacts[0]?.normalizedEmail, "lena@example.test");
  assert.equal(store.contacts[0]?.normalizedPhone, "2125550112");
  assert.equal(store.leads[0]?.primaryContactId, "contact-1");
});

test("duplicate inquiry reuses the contact and links the prior lead", async () => {
  const store = new MemoryLeadStore();
  const service = new LeadIntakeService(store, () => "2026-07-26T12:00:00.000Z");
  await service.submit(validInquiry);
  const second = await service.submit(validInquiry);

  assert.equal(store.contacts.length, 1);
  assert.equal(store.leads.length, 2);
  assert.equal(second.duplicate, true);
  assert.equal(second.duplicateOfLeadId, store.leads[0]?.id);
});

test("lead intake rejects missing consent and bot honeypot content", async () => {
  const service = new LeadIntakeService(new MemoryLeadStore());
  await assert.rejects(service.submit({ ...validInquiry, consent: false }));
  await assert.rejects(service.submit({ ...validInquiry, honeypot: "spam" }));
});
