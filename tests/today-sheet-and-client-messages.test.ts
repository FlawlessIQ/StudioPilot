import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { clientThreadsAwaitingStudio } from "../features/messaging/awaiting-studio";
import { foldMessageIntoConversation, studioReplyAtOf } from "../features/messaging/conversation";
import {
  looksLikeEmail,
  personName,
  threadNamer,
  threadsNeedContactNames,
} from "../features/messaging/thread-name";
import { todayInbox } from "../features/today/inbox";

/**
 * Prod walk 2026-10-12, Jess Styles Bridal (hair), client Priya Shah:
 *  F18 the Review sheet's title squeezed to one word per line by the "Check:"
 *      note in an auto grid track;
 *  F21 "Edit first" drew a dark Message under a white Subject;
 *  F23 Messages titled her wedding thread by her raw email;
 *  F24 her portal message reached Messages and the bell, never Today.
 */

const read = (path: string) => readFileSync(path, "utf8");

const NOW = "2026-10-12T15:00:00.000Z";
const PRIYA = "conor+priya@flawlessiq.com";

const thread = (over: Record<string, unknown> = {}) => ({
  id: "conv_wedding",
  tenantId: "t1",
  projectId: "p1",
  leadId: null,
  participant: { contactId: null, email: PRIYA, phone: null, name: PRIYA },
  channels: ["portal"],
  subject: "Question about the trial",
  lastMessageAt: "2026-10-12T14:00:00.000Z",
  lastMessagePreview: "Can we move the trial to the\nSaturday before?",
  lastMessageDirection: "inbound",
  lastMessageChannel: "portal",
  studioUnreadCount: 1,
  clientUnreadCount: 0,
  messageCount: 3,
  lastInboundAt: "2026-10-12T14:00:00.000Z",
  lastOutboundAt: "2026-10-10T09:00:00.000Z",
  status: "open",
  archivedAt: null,
  ...over,
});

const priyaContact = {
  id: "c1",
  tenantId: "t1",
  displayName: "Priya Shah",
  firstName: "Priya",
  lastName: "Shah",
  email: PRIYA,
  normalizedEmail: PRIYA,
  archivedAt: null,
};

const bookedJob = {
  id: "p1",
  name: "Priya Shah wedding",
  state: "BOOKED",
  eventDate: "2027-06-12",
};

type Card = {
  id: string;
  title: string;
  detail: string;
  evidence: string | null;
  band: string;
  projectId: string | null;
  action: { kind: string; href?: string; label?: string; conversationIds?: string[] };
};
const inboxOf = (input: Record<string, unknown>) =>
  todayInbox({ now: NOW, ...input } as never) as unknown as { act: Card[]; approve: Card[] };
const clientCards = (inbox: { act: Card[] }) =>
  inbox.act.filter((item) => item.id.startsWith("client-message-"));

// ── F24: who owes the next word ──────────────────────────────────────

test("a client who wrote after the studio last replied is waiting on the studio", () => {
  const [waiting] = clientThreadsAwaitingStudio([thread()]);
  assert.ok(waiting);
  assert.equal(waiting.threadId, "conv_wedding");
  assert.equal(waiting.projectId, "p1");
  assert.equal(waiting.waitingSince, "2026-10-12T14:00:00.000Z");
  assert.equal(waiting.preview, "Can we move the trial to the Saturday before?");
  assert.equal(waiting.channel, "portal");
});

test("a studio reply answers the thread; reading it does not", () => {
  assert.deepEqual(
    clientThreadsAwaitingStudio([
      thread({
        lastOutboundAt: "2026-10-12T14:30:00.000Z",
        lastMessageAt: "2026-10-12T14:30:00.000Z",
        lastMessageDirection: "outbound",
        lastMessagePreview: "Saturday works!",
      }),
    ]),
    [],
  );
  assert.equal(clientThreadsAwaitingStudio([thread({ studioUnreadCount: 0 })]).length, 1);
});

test("the automatic acknowledgement is not an answer, and archived threads wait on nobody", () => {
  // countsAsReply: false leaves lastOutboundAt unset.
  assert.equal(clientThreadsAwaitingStudio([thread({ lastOutboundAt: null })]).length, 1);
  assert.equal(clientThreadsAwaitingStudio([thread({ status: "archived" })]).length, 0);
});

test("a thread from before the per-side fields still says who spoke last", () => {
  const legacy = thread({ lastInboundAt: undefined, lastOutboundAt: undefined });
  assert.equal(clientThreadsAwaitingStudio([legacy]).length, 1);
  assert.equal(
    clientThreadsAwaitingStudio([{ ...legacy, lastMessageDirection: "outbound" }]).length,
    0,
  );
});

test("a thread split in two is one waiting row, primary first", () => {
  const rows = clientThreadsAwaitingStudio([
    thread(),
    thread({ id: "conv_split", lastMessageAt: "2026-10-01T10:00:00.000Z", lastInboundAt: "2026-10-01T10:00:00.000Z" }),
  ]);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0]?.memberIds.sort(), ["conv_split", "conv_wedding"]);
});

// ── F23: a thread is named for the person ────────────────────────────

test("an email is never a name", () => {
  assert.equal(looksLikeEmail(PRIYA), true);
  assert.equal(looksLikeEmail(`<${PRIYA}>`), true);
  assert.equal(personName(PRIYA), null);
  assert.equal(personName("  "), null);
  assert.equal(personName("Priya Shah"), "Priya Shah");
});

test("a thread named by its email takes the studio's contact name for that email", () => {
  const name = threadNamer({ contacts: [priyaContact] });
  assert.equal(name({ email: PRIYA, name: PRIYA }), "Priya Shah");
  assert.equal(name({ email: PRIYA.toUpperCase(), name: null }), "Priya Shah");
  // A real name on the thread stays.
  assert.equal(name({ email: PRIYA, name: "Priya S." }), "Priya S.");
  // Nobody known: no name, so the caller falls back to the address.
  assert.equal(name({ email: "stranger@example.com", name: "stranger@example.com" }), null);
});

test("names come by contact id, then live contacts, then archived, then another thread", () => {
  const name = threadNamer({
    contacts: [
      { id: "c-old", displayName: "Priya Old", normalizedEmail: PRIYA, archivedAt: "2026-01-01" },
      { id: "c1", firstName: "Priya", lastName: "Shah", email: PRIYA, archivedAt: null },
    ],
    threads: [{ participant: { email: "mum@example.com", name: "Anita Shah" } }],
  });
  assert.equal(name({ contactId: "c-old", email: null, name: null }), "Priya Old");
  assert.equal(name({ email: PRIYA, name: null }), "Priya Shah");
  assert.equal(name({ email: "mum@example.com", name: "mum@example.com" }), "Anita Shah");
  const archivedOnly = threadNamer({
    contacts: [{ id: "c-old", displayName: "Priya Old", normalizedEmail: PRIYA, archivedAt: "2026-01-01" }],
  });
  assert.equal(archivedOnly({ email: PRIYA, name: null }), "Priya Old");
});

test("contacts are read only when a thread has an email and no name", () => {
  assert.equal(threadsNeedContactNames([{ participant: { email: PRIYA, name: PRIYA } }]), true);
  assert.equal(threadsNeedContactNames([{ participant: { email: PRIYA, name: "Priya Shah" } }]), false);
  assert.equal(threadsNeedContactNames([{ participant: { email: null, name: null } }]), false);
  assert.equal(threadsNeedContactNames(null), false);
});

test("Messages names each thread through the namer, never the raw participant name", () => {
  const source = read("components/communications/message-inbox.tsx");
  assert.match(source, /threadNamer\(\{ threads, contacts: knownContacts\.records \}\)/);
  assert.match(source, /<span className="msg-thread-who">\{whoIs\(thread\)\}<\/span>/);
  assert.match(source, /<h2>\{whoIs\(activeThread\)\}<\/h2>/);
  assert.doesNotMatch(source, /thread\.participant\.name \?\?\s+thread\.participant\.email/);
});

test("a portal message names its sender, never by their email", () => {
  const source = read("app/api/client/portal/route.ts");
  assert.match(source, /personName\(identity\.name\) \?\?\s+\(await clientContactName\(parsed\.tenantId, safeString\(identity\.email\)\)\)/);
  // The thread's participant name is that name or nothing — an email is not
  // written as the name, so the thread keeps the name it already had.
  assert.match(source, /email: safeString\(identity\.email\),\s+phone: null,\s+name: senderName,/);
  const lookup = source.slice(source.indexOf("async function clientContactName"));
  assert.match(lookup, /\.where\("tenantId", "==", tenantId\)/);
  assert.match(lookup, /\.where\("normalizedEmail", "==", email\.trim\(\)\.toLowerCase\(\)\)/);
});

// ── F24: Today ───────────────────────────────────────────────────────

test("Today asks the studio to answer a booked client's message, by name, linked to the thread", () => {
  const inbox = inboxOf({ projects: [bookedJob], conversations: [thread()], contacts: [priyaContact] });
  const [card] = clientCards(inbox);
  assert.ok(card, "a client message card on Today");
  assert.equal(card.id, "client-message-conv_wedding");
  assert.equal(card.title, "Priya Shah sent you a message");
  assert.equal(card.detail, "Can we move the trial to the Saturday before?");
  assert.equal(card.evidence, "Sent from their portal");
  assert.equal(card.projectId, "p1");
  assert.deepEqual(card.action, {
    kind: "client_message",
    label: "Reply",
    href: "/studio/messages?thread=conv_wedding",
    conversationIds: ["conv_wedding"],
  });
  // Urgent because it is unanswered, not because the wedding is close.
  assert.equal(card.band, "soon");
  const days = inboxOf({
    now: "2026-10-15T15:00:00.000Z",
    projects: [bookedJob],
    conversations: [thread()],
    contacts: [priyaContact],
  });
  assert.equal(clientCards(days)[0]?.band, "overdue");
});

test("without the contact the card names the sender by address, and a long message is cut", () => {
  const long = "a".repeat(200);
  const [card] = clientCards(
    inboxOf({ projects: [bookedJob], conversations: [thread({ lastMessagePreview: long })] }),
  );
  assert.equal(card?.title, `${PRIYA} sent you a message`);
  assert.equal(card?.detail.length, 140);
  assert.ok(card?.detail.endsWith("…"));
});

test("the card leaves Today once the studio replies", () => {
  const replied = thread({
    lastOutboundAt: "2026-10-12T14:30:00.000Z",
    lastMessageAt: "2026-10-12T14:30:00.000Z",
    lastMessageDirection: "outbound",
  });
  assert.equal(clientCards(inboxOf({ projects: [bookedJob], conversations: [replied] })).length, 0);
});

test("an inquiry is answered on its own card, never a second one here", () => {
  const leadJob = { id: "p1", name: "Priya Shah wedding", state: "LEAD", eventDate: "2027-06-12" };
  const lead = {
    id: "l1",
    status: "converted",
    projectId: "p1",
    displayName: "Priya Shah",
    email: PRIYA,
    eventDate: "2027-06-12",
    createdAt: "2026-10-12T14:00:00.000Z",
  };
  const inbox = inboxOf({
    projects: [leadJob],
    leads: [lead],
    conversations: [thread({ leadId: "l1", lastOutboundAt: null })],
  });
  assert.equal(clientCards(inbox).length, 0);
  assert.ok(inbox.act.some((item) => item.id === "lead-l1"), "the inquiry card answers them");
  // A lead the studio isn't sure is an inquiry is asked about beside the
  // queue: its job's thread is not a client card either.
  const unsure = inboxOf({
    projects: [leadJob],
    leads: [{ ...lead, status: "new", needsConfirmation: true }],
    conversations: [thread({ leadId: "l1", lastOutboundAt: null })],
  });
  assert.equal(clientCards(unsure).length, 0);
});

test("a thread with no job, or on a lost or archived job, is not a client card", () => {
  assert.equal(clientCards(inboxOf({ projects: [bookedJob], conversations: [thread({ projectId: null, leadId: "l9" })] })).length, 0);
  assert.equal(clientCards(inboxOf({ projects: [{ ...bookedJob, state: "LOST" }], conversations: [thread()] })).length, 0);
  assert.equal(clientCards(inboxOf({ projects: [{ ...bookedJob, archivedAt: "2026-10-01" }], conversations: [thread()] })).length, 0);
  assert.equal(clientCards(inboxOf({ projects: [], conversations: [thread()] })).length, 0);
});

test("a reply Cue drafted for the thread is the one card about it", () => {
  const draft = {
    id: "ai1",
    tenantId: "t1",
    projectId: "p1",
    conversationId: "conv_wedding",
    status: "review_required",
    capability: "client_message_reply",
    title: "Reply to Priya",
    structuredOutput: { kind: "message_draft", subject: "Re: trial", body: "Saturday works." },
    createdAt: "2026-10-12T14:05:00.000Z",
    updatedAt: "2026-10-12T14:05:00.000Z",
  };
  const inbox = inboxOf({ projects: [bookedJob], conversations: [thread()], aiActions: [draft] });
  assert.ok(inbox.approve.some((item) => item.id === "ai-ai1"), "the drafted reply is on Today");
  assert.equal(clientCards(inbox).length, 0);
  // Snoozing the draft puts the conversation off until then — the client's
  // card does not stand in for the draft the studio just put away.
  const snoozed = inboxOf({
    projects: [bookedJob],
    conversations: [thread()],
    aiActions: [{ ...draft, snoozedUntil: "2026-10-13T15:00:00.000Z" }],
  });
  assert.equal(snoozed.approve.some((item) => item.id === "ai-ai1"), false, "the draft is snoozed");
  assert.equal(clientCards(snoozed).length, 0, "and so is the conversation");
  // Once the snooze has passed, the draft is back, and still the one card.
  const woke = inboxOf({
    now: "2026-10-13T16:00:00.000Z",
    projects: [bookedJob],
    conversations: [thread()],
    aiActions: [{ ...draft, snoozedUntil: "2026-10-13T15:00:00.000Z" }],
  });
  assert.ok(woke.approve.some((item) => item.id === "ai-ai1"));
  assert.equal(clientCards(woke).length, 0);
  // A draft that was put away (declined) no longer covers for the thread.
  const declined = inboxOf({
    projects: [bookedJob],
    conversations: [thread()],
    aiActions: [{ ...draft, status: "rejected" }],
  });
  assert.equal(clientCards(declined).length, 1);
});

// ── Review round 2: which threads raise a card, and how it leaves ─────

const closedJob = { id: "p1", name: "Priya Shah wedding", state: "CLOSED", eventDate: "2026-05-02" };
// The probe from the review: she thanked the studio in June, the studio read
// it, and the wedding has since closed.
const thanked = thread({
  lastMessageAt: "2026-06-20T10:00:00.000Z",
  lastInboundAt: "2026-06-20T10:00:00.000Z",
  lastOutboundAt: "2026-06-18T10:00:00.000Z",
  lastMessagePreview: "Thank you so much for the beautiful photos!",
  studioUnreadCount: 0,
});

test("an old thank-you on a closed or cancelled job is not today's work", () => {
  assert.equal(clientCards(inboxOf({ projects: [closedJob], conversations: [thanked] })).length, 0);
  assert.equal(
    clientCards(inboxOf({ projects: [{ ...closedJob, state: "CANCELLED" }], conversations: [thanked] })).length,
    0,
  );
  // Never opened, but the job is over: still not.
  assert.equal(
    clientCards(inboxOf({ projects: [closedJob], conversations: [{ ...thanked, studioUnreadCount: 1 }] })).length,
    0,
  );
});

test("an old message the studio has read, on a job still going, is not today's work either", () => {
  assert.equal(clientCards(inboxOf({ projects: [bookedJob], conversations: [thanked] })).length, 0);
  // Never opened is different: nobody at the studio has seen it.
  const [unseen] = clientCards(
    inboxOf({ projects: [bookedJob], conversations: [{ ...thanked, studioUnreadCount: 1 }] }),
  );
  assert.ok(unseen, "an unopened message on a live job stays until it is answered");
  assert.equal(unseen.band, "overdue");
});

test("a recent message gets its card whatever the job's state, for two weeks", () => {
  const recent = thread({ studioUnreadCount: 0 });
  assert.equal(clientCards(inboxOf({ projects: [closedJob], conversations: [recent] })).length, 1);
  assert.equal(
    clientCards(inboxOf({ projects: [{ ...closedJob, state: "CANCELLED" }], conversations: [recent] })).length,
    1,
  );
  // Read, fourteen days on: still news. Fifteen: not.
  assert.equal(
    clientCards(inboxOf({ now: "2026-10-26T13:00:00.000Z", projects: [bookedJob], conversations: [recent] })).length,
    1,
  );
  assert.equal(
    clientCards(inboxOf({ now: "2026-10-27T15:00:00.000Z", projects: [bookedJob], conversations: [recent] })).length,
    0,
  );
});

test("No reply needed answers the thread, until the client writes again", () => {
  const handled = thread({ noReplyNeededAt: "2026-10-12T14:30:00.000Z" });
  assert.equal(clientThreadsAwaitingStudio([handled]).length, 0);
  assert.equal(clientCards(inboxOf({ projects: [bookedJob], conversations: [handled] })).length, 0);
  const again = {
    ...handled,
    lastMessageAt: "2026-10-12T14:45:00.000Z",
    lastInboundAt: "2026-10-12T14:45:00.000Z",
    lastMessagePreview: "One more thing!",
  };
  assert.equal(clientThreadsAwaitingStudio([again]).length, 1);
  // A thread split in two: the mark on either member answers the row.
  const rows = clientThreadsAwaitingStudio([
    thread(),
    thread({
      id: "conv_split",
      lastMessageAt: "2026-10-01T10:00:00.000Z",
      lastInboundAt: "2026-10-01T10:00:00.000Z",
      noReplyNeededAt: "2026-10-12T14:30:00.000Z",
    }),
  ]);
  assert.equal(rows.length, 0);
});

test("Replied by email on the inquiry answers its thread on the job", () => {
  const consultationJob = { ...bookedJob, state: "CONSULTATION" };
  const inquiryThread = thread({ leadId: "l1", lastOutboundAt: null });
  const lead = {
    id: "l1",
    status: "converted",
    projectId: "p1",
    displayName: "Priya Shah",
    email: PRIYA,
    createdAt: "2026-10-12T14:00:00.000Z",
  };
  assert.equal(
    clientCards(inboxOf({ projects: [consultationJob], leads: [lead], conversations: [inquiryThread] })).length,
    1,
    "nothing says the studio answered",
  );
  const replied = { ...lead, repliedOutsideAt: "2026-10-12T14:20:00.000Z" };
  assert.equal(
    clientCards(inboxOf({ projects: [consultationJob], leads: [replied], conversations: [inquiryThread] })).length,
    0,
  );
  // On the job's own thread too, as next-move reads it.
  assert.equal(
    clientThreadsAwaitingStudio([thread({ lastOutboundAt: null })], { leads: [replied] }).length,
    0,
  );
  // A later message from them is still theirs to be answered.
  assert.equal(
    clientThreadsAwaitingStudio([thread({ lastOutboundAt: null })], {
      leads: [{ ...replied, repliedOutsideAt: "2026-10-12T13:00:00.000Z" }],
    }).length,
    1,
  );
});

test("a reminder on a timer does not answer a client's question; the studio writing does", async () => {
  const server = await import("../functions/src/communications/conversation.ts");
  for (const fold of [foldMessageIntoConversation, server.foldMessageIntoConversation]) {
    const base = {
      tenantId: "t1",
      projectId: "p1",
      leadId: null,
      participant: { contactId: "c1", email: PRIYA, phone: null, name: "Priya Shah" },
      channel: "email" as const,
      subject: "Trial",
    };
    const replied = fold(null, {
      ...base,
      direction: "outbound" as const,
      preview: "Here are the trial times",
      occurredAt: "2026-10-12T09:00:00.000Z",
      studioReply: true,
    });
    assert.equal(replied.lastStudioReplyAt, "2026-10-12T09:00:00.000Z");
    const asked = fold(replied as never, {
      ...base,
      channel: "portal" as const,
      direction: "inbound" as const,
      preview: "Can we move the trial?",
      occurredAt: "2026-10-12T14:00:00.000Z",
    });
    const reminded = fold(asked as never, {
      ...base,
      direction: "outbound" as const,
      preview: "Your questionnaire is due in 3 days",
      occurredAt: "2026-10-12T14:30:00.000Z",
    });
    assert.equal(reminded.lastOutboundAt, "2026-10-12T14:30:00.000Z", "it is still an outbound message");
    assert.equal(reminded.lastStudioReplyAt, "2026-10-12T09:00:00.000Z", "but not the studio answering");
    const [waiting] = clientThreadsAwaitingStudio([reminded as never]);
    assert.equal(waiting?.waitingSince, "2026-10-12T14:00:00.000Z");
    const answered = fold(reminded as never, {
      ...base,
      direction: "outbound" as const,
      preview: "Saturday works!",
      occurredAt: "2026-10-12T15:00:00.000Z",
      studioReply: true,
    });
    assert.equal(clientThreadsAwaitingStudio([answered as never]).length, 0);
    // The acknowledgement is never the studio speaking, whatever it says.
    const acked = fold(asked as never, {
      ...base,
      direction: "outbound" as const,
      preview: "Thanks, we got it",
      occurredAt: "2026-10-12T14:00:05.000Z",
      countsAsReply: false,
      studioReply: true,
    });
    assert.equal(acked.lastStudioReplyAt, "2026-10-12T09:00:00.000Z");
  }
});

test("a thread from before lastStudioReplyAt keeps the answer it had", async () => {
  const server = await import("../functions/src/communications/conversation.ts");
  // Read as before: every outbound counted.
  const legacy = thread({ lastOutboundAt: "2026-10-12T14:30:00.000Z" });
  assert.equal("lastStudioReplyAt" in legacy, false);
  assert.equal(clientThreadsAwaitingStudio([legacy]).length, 0);
  for (const fold of [foldMessageIntoConversation, server.foldMessageIntoConversation]) {
    // The first send after the field exists starts it from the thread's
    // lastOutboundAt as it was, not from nothing.
    const next = fold(thread() as never, {
      tenantId: "t1",
      projectId: "p1",
      leadId: null,
      participant: { contactId: null, email: PRIYA, phone: null, name: null },
      channel: "email",
      direction: "outbound",
      subject: null,
      preview: "Your questionnaire is due",
      occurredAt: "2026-10-12T14:30:00.000Z",
    });
    assert.equal(next.lastStudioReplyAt, "2026-10-10T09:00:00.000Z");
    assert.equal(clientThreadsAwaitingStudio([next as never]).length, 1, "and the reminder does not answer her");
  }
  assert.equal(studioReplyAtOf({ lastOutboundAt: "a" }), "a");
  assert.equal(studioReplyAtOf({ lastStudioReplyAt: null, lastOutboundAt: "a" }), null);
});

test("the email worker counts only a person at the studio as answering", async () => {
  const { studioWroteIt } = await import("../functions/src/communications/studio-reply.ts");
  const job = (fields: Record<string, unknown>) => ({ get: (field: string) => fields[field] });
  // The studio's own words.
  assert.equal(studioWroteIt(job({ type: "manual_message", requestedBy: "uid_owner" })), true, "a reply in Messages");
  assert.equal(studioWroteIt(job({ type: "manual_message", communicationDraftId: "ai_reply_a1" })), true, "a Cue draft approved");
  assert.equal(studioWroteIt(job({ type: "manual_message", communicationDraftId: "draft_1" })), true, "a draft the owner approved");
  assert.equal(studioWroteIt(job({ type: "manual_message", studioReply: true })), true, "approved from the notification email");
  // Sent on a timer, or by the system.
  assert.equal(studioWroteIt(job({ type: "manual_message", aiActionId: "lifecycle_1" })), false, "a lifecycle auto-send");
  assert.equal(studioWroteIt(job({ type: "manual_message", requestedBy: "automation-engine" })), false, "a workflow step");
  assert.equal(studioWroteIt(job({ type: "manual_message", requestedBy: "" })), false);
  for (const type of ["questionnaire_reminder", "final_payment_reminder", "event_reminder", "consultation_reminder", "review_request", "inquiry_acknowledgement"]) {
    assert.equal(studioWroteIt(job({ type, requestedBy: "uid_owner" })), false, type);
  }
  const worker = read("functions/src/operations/jobs.ts");
  assert.match(worker, /countsAsReply: document\.get\("type"\) !== "inquiry_acknowledgement",\s+\/\/ [^\n]+\n\s+studioReply: studioWroteIt\(document\),/);
  assert.match(read("app/api/reply-approval/route.ts"), /studioReply: true,/);
  // A lead's thread moving onto the job keeps both the studio's last word and its "No reply needed".
  const move = read("functions/src/intake/lead-thread.ts");
  assert.match(move, /lastStudioReplyAt: laterOf\(other \? studioReplyAtOf\(other\) : null, studioReplyAtOf\(current\)\)/);
  assert.match(move, /noReplyNeededAt: laterOf\(other\?\.noReplyNeededAt, current\.noReplyNeededAt\)/);
});

test("No reply needed is a server command and a button on the card", () => {
  const commands = read("functions/src/communications/commands.ts");
  assert.match(commands, /type: z\.literal\("markNoReplyNeeded"\)/);
  const handler = commands.slice(commands.indexOf('command.type === "markNoReplyNeeded"'));
  assert.match(handler, /if \(snapshot\.get\("tenantId"\) !== command\.tenantId\) \{\s+throw new Error\("FORBIDDEN"\);/);
  assert.match(handler, /noReplyNeededAt: now,/);
  const ui = read("components/today/today-inbox.tsx");
  assert.match(ui, /type: "markNoReplyNeeded",[\s\S]{0,200}input: \{ conversationIds: action\.conversationIds \}/);
  assert.match(ui, /"No reply needed"/);
  // On the card and on the headline, which is lifted out of the list.
  assert.match(ui, /item\.action\.kind === "client_message" \? \(\s+<ClientMessageActions/);
  assert.match(ui, /lead\?\.action\.kind === "client_message" \? \(/);
  // Two controls: from 720px the card's actions are an auto column beside the
  // title, and a third squeezed it to a word per line in a 480px lane.
  const actions = ui.slice(ui.indexOf("function ClientMessageActions"), ui.indexOf("type PackageRequestAction"));
  assert.doesNotMatch(actions, /Open the job/);
});

test("Messages opens the thread Today linked to", () => {
  const page = read("app/studio/messages/page.tsx");
  assert.match(page, /<MessageInbox initialProjectId=\{project\} initialThreadId=\{thread\} \/>/);
  const inbox = read("components/communications/message-inbox.tsx");
  assert.match(inbox, /grouped\.find\(\(thread\) => thread\.memberIds\.includes\(initialThreadId\)\)/);
  assert.match(inbox, /appliedThreadRef\.current = initialThreadId/);
});

// ── F18 / F21: the Review sheet ──────────────────────────────────────

const ruleBody = (css: string, selector: string) => {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start >= 0, `${selector} is styled`);
  return css.slice(start, css.indexOf("}", start));
};

test("the review card's header wraps the Check note under the title, never squeezing it", () => {
  const css = read("app/studiocue-reimagined.css");
  const header = ruleBody(css, ".ai-queue-card > header");
  assert.match(header, /display: flex;/);
  assert.match(header, /flex-wrap: wrap;/);
  assert.doesNotMatch(header, /grid-template-columns/);
  // Nowhere, at any width, is the header a grid with an auto track again.
  assert.doesNotMatch(css, /\.ai-queue-card > header \{\s+grid-template-columns/);
  const title = ruleBody(css, ".ai-queue-card > header > span:nth-child(2)");
  assert.match(title, /flex: 1 1 12rem;/);
  assert.match(title, /min-width: 0;/);
  const note = ruleBody(css, ".ai-queue-card > header > .ai-confidence");
  assert.match(note, /max-width: 100%;/);
  assert.match(note, /min-width: 0;/);
  // Wraps its own text, all of it.
  assert.match(note, /white-space: normal;/);
  assert.match(note, /overflow: visible;/);
  // And no stylesheet turns a chip's note back into one clipped line: the
  // first version of this test "found" such a rule in legacy-bridge.css by
  // matching 440 lines past it (review, 2026-10-12). Rule by rule instead.
  const chipRules: string[] = [];
  for (const file of ["app/legacy-bridge.css", "app/studiocue-reimagined.css", "app/globals.css", "app/design-system.css"]) {
    const source = read(file).replace(/\/\*[\s\S]*?\*\//g, "");
    for (const [, selectors, body] of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const chip = selectors.split(",").some((selector) => /\.ai-confidence\b/.test(selector) && !/prepared-compact/.test(selector));
      if (!chip) continue;
      chipRules.push(`${file}: ${selectors.trim().split(",")[0]}`);
      assert.doesNotMatch(body, /white-space:\s*nowrap|text-overflow:\s*ellipsis/, `${file}: ${selectors.trim()}`);
    }
  }
  // It read the rules it means to: the base chip, the header note, the
  // sheet's, and .ds-root's.
  assert.ok(chipRules.some((rule) => rule.startsWith("app/legacy-bridge.css: .ds-root .ai-confidence")), chipRules.join("\n"));
  assert.ok(chipRules.some((rule) => rule.startsWith("app/studiocue-reimagined.css: .ai-queue-card > header > .ai-confidence")));
  assert.ok(chipRules.length >= 4, chipRules.join("\n"));
});

test("Edit first's message is on the same paper as its subject", () => {
  const css = read("app/globals.css");
  // Two classes, so it outranks .ai-queue-editor textarea's dark editor in
  // any stylesheet order; no .ds-root, because the sheet renders outside it.
  assert.match(
    css,
    /\.ai-message-editor input,\.ai-queue-editor\.ai-message-editor textarea\{background:var\(--surface,#fff\);[^}]*color:var\(--ink,#171a18\);/,
  );
  assert.match(read("app/studiocue-reimagined.css"), /\.ai-queue-editor textarea,\s+\.automation-queue-card pre \{\s+background: #27202c;/);
  // On a phone both fields keep the 16px that stops iOS zooming on focus.
  assert.match(css, /@media \(max-width:860px\)\{\.ai-queue-editor\.ai-message-editor textarea\{font-size:16px\}\}/);
  const card = read("components/ai/ai-approval-queue.tsx");
  assert.match(card, /<div className="ai-queue-editor ai-message-editor">/);
});

test("in a sheet, outside .ds-root, the review card's small text is legible", () => {
  const css = read("app/globals.css");
  const start = css.indexOf(".sheet-dialog .ai-queue-card > header small,");
  assert.ok(start >= 0);
  const block = css.slice(start, css.indexOf("}", start));
  for (const selector of [
    ".sheet-dialog .ai-queue-card > header > .ai-confidence",
    ".sheet-dialog .ai-queue-card > header em",
    ".sheet-dialog .ai-queue-card > footer button",
  ]) {
    assert.ok(block.includes(selector), selector);
  }
  assert.match(block, /font-size: 11\.5px;/);
  assert.doesNotMatch(block, /\.ds-root|white-space: nowrap/);
});

test("a booked job's inquiry is answered by the booking, not left waiting on Today", () => {
  // UAT 2026-10-13: "Stacey Spags sent you a message · Waiting on your reply" —
  // her only message was the inquiry, and the job had been proposed, signed and booked.
  const lead = { id: "lead1", tenantId: "t1", projectId: "p1", createdAt: "2026-10-12T14:00:00.000Z" };
  assert.equal(clientCards(inboxOf({ projects: [bookedJob], conversations: [thread()], leads: [lead], contacts: [priyaContact] })).length, 0);
  // Something they wrote after the inquiry still waits for the studio.
  const later = thread({ lastInboundAt: "2026-10-12T16:00:00.000Z", lastMessageAt: "2026-10-12T16:00:00.000Z" });
  assert.equal(clientCards(inboxOf({ projects: [bookedJob], conversations: [later], leads: [lead], contacts: [priyaContact] })).length, 1);
});
