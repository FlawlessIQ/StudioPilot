import assert from "node:assert/strict";
import test from "node:test";
import { approvedCommunicationDispatch } from "../functions/src/ai/approved-communication";

const base = {
  actionId: "action-1",
  tenantId: "tenant-1",
  projectId: "project-1",
  contactId: "contact-1",
  recipient: "client@example.com",
  recipientName: "Client",
  projectName: "Smith Wedding",
  subject: "Your planning follow-up",
  body: "Please confirm the remaining details.",
  category: "planning",
  now: "2026-08-13T12:00:00.000Z",
};

test("approving a complete AI email queues delivery in the same decision", () => {
  const result = approvedCommunicationDispatch(base);
  assert.equal(result.draftStatus, "queued");
  assert.equal(result.emailJob?.status, "queued");
  assert.equal(result.emailJob?.recipient, "client@example.com");
  assert.match(result.consequence, /queued the email/i);
});

test("approval stays safely unsent when recipient evidence is missing", () => {
  const result = approvedCommunicationDispatch({ ...base, recipient: null });
  assert.equal(result.draftStatus, "approved_unsent");
  assert.equal(result.emailJob, null);
  assert.match(result.consequence, /kept it unsent/i);
});
