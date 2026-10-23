import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  MAX_MOVES_FOLLOWED,
  callBookedBy,
  linkChangedSinceRead,
  linkIsOpen,
  movedTo,
  previewSchedulingLink,
  schedulingLinkPreview,
  schedulingLinkState,
  type SchedulingLinkReads,
} from "../functions/src/booking/scheduling-link-view";
import { bookedWhen } from "../components/booking/public-consultation-scheduler";

/**
 * A client who booked and opened their scheduling link again was told "This
 * scheduling link has expired", under "Your studio": Priya Shah's hair
 * trial with Jess Styles Bridal, booked for Wed, Oct 14 at 10:00 AM, re-opened
 * on production on 2026-10-11. A photographer's consultation link did the
 * same. A booked link now answers with its booking. Everything else that read
 * "expired" still does, and a booked link still can't book again.
 */

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
// Newer ICU puts a narrow no-break space before AM/PM.
const plain = (value: string) => value.replace(/[  ]/g, " ");

const NOW = Date.parse("2026-10-11T15:00:00.000Z");

const jess = { brandName: "Jess Styles Bridal", trade: "hair", timezone: "America/New_York" };
const priya = { id: "job-priya", tenantId: "t-jess", name: "Priya Shah", eventDate: "2027-05-22", state: "BOOKED" };
const trialLink = {
  id: "trial_abc",
  tenantId: "t-jess",
  projectId: "job-priya",
  contactId: "c-priya",
  mode: "in_person",
  purpose: "trial",
  tokenHash: "hash",
  status: "booked",
  // A trial's link stays open to the day before the event.
  expiresAt: "2027-05-21T04:00:00.000Z",
  bookedConsultationId: "consultation_trial1",
  bookedAt: "2026-10-10T18:00:00.000Z",
};
const trial = {
  id: "consultation_trial1",
  tenantId: "t-jess",
  projectId: "job-priya",
  contactId: "c-priya",
  purpose: "trial",
  status: "scheduled",
  startsAt: "2026-10-14T14:00:00.000Z",
  endsAt: "2026-10-14T16:00:00.000Z",
  timezone: "America/New_York",
  archivedAt: null,
};

const stateOf = (overrides: { link?: Record<string, unknown> | null; call?: Record<string, unknown> | null; project?: Record<string, unknown> | null; nowMs?: number } = {}) =>
  schedulingLinkState({
    link: overrides.link === undefined ? trialLink : overrides.link,
    call: overrides.call === undefined ? trial : overrides.call,
    project: overrides.project === undefined ? priya : overrides.project,
    nowMs: overrides.nowMs ?? NOW,
  });

const loader = (records: Record<string, Record<string, unknown>>) => async (id: string) => records[id] ?? null;

/**
 * The page's first answer, read from these records alone, counting every
 * read: what the server sends, with Firestore swapped for a table.
 */
const previewFrom = (records: {
  link: Record<string, unknown> | null;
  tenants?: Record<string, Record<string, unknown>>;
  projects?: Record<string, Record<string, unknown>>;
  consultations?: Record<string, Record<string, unknown>>;
}) => {
  const reads: string[] = [];
  const read: SchedulingLinkReads = {
    link: async () => {
      reads.push("link");
      return records.link;
    },
    tenant: async (id) => {
      reads.push(`tenants/${id}`);
      return records.tenants?.[id] ?? null;
    },
    project: async (id) => {
      reads.push(`projects/${id}`);
      return records.projects?.[id] ?? null;
    },
    consultation: async (id) => {
      reads.push(`consultations/${id}`);
      return records.consultations?.[id] ?? null;
    },
  };
  return { reads, answer: (nowMs = NOW) => previewSchedulingLink(read, nowMs) };
};
const jessRecords = {
  tenants: { "t-jess": jess },
  projects: { "job-priya": priya },
  consultations: { consultation_trial1: trial },
};

test("a booked link with its call still on shows the booking: the studio, the call by name and the time", async () => {
  const call = await callBookedBy(trialLink, loader({ consultation_trial1: trial }));
  assert.deepEqual(call, trial);
  assert.equal(stateOf({ call }), "booked");

  const preview = schedulingLinkPreview({ link: trialLink, tenant: jess, project: priya, booked: call });
  assert.equal(preview.studioName, "Jess Styles Bridal", "not \"Your studio\"");
  assert.equal(preview.callName, "Hair trial");
  assert.equal(preview.purpose, "trial");
  assert.equal(preview.status, "booked");
  assert.deepEqual(preview.booked, { startsAt: "2026-10-14T14:00:00.000Z", timezone: "America/New_York" });
  // The page says it the way it says it right after booking, on the studio's clock.
  const booked = preview.booked as { startsAt: string; timezone: string };
  assert.equal(plain(bookedWhen(booked.startsAt, booked.timezone)), "Wednesday, October 14 at 10:00 AM");
  // Nothing about the call beyond when: no join link, no location, no notes.
  assert.deepEqual(Object.keys(booked).sort(), ["startsAt", "timezone"]);

  // Already under way still counts; a booked link past its own expiry still
  // answers by its call (the expiry is when it stops taking bookings).
  assert.equal(stateOf({ nowMs: Date.parse("2026-10-14T15:00:00.000Z") }), "booked");
  assert.equal(stateOf({ link: { ...trialLink, expiresAt: "2026-10-12T00:00:00.000Z" }, nowMs: Date.parse("2026-10-13T00:00:00.000Z") }), "booked");
});

test("a photographer's booked consultation link gets the same fix, in its own words", () => {
  const studio = { brandName: "FlawlessIQ", trade: "photographer", timezone: "America/Chicago" };
  const link = { ...trialLink, tenantId: "t-fiq", projectId: "job-smith", purpose: "consultation", mode: "zoom", expiresAt: "2026-10-20T00:00:00.000Z" };
  const call = { ...trial, tenantId: "t-fiq", projectId: "job-smith", purpose: undefined, startsAt: "2026-10-15T17:00:00.000Z", endsAt: "2026-10-15T17:45:00.000Z" };
  const project = { name: "Smith Wedding", state: "CONSULTATION", eventDate: "2027-06-12" };
  assert.equal(schedulingLinkState({ link, call, project, nowMs: NOW }), "booked");
  const preview = schedulingLinkPreview({ link, tenant: studio, project, booked: call });
  assert.equal(preview.studioName, "FlawlessIQ");
  assert.equal(preview.callName, "Consultation");
  assert.deepEqual(preview.booked, { startsAt: "2026-10-15T17:00:00.000Z", timezone: "America/Chicago" });
  assert.equal(plain(bookedWhen("2026-10-15T17:00:00.000Z", "America/Chicago")), "Thursday, October 15 at 12:00 PM");
  // The final details call keeps its name too.
  assert.equal(
    schedulingLinkPreview({ link: { ...link, purpose: "final_details" }, tenant: studio, project, booked: call }).callName,
    "Final details call",
  );
});

test("an open link's page is what it was, now saying it is pending", () => {
  const link = { ...trialLink, status: "pending", bookedConsultationId: null };
  assert.equal(linkIsOpen(link, NOW), true);
  assert.equal(stateOf({ link, call: null }), "open");
  const preview = schedulingLinkPreview({ link, tenant: jess, project: priya });
  assert.deepEqual(Object.keys(preview).sort(), [
    "brandAccentColor",
    "brandLogoUrl",
    "callName",
    "eventDate",
    "expiresAt",
    "mode",
    "projectName",
    "purpose",
    "status",
    "studioName",
    "trade",
  ]);
  assert.equal(preview.status, "pending");
  assert.equal(preview.booked, undefined);
  assert.equal(preview.trade, "hair");
  assert.equal(preview.projectName, "Priya Shah");
  // A studio with no name yet is named by what it does, as before.
  assert.equal(schedulingLinkPreview({ link, tenant: { trade: "photographer" }, project: priya }).studioName, "Your photography studio");
  assert.equal(schedulingLinkPreview({ link, tenant: { trade: "hair" }, project: priya }).studioName, "Your studio");
});

test("a booked link whose call was cancelled, held or put away reads expired, as before", () => {
  assert.equal(stateOf({ call: { ...trial, status: "cancelled", cancelledAt: "2026-10-12T00:00:00.000Z" } }), "expired");
  assert.equal(stateOf({ call: { ...trial, status: "completed" } }), "expired");
  assert.equal(stateOf({ call: { ...trial, status: "no_show" } }), "expired");
  assert.equal(stateOf({ call: { ...trial, archivedAt: "2026-10-12T00:00:00.000Z" } }), "expired");
  // Over: nothing to be booked in for.
  assert.equal(stateOf({ nowMs: Date.parse("2026-10-14T16:00:01.000Z") }), "expired");
  // Gone, or not this link's studio or job.
  assert.equal(stateOf({ call: null }), "expired");
  assert.equal(stateOf({ call: { ...trial, tenantId: "t-other" } }), "expired");
  assert.equal(stateOf({ call: { ...trial, projectId: "job-other" } }), "expired");
  assert.equal(stateOf({ link: { ...trialLink, bookedConsultationId: null } }), "expired");
  // The studio called the job off or put it away.
  for (const state of ["CANCELLED", "LOST", "ARCHIVED"]) assert.equal(stateOf({ project: { ...priya, state } }), "expired", state);
  assert.equal(stateOf({ project: { ...priya, archivedAt: "2026-10-12T00:00:00.000Z" } }), "expired");
  assert.equal(stateOf({ project: null }), "expired");
});

test("a call the studio moved shows its new time; one the client moved is followed to where it went", async () => {
  // rescheduleConsultation moves the call in place, keeping its id.
  const movedByStudio = { ...trial, startsAt: "2026-10-16T18:00:00.000Z", endsAt: "2026-10-16T20:00:00.000Z" };
  const call = await callBookedBy(trialLink, loader({ consultation_trial1: movedByStudio }));
  assert.equal(stateOf({ call }), "booked");
  const preview = schedulingLinkPreview({ link: trialLink, tenant: jess, project: priya, booked: call });
  assert.deepEqual(preview.booked, { startsAt: "2026-10-16T18:00:00.000Z", timezone: "America/New_York" });

  // The inquiry page moves a sales call by making a new one.
  const consultLink = { ...trialLink, purpose: "consultation", bookedConsultationId: "consultation_a" };
  const records = {
    consultation_a: { ...trial, id: "consultation_a", purpose: undefined, status: "rescheduled", supersededBy: "consultation_b" },
    consultation_b: { ...trial, id: "consultation_b", purpose: undefined, startsAt: "2026-10-20T15:00:00.000Z", endsAt: "2026-10-20T15:45:00.000Z" },
  };
  assert.equal(movedTo(records.consultation_a), "consultation_b");
  assert.equal(movedTo(records.consultation_b), null);
  const followed = await callBookedBy(consultLink, loader(records));
  assert.equal(followed?.id, "consultation_b");
  assert.equal(schedulingLinkState({ link: consultLink, call: followed, project: priya, nowMs: NOW }), "booked");

  // A move that was then cancelled is cancelled.
  const cancelled = await callBookedBy(consultLink, loader({ ...records, consultation_b: { ...records.consultation_b, status: "cancelled" } }));
  assert.equal(schedulingLinkState({ link: consultLink, call: cancelled, project: priya, nowMs: NOW }), "expired");
  // Never into another studio's or job's records, and never round and round.
  assert.equal(await callBookedBy(consultLink, loader({ ...records, consultation_b: { ...records.consultation_b, tenantId: "t-other" } })), null);
  const loop = {
    consultation_a: { ...records.consultation_a, supersededBy: "consultation_b" },
    consultation_b: { ...records.consultation_a, id: "consultation_b", supersededBy: "consultation_a" },
  };
  assert.equal(await callBookedBy(consultLink, loader(loop)), null);
  assert.ok(MAX_MOVES_FOLLOWED >= 1);
  assert.equal(await callBookedBy({ ...consultLink, bookedConsultationId: "../tenants/t-jess" }, loader(records)), null);
  assert.equal(await callBookedBy({ ...consultLink, bookedConsultationId: null }, loader(records)), null);
});

test("a link never booked and past its expiry reads expired, as before", () => {
  const link = { ...trialLink, status: "pending", bookedConsultationId: null, expiresAt: "2026-10-01T00:00:00.000Z" };
  assert.equal(linkIsOpen(link, NOW), false);
  assert.equal(stateOf({ link, call: null }), "expired");
  // Exactly at its expiry: closed, as activeLink always had it.
  assert.equal(linkIsOpen({ ...link, expiresAt: new Date(NOW).toISOString() }, NOW), false);
  // A state nothing writes is not a booking.
  assert.equal(stateOf({ link: { ...trialLink, status: "withdrawn" } }), "expired");
});

test("the page's first answer, as the server gives it: a booked link answers with its booking", async () => {
  // Booked, call still on: the booked time and the studio, through the call
  // the link names. Losing either the call lookup or the booked field sends
  // the page back to "expired", so both are read here, not just pinned.
  const booked = previewFrom({ link: trialLink, ...jessRecords });
  const answer = await booked.answer();
  assert.equal(answer.status, "booked");
  assert.equal(answer.studioName, "Jess Styles Bridal");
  assert.equal(answer.callName, "Hair trial");
  assert.deepEqual(answer.booked, { startsAt: "2026-10-14T14:00:00.000Z", timezone: "America/New_York" });
  assert.deepEqual(booked.reads.sort(), ["consultations/consultation_trial1", "link", "projects/job-priya", "tenants/t-jess"]);

  // An open link: its page, and no call is looked for.
  const open = previewFrom({ link: { ...trialLink, status: "pending", bookedConsultationId: null }, ...jessRecords });
  const openAnswer = await open.answer();
  assert.equal(openAnswer.status, "pending");
  assert.equal(openAnswer.booked, undefined);
  assert.ok(!open.reads.some((path) => path.startsWith("consultations/")));

  // Cancelled, over, never booked and past its expiry, or a studio or job
  // that is gone: the same refusal as before.
  const refusals = [
    previewFrom({ link: trialLink, ...jessRecords, consultations: { consultation_trial1: { ...trial, status: "cancelled" } } }).answer(),
    previewFrom({ link: trialLink, ...jessRecords }).answer(Date.parse("2026-10-14T16:00:01.000Z")),
    previewFrom({ link: { ...trialLink, status: "pending", bookedConsultationId: null, expiresAt: "2026-10-01T00:00:00.000Z" }, ...jessRecords }).answer(),
    previewFrom({ link: trialLink, ...jessRecords, tenants: {} }).answer(),
    previewFrom({ link: trialLink, ...jessRecords, projects: {} }).answer(),
  ];
  for (const refused of refusals) await assert.rejects(refused, /^Error: SCHEDULING_LINK_EXPIRED$/);
});

test("an unknown token reads expired, and nothing about any studio is read or sent", async () => {
  assert.equal(stateOf({ link: null }), "expired");
  assert.equal(stateOf({ link: undefined, call: null, project: null }), "expired");
  // Refused before the studio, the job or a call is read.
  const unknown = previewFrom({ link: null, ...jessRecords });
  await assert.rejects(unknown.answer(), /^Error: SCHEDULING_LINK_EXPIRED$/);
  assert.deepEqual(unknown.reads, ["link"]);

  // The server's preview is that decision over Firestore's reads, by this
  // token, and nothing else.
  const server = read("functions/src/booking/public-scheduling.ts");
  const preview = server.slice(server.indexOf("async function previewLink("), server.indexOf("async function slotsFor("));
  assert.match(preview, /^async function previewLink\(db: FirebaseFirestore\.Firestore, token: string\) \{\s*return previewSchedulingLink\(/);
  assert.match(preview, /link: async \(\) => \(await linkByToken\(token\)\)\?\.data\(\) \?\? null,/);
  assert.match(preview, /tenant: async \(tenantId\) => fieldsOf\(await db\.doc\(`tenants\/\$\{tenantId\}`\)\.get\(\)\),/);
  assert.match(preview, /project: async \(projectId\) => fieldsOf\(await db\.doc\(`projects\/\$\{projectId\}`\)\.get\(\)\),/);
  assert.match(preview, /consultation: async \(consultationId\) => fieldsOf\(await db\.doc\(`consultations\/\$\{consultationId\}`\)\.get\(\)\),/);
  assert.match(preview, /Date\.now\(\),\s*\);\s*\}/);
  assert.match(server, /const fieldsOf = \(snapshot: FirebaseFirestore\.DocumentSnapshot\) => \(snapshot\.exists \? \(snapshot\.data\(\) \?\? \{\}\) : null\);/);
  // The page's copy for it is unchanged, and the bar shows no stand-in studio.
  const page = read("components/booking/public-consultation-scheduler.tsx");
  assert.match(page, /SCHEDULING_LINK_EXPIRED: "This scheduling link has expired\. Reply to the studio’s email and they’ll send a new one\.",/);
  assert.match(page, /<AppBar studio=\{preview \? brand : undefined\} \/>/);
});

test("booking through a booked link is still refused on the server", () => {
  // Only a pending link is open; a booked one never is.
  assert.equal(linkIsOpen(trialLink, NOW), false);
  assert.equal(stateOf(), "booked");
  assert.notEqual(stateOf(), "open");
  const server = read("functions/src/booking/public-scheduling.ts");
  // activeLink is the strict check, and the only way to openings or a booking.
  assert.match(server, /async function activeLink\(token: string\) \{\s*const link = await linkByToken\(token\);\s*if \(!link \|\| !linkIsOpen\(link\.data\(\), Date\.now\(\)\)\) \{\s*throw new Error\("SCHEDULING_LINK_EXPIRED"\);/);
  const handler = server.slice(server.indexOf("export const publicConsultationScheduling"), server.indexOf("type InquiryCommand"));
  const previewAt = handler.indexOf('if (command.type === "preview") {');
  const activeAt = handler.indexOf("const link = await activeLink(command.input.token);");
  const bookAt = handler.indexOf("batch.create(db.doc(`consultations/${consultationId}`)");
  assert.ok(previewAt > 0 && activeAt > previewAt && bookAt > activeAt, "the preview returns before activeLink; the booking comes after it");
  assert.match(handler.slice(previewAt, activeAt), /response\.status\(200\)\.json\(await previewLink\(db, command\.input\.token\)\);\s*return;/);
  // previewLink is the preview's alone; linkByToken has exactly two readers.
  assert.equal(handler.split("previewLink(").length - 1, 1);
  assert.equal(server.split("await linkByToken(").length - 1, 2);
  // The call is a create, so the same time can't be written twice. That alone
  // only covers the same time: its id is the link and the time.
  assert.match(server, /batch\.create\(db\.doc\(`consultations\/\$\{consultationId\}`\), \{/);
  assert.match(server, /const consultationId = `consultation_\$\{hash\(`\$\{link\.id\}:\$\{selected\.startsAt\}`\)\.slice\(0, 32\)\}`;/);
});

test("two bookings sent at once for different times: the second is refused whole", () => {
  // Both pass activeLink, and their calls have different ids, so the create
  // let both through: two calls, two confirmations, a link naming one. The
  // link is now written only as activeLink read it.
  const server = read("functions/src/booking/public-scheduling.ts");
  const handler = server.slice(server.indexOf("export const publicConsultationScheduling"), server.indexOf("type InquiryCommand"));
  const book = handler.slice(handler.indexOf("const link = await activeLink(command.input.token);"));
  assert.match(
    book,
    /batch\.update\(\s*link\.ref,\s*\{\s*status: "booked",\s*bookedConsultationId: consultationId,[\s\S]*?\},\s*\{ lastUpdateTime: link\.updateTime \},\s*\);/,
  );
  // Every write in the booking is in that one batch, so the refusal leaves
  // nothing behind: no call, no confirmation, no job moved on.
  assert.doesNotMatch(book.slice(0, book.indexOf("await batch.commit();")), /await [^;]*\.(set|create|update)\(/);
  // The lost race answers as a booked link does.
  assert.match(
    book,
    /try \{\s*await batch\.commit\(\);\s*\} catch \(caught: unknown\) \{[\s\S]*?if \(linkChangedSinceRead\(caught\)\) throw new Error\("SCHEDULING_LINK_EXPIRED"\);\s*throw caught;\s*\}/,
  );
  // Firestore refuses a write whose lastUpdateTime no longer matches with
  // FAILED_PRECONDITION (gRPC 9). Nothing else is read as a lost race: an
  // ALREADY_EXISTS (6) or a timeout is not this link having changed.
  assert.equal(linkChangedSinceRead(Object.assign(new Error("9 FAILED_PRECONDITION: the stored version does not match"), { code: 9 })), true);
  assert.equal(linkChangedSinceRead(Object.assign(new Error("6 ALREADY_EXISTS: Document already exists"), { code: 6 })), false);
  assert.equal(linkChangedSinceRead(Object.assign(new Error("4 DEADLINE_EXCEEDED"), { code: 4 })), false);
  assert.equal(linkChangedSinceRead(new Error("TIME_NO_LONGER_AVAILABLE")), false);
  assert.equal(linkChangedSinceRead(null), false);
  assert.equal(linkChangedSinceRead(undefined), false);
});

test("the page shows the booking, with no picker, and says how to change it", () => {
  const page = read("components/booking/public-consultation-scheduler.tsx");
  // The preview decides first: a booked link refuses its openings.
  assert.match(page, /void Promise\.allSettled\(\[/);
  assert.match(page, /if \(booked\) \{\s*setPreview\(loaded\);\s*setTimezone\(booked\.timezone\);\s*setStatus\("booked"\);\s*return;\s*\}/);
  assert.match(page, /const bookedIn = status === "complete" \|\| status === "booked";/);
  assert.match(page, /\{bookedIn\s*\? "You’re booked in"/);
  // The landmark says what the heading says, straight after booking too: a
  // screen reader heard "Choose a hair trial time" over "You're booked in".
  assert.match(page, /<Main label=\{bookedIn \? "You’re booked in" : chooseTime\}>/);
  assert.match(page, /Your \{callWord \?\? "appointment"\} is booked for \{bookedWhen\(preview\.booked\.startsAt, timezone\)\}\./);
  assert.match(page, /<p className="kit-caption">Time shown in \{zone\}\.<\/p>/);
  assert.match(page, /Need a different time\? Reply to the studio’s email and they’ll sort it out\./);
  // Right after booking, the same words as before, through the same formatter.
  assert.match(page, /setMessage\(`Your \$\{callWord \?\? "appointment"\} is confirmed for \$\{bookedWhen\(String\(result\.startsAt\), timezone\)\}\.`\);/);
  // The picker and the Book button belong to an open link only — and not
  // while booking is paused on an unread calendar (calendar-availability-fail-closed.test.ts).
  assert.match(page, /\{\(status === "ready" \|\| status === "booking"\) && !paused \? \(\s*<Actions>/);
  const booked = page.slice(page.indexOf('status === "booked" && preview?.booked ? ('), page.indexOf("<SlotPicker"));
  assert.ok(booked.length > 0);
  assert.doesNotMatch(booked.slice(0, booked.indexOf("</Card>")), /SlotPicker|Button/);
});
