import assert from "node:assert/strict";
import test from "node:test";
import {
  MockDropboxProvider,
  MockDocusignProvider,
  MockGoogleCalendarProvider,
  MockQuickBooksProvider,
  MockZoomProvider,
} from "@/server/integrations/booking/mock-booking-providers";
import { normalizeWebhook } from "@/server/integrations/webhook-normalizer";

test("booking provider mocks return stable provider identifiers", async () => {
  const context = { tenantId: "tenant-a", correlationId: "corr-a" };
  const calendar = await new MockGoogleCalendarProvider().createEvent(context, {
    title: "Event", description: "", startsAt: "2026-07-29T18:00:00.000Z", endsAt: "2026-07-29T19:00:00.000Z",
    timezone: "America/New_York", location: null, attendeeEmails: [], remindersMinutes: [],
  }, "same-key");
  const meeting = await new MockZoomProvider().createMeeting(context, {
    topic: "Consultation", startsAt: "2026-07-29T18:00:00.000Z", durationMinutes: 45,
    timezone: "America/New_York", waitingRoom: true, passwordRequired: true,
  }, "same-key");
  const folder = await new MockDropboxProvider().createFolder(context, "/StudioHub/2026/project", "same-key");
  assert.equal(calendar.id, "gcal_same-key");
  assert.equal(meeting.id, "zoom_same-key");
  assert.equal(folder.id, "dropbox_folder_same-key");
});

test("accounting and signature mocks preserve external system boundaries", async () => {
  const context = { tenantId: "tenant-a", correlationId: "corr-a" };
  const qbo = new MockQuickBooksProvider();
  const customer = await qbo.createCustomer(context, { displayName: "Client", primaryEmail: "client@example.test", phone: null });
  const envelope = await new MockDocusignProvider().createEnvelope(context, {
    templateId: "template-a", subject: "Agreement", mergeFields: {},
    signers: [{ name: "Client", email: "client@example.test", role: "primary_client", order: 1 }],
  }, "envelope-key");
  assert.match(customer.id, /^qbo_customer_/);
  assert.equal(envelope.status, "sent");
});

test("duplicate provider event IDs normalize to one internal event ID", () => {
  const input = {
    provider: "docusign", providerEventId: "event-1", tenantId: "tenant-a", projectId: "project-a",
    type: "contract.completed", occurredAt: "2026-07-26T12:00:00.000Z", correlationId: "corr-a", payload: {},
  };
  assert.equal(normalizeWebhook(input).id, normalizeWebhook(input).id);
});
