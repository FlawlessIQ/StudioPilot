import assert from "node:assert/strict";
import test from "node:test";
import {
  conversationIdFor,
  foldMessageIntoConversation,
  markConversationReadByStudio,
  participantKey,
  type Conversation,
  type ConversationDelta,
} from "../features/messaging/conversation";

const base: ConversationDelta = {
  tenantId: "tenant_1",
  projectId: "project_1",
  leadId: null,
  participant: {
    contactId: "contact_1",
    email: "john@example.com",
    phone: null,
    name: "John Smith",
  },
  channel: "email",
  direction: "outbound",
  subject: "Your proposal",
  preview: "Here is the proposal we discussed.",
  occurredAt: "2026-08-25T10:00:00.000Z",
};

test("the same participant on the same project always resolves to one thread", () => {
  const fromEmailWorker = conversationIdFor(base);
  const fromPortal = conversationIdFor({
    tenantId: "tenant_1",
    projectId: "project_1",
    participant: { email: "john@example.com" },
  });
  assert.equal(fromEmailWorker, fromPortal);
});

test("email casing and phone formatting do not split a thread", () => {
  assert.equal(
    participantKey({ email: "John@Example.com " }),
    participantKey({ email: "john@example.com" }),
  );
  assert.equal(
    participantKey({ phone: "+1 (555) 010-9999" }),
    participantKey({ phone: "+15550109999" }),
  );
});

test("the same couple on two projects get two threads", () => {
  assert.notEqual(
    conversationIdFor({ ...base, projectId: "project_1" }),
    conversationIdFor({ ...base, projectId: "project_2" }),
  );
});

test("a lead thread is distinct from the project thread it becomes", () => {
  assert.notEqual(
    conversationIdFor({ ...base, projectId: null, leadId: "lead_1" }),
    conversationIdFor(base),
  );
});

test("a client message leaves the studio one to answer", () => {
  const thread = foldMessageIntoConversation(null, {
    ...base,
    direction: "inbound",
    preview: "Can we move the ceremony to 4pm?",
  });
  assert.equal(thread.studioUnreadCount, 1);
  assert.equal(thread.clientUnreadCount, 0);
  assert.equal(thread.messageCount, 1);
  assert.equal(thread.lastMessageDirection, "inbound");
});

test("replying clears the studio count and leaves one for the client", () => {
  const received = foldMessageIntoConversation(null, {
    ...base,
    direction: "inbound",
    preview: "Can we move the ceremony to 4pm?",
  });
  const replied = foldMessageIntoConversation(received, {
    ...base,
    direction: "outbound",
    preview: "Four works — I have updated the schedule.",
    occurredAt: "2026-08-25T11:00:00.000Z",
  });
  assert.equal(replied.studioUnreadCount, 0);
  assert.equal(replied.clientUnreadCount, 1);
  assert.equal(replied.messageCount, 2);
});

test("two client messages accumulate rather than overwrite", () => {
  const first = foldMessageIntoConversation(null, {
    ...base,
    direction: "inbound",
    occurredAt: "2026-08-25T10:00:00.000Z",
  });
  const second = foldMessageIntoConversation(first, {
    ...base,
    direction: "inbound",
    occurredAt: "2026-08-25T10:05:00.000Z",
  });
  assert.equal(second.studioUnreadCount, 2);
});

test("a retried send landing late cannot rewrite the thread headline", () => {
  const current = foldMessageIntoConversation(null, {
    ...base,
    direction: "inbound",
    preview: "Actually, 5pm suits us better.",
    occurredAt: "2026-08-25T12:00:00.000Z",
  });
  const stale = foldMessageIntoConversation(current, {
    ...base,
    direction: "outbound",
    preview: "Confirming 4pm.",
    occurredAt: "2026-08-25T09:00:00.000Z",
  });
  assert.equal(stale.lastMessagePreview, "Actually, 5pm suits us better.");
  assert.equal(stale.lastMessageAt, "2026-08-25T12:00:00.000Z");
  assert.equal(stale.lastMessageDirection, "inbound");
  // Still counted, and still clears the studio's queue — only the headline is
  // protected from going backwards.
  assert.equal(stale.messageCount, 2);
  assert.equal(stale.studioUnreadCount, 0);
});

test("one thread spans channels instead of forking per channel", () => {
  const emailed = foldMessageIntoConversation(null, base);
  const texted = foldMessageIntoConversation(emailed, {
    ...base,
    channel: "sms",
    direction: "inbound",
    occurredAt: "2026-08-25T13:00:00.000Z",
  });
  assert.deepEqual(texted.channels, ["email", "sms"]);
});

test("later messages fill in participant detail without discarding it", () => {
  const sparse = foldMessageIntoConversation(null, {
    ...base,
    participant: { contactId: null, email: "john@example.com", phone: null, name: null },
  });
  const enriched = foldMessageIntoConversation(sparse, {
    ...base,
    participant: { contactId: "contact_1", email: "john@example.com", phone: "+15550109999", name: "John Smith" },
    occurredAt: "2026-08-25T14:00:00.000Z",
  });
  assert.equal(enriched.participant.name, "John Smith");
  assert.equal(enriched.participant.phone, "+15550109999");

  const laterWithoutName = foldMessageIntoConversation(enriched, {
    ...base,
    participant: { contactId: null, email: "john@example.com", phone: null, name: null },
    occurredAt: "2026-08-25T15:00:00.000Z",
  });
  assert.equal(laterWithoutName.participant.name, "John Smith");
});

test("an archived thread reopens when the client writes, not when the studio does", () => {
  const archived: Conversation = {
    ...foldMessageIntoConversation(null, base),
    status: "archived",
    archivedAt: "2026-08-25T10:30:00.000Z",
  };

  const studioReply = foldMessageIntoConversation(archived, {
    ...base,
    direction: "outbound",
    occurredAt: "2026-08-25T11:00:00.000Z",
  });
  assert.equal(studioReply.status, "archived");

  const clientWrote = foldMessageIntoConversation(archived, {
    ...base,
    direction: "inbound",
    occurredAt: "2026-08-25T12:00:00.000Z",
  });
  assert.equal(clientWrote.status, "open");
  assert.equal(clientWrote.archivedAt, null);
});

test("opening a thread clears only the studio's count", () => {
  const thread = foldMessageIntoConversation(null, {
    ...base,
    direction: "inbound",
  });
  const opened = markConversationReadByStudio({ ...thread, clientUnreadCount: 3 });
  assert.equal(opened.studioUnreadCount, 0);
  assert.equal(opened.clientUnreadCount, 3);
});
