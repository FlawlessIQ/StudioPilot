import assert from "node:assert/strict";
import test from "node:test";
import type { Consultation } from "@/features/consultations/schema";
import { MockGoogleCalendarProvider, MockZoomProvider } from "@/server/integrations/booking/mock-booking-providers";
import { ConsultationService, type ConsultationStore } from "@/server/services/consultation-service";

test("Zoom consultations create one meeting and one calendar event idempotently", async () => {
  let saved: Consultation | null = null;
  const store: ConsultationStore = {
    async findByIdempotencyKey() { return saved; },
    async hasConflict() { return false; },
    async create(consultation) { saved = consultation; },
  };
  const service = new ConsultationService(
    store,
    new MockGoogleCalendarProvider(),
    new MockZoomProvider(),
    () => "consultation-a",
    () => "2026-07-26T12:00:00.000Z",
  );
  const context = { userId: "owner", tenantId: "tenant-a", membershipTenantId: "tenant-a", role: "studio_owner" as const };
  const input = {
    projectId: "project-a",
    contactId: "contact-a",
    contactEmail: "client@example.test",
    projectName: "Sample Wedding",
    mode: "zoom" as const,
    startsAt: "2026-07-29T18:00:00.000Z",
    endsAt: "2026-07-29T18:45:00.000Z",
    timezone: "America/New_York",
    location: null,
    internalNotes: null,
    idempotencyKey: "consultation-project-a",
  };
  const first = await service.schedule(context, input);
  const second = await service.schedule(context, input);
  assert.equal(first.existing, false);
  assert.equal(second.existing, true);
  assert.match(first.consultation.joinUrl ?? "", /zoom\.example\.test/);
  assert.match(first.consultation.calendarEventId ?? "", /gcal_/);
});

test("consultation conflicts prevent provider creation", async () => {
  const store: ConsultationStore = {
    async findByIdempotencyKey() { return null; },
    async hasConflict() { return true; },
    async create() { throw new Error("should not save"); },
  };
  const service = new ConsultationService(store, new MockGoogleCalendarProvider(), new MockZoomProvider(), () => "id");
  await assert.rejects(() => service.schedule(
    { userId: "owner", tenantId: "tenant-a", membershipTenantId: "tenant-a", role: "studio_owner" },
    {
      projectId: "project-a", contactId: "contact-a", contactEmail: "client@example.test", projectName: "Wedding",
      mode: "phone", startsAt: "2026-07-29T18:00:00.000Z", endsAt: "2026-07-29T18:45:00.000Z",
      timezone: "America/New_York", location: null, internalNotes: null, idempotencyKey: "conflict-key",
    },
  ), /conflicts/);
});
