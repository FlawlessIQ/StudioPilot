import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { clientThreadsAwaitingStudio } from "../features/messaging/awaiting-studio";
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
  action: { kind: string; href?: string; label?: string };
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
  assert.deepEqual(card.action, { kind: "link", label: "Reply", href: "/studio/messages?thread=conv_wedding" });
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
  // Wraps its own text, inside .ds-root too, where every .ai-confidence is
  // otherwise one ellipsed line.
  assert.match(note, /white-space: normal;/);
  assert.match(note, /overflow: visible;/);
  assert.match(read("app/legacy-bridge.css"), /\.ds-root \.ai-confidence,[\s\S]*?white-space: nowrap;/);
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
