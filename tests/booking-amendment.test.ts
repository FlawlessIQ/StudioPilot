import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  amendmentChangeLines,
  amendmentMoney,
  daysBetween,
  isAmendableState,
  shiftDate,
  shiftTimestamp,
} from "../functions/src/booking/amendment-core";
import { friendlyError } from "@/lib/ai/friendly-error";
import { AMENDABLE_STATES as SERVER_AMENDABLE } from "../functions/src/booking/amendment-core";
import { AMENDABLE_STATES as APP_AMENDABLE, shiftInZone as appShiftInZone } from "@/features/booking/amendable";
import { consultationWhen, rangesOverlap, shiftInZone } from "../functions/src/booking/amendment-core";
import { assignmentCalendarUid, assignmentIcs } from "../functions/src/crew/calendar-ics";
import { todayInbox } from "@/features/today/inbox";

/**
 * Changing a booking after the couple signed (2026-09-29).
 *
 * A signed wedding used to be frozen: packages locked, the proposal final, the
 * contract un-voidable. A couple who wanted video added or their date moved
 * left the studio with nowhere to go. These hold the way out: an amendment the
 * couple signs, applied without moving the job's stage.
 */

const read = (path: string) => readFileSync(path, "utf8");

test("a booking can be changed from signing until the wedding, never before or after", () => {
  for (const state of ["RETAINER_PENDING", "BOOKED", "PLANNING", "READY", "POSTPONED"]) assert.ok(isAmendableState(state), state);
  for (const state of ["INQUIRY", "PROPOSAL_SENT", "CONTRACT_SENT", "EVENT_DAY", "DELIVERY", "CLOSED", "LOST", undefined])
    assert.equal(isAmendableState(state), false, String(state));
});

test("a change never re-prices the retainer, keeps what was paid, and owes back the excess", () => {
  // Adding video: $6,000 → $8,500, $1,500 retainer paid.
  const up = amendmentMoney({ previousTotalCents: 600_000, newTotalCents: 850_000, agreedRetainerCents: 150_000, paidCents: 150_000 });
  assert.equal(up.retainerCents, 150_000);
  assert.equal(up.finalBalanceCents, 700_000);
  assert.equal(up.outstandingCents, 700_000);
  assert.equal(up.refundCents, 0);
  // Dropping to $2,000 after $3,000 was paid: a refund, never a negative bill.
  const down = amendmentMoney({ previousTotalCents: 600_000, newTotalCents: 200_000, agreedRetainerCents: 150_000, paidCents: 300_000 });
  assert.equal(down.outstandingCents, 0);
  assert.equal(down.refundCents, 100_000);
  // A retainer larger than the new total is clamped, not billed beyond it.
  const tiny = amendmentMoney({ previousTotalCents: 600_000, newTotalCents: 100_000, agreedRetainerCents: 150_000, paidCents: 0 });
  assert.equal(tiny.retainerCents, 100_000);
  assert.equal(tiny.finalBalanceCents, 0);
});

test("a date moves by whole days, and stamped times keep their clock", () => {
  assert.equal(daysBetween("2027-06-12", "2027-09-18"), 98);
  assert.equal(daysBetween("2027-03-13", "2027-03-14"), 1, "no DST drift");
  assert.equal(shiftDate("2027-06-12", 98), "2027-09-18");
  assert.equal(shiftTimestamp("2027-06-12T15:30:00.000Z", 7), "2027-06-19T15:30:00.000Z");
  assert.equal(shiftTimestamp(null, 7), null);
  assert.equal(shiftDate("not a date", 3), "not a date");
});

test("the couple reads what changes in plain words", () => {
  const money = amendmentMoney({ previousTotalCents: 600_000, newTotalCents: 850_000, agreedRetainerCents: 150_000, paidCents: 150_000 });
  const lines = amendmentChangeLines({
    previousDate: "2027-06-12",
    newDate: "2027-09-18",
    keptPackages: ["Full Day"],
    addedPackages: ["Highlight Film"],
    removedPackages: [],
    money,
  });
  assert.deepEqual(lines, [
    "The wedding date moves from Saturday, June 12, 2027 to Saturday, September 18, 2027.",
    "Highlight Film is added.",
    "The total changes from $6,000 to $8,500.",
    "$1,500 already paid is kept and counts toward the new total.",
    "$7,000 remains to be paid.",
  ]);
});

test("signing a change never moves the job's stage, and both signatures run through one trigger", () => {
  const apply = read("functions/src/booking/amendment-apply.ts");
  const projectUpdate = apply.slice(apply.indexOf("transaction.update(projectReference, {"));
  assert.doesNotMatch(projectUpdate.slice(0, projectUpdate.indexOf("});")), /\bstate:/);
  assert.match(apply, /export const bookingAmendmentSigned = onDocumentWritten\(\s*"bookingAmendments\/\{amendmentId\}"/);
  assert.match(read("functions/src/index.ts"), /export \{ bookingAmendmentSigned \} from "\.\/booking\/amendment-apply\.js"/);
  // The couple's portal signature and the studio's recorded one both only set "signed".
  assert.match(read("server/contracts/amendment-signing.ts"), /status: "signed",/);
  assert.match(read("functions/src/contracts/amendments.ts"), /kind: "manual_attested"/);
});

test("an unsigned change is held apart, so nothing that reads the latest proposal sees it", () => {
  const amendments = read("functions/src/contracts/amendments.ts");
  assert.match(amendments, /amendmentProposals\/\$\{/);
  assert.doesNotMatch(amendments, /db\.doc\(`proposals\/amend_/);
  // Filed as a proposal only once signed.
  const apply = read("functions/src/booking/amendment-apply.ts");
  assert.match(apply, /const heldReference = db\.doc\(`amendmentProposals\//);
  assert.match(apply, /transaction\.set\(pendingReference, \{[\s\S]{0,120}status: "accepted"/);
  assert.match(read("functions/src/contracts/sources.ts"), /amendmentProposals\//);
  // Only the server writes either collection.
  const rules = read("firestore.rules");
  for (const collection of ["bookingAmendments", "amendmentProposals"]) {
    const block = rules.slice(rules.indexOf(`match /${collection}/`));
    assert.match(block.slice(0, block.indexOf("\n    }")), /allow write: if false;/, collection);
  }
});

test("a signed job points the studio at the change, never at a dead end", () => {
  assert.match(friendlyError(new Error("PACKAGES_LOCKED_AFTER_SIGNING")), /Change the booking/);
  assert.match(friendlyError(new Error("DATE_TAKEN:Smith & Jones")), /^Smith & Jones already has that date/);
  assert.match(read("functions/src/ai/action-catalog.ts"), /change_booking/);
  assert.match(read("components/ai/flow-runner.tsx"), /<BookingAmendmentPanel prefill=\{\{ addPackageIds: namedId \? \[namedId\] : \[\] \}\}/);
  assert.match(read("components/projects/live-project-detail.tsx"), /<BookingAmendment\b/);
});

test("the standing-invoice rule is asked about a status, never a whole record", () => {
  // Found on the emulator walk: isStandingInvoice(invoice.data()) stringifies
  // to "[object Object]", which stands — so a superseded final still counted as
  // owed and a signed change never raised the replacement bill.
  const calls = execSync("grep -rhoE 'isStandingInvoice\\([^)]*\\)' functions/src app lib server features components || true", { encoding: "utf8" })
    .split("\n")
    .filter((call) => call && !call.includes("status: unknown"));
  assert.ok(calls.length > 5);
  for (const call of calls) assert.doesNotMatch(call, /\.data\(\)|\(invoice\)|\(document\)|\(row\)/, call);
});

test("the app and the server agree on which bookings can be changed", () => {
  assert.deepEqual([...APP_AMENDABLE], [...SERVER_AMENDABLE]);
});

test("a couple can ask to change a signed booking, and Today answers with a change they sign", () => {
  const inbox = todayInbox({
    now: "2026-09-29T15:00:00Z",
    projects: [{ id: "p1", name: "Nora & Quill", state: "BOOKED", archivedAt: null, eventDate: "2027-01-09" }],
    proposals: [{ id: "v1", projectId: "p1", status: "accepted", version: 1 }],
    packageRequests: [
      { id: "d1", projectId: "p1", kind: "date_change", requestedDate: "2027-02-13", note: "Venue offered February", status: "pending", createdAt: "2026-09-29T14:00:00Z" },
      { id: "k1", projectId: "p1", packageId: "film", packageName: "Highlight Film", basePriceCents: 250000, currency: "USD", status: "pending", createdAt: "2026-09-29T14:00:00Z" },
      // Already moved there: nothing left to decide.
      { id: "d2", projectId: "p1", kind: "date_change", requestedDate: "2027-01-09", status: "pending", createdAt: "2026-09-29T14:00:00Z" },
    ],
  });
  const cards = inbox.act.filter((item) => item.id.startsWith("package-request-"));
  assert.deepEqual(cards.map((card) => card.id).sort(), ["package-request-d1", "package-request-k1"]);
  const date = cards.find((card) => card.id === "package-request-d1")!;
  assert.equal(date.title, "Nora & Quill want to move their date to Feb 13, 2027");
  assert.match(date.detail, /booking change for them to sign/);
  assert.ok(date.action.kind === "package_request" && date.action.amend && date.action.requestKind === "date_change");
  assert.equal(date.action.kind === "package_request" ? date.action.label : "", "Write up the change");
  const film = cards.find((card) => card.id === "package-request-k1")!;
  assert.ok(film.action.kind === "package_request" && film.action.amend && film.action.requestKind === "package");
});

test("the portal takes a date request as a request, and a signed change settles it", () => {
  const portal = read("app/api/client/portal/route.ts");
  const request = portal.slice(portal.indexOf("async function requestDateChangeForClient"), portal.indexOf("async function selectPackageForClient"));
  assert.match(request, /kind: "date_change"/);
  assert.match(request, /status: "pending"/);
  assert.doesNotMatch(request, /eventDate:\s*input\.eventDate[^,]*,\s*\n\s*updatedAt/, "never moves the date itself");
  assert.doesNotMatch(request, /projects\/\$\{input\.projectId\}`\)\.(update|set)/);
  // Signed bookings can ask; the studio answers with a booking change.
  assert.match(portal, /\|\| signed\)/);
  const apply = read("functions/src/booking/amendment-apply.ts");
  assert.match(apply, /async function settleCoupleRequests/);
  assert.match(apply, /resultAmendmentId: amendmentId/);
  // Today holds the sheet itself, so a refresh can't close it mid-change.
  assert.match(read("components/today/today-inbox.tsx"), /const \[changing, setChanging\] = useState<PackageRequestAction \| null>/);
});

test("a moved call keeps its local time across a daylight-saving change", () => {
  // 2:00 PM in New York on Wed Mar 10, 2027 (EST) → Wed Mar 17 (EDT), still 2:00 PM.
  assert.equal(shiftInZone("2027-03-10T19:00:00.000Z", 7, "America/New_York"), "2027-03-17T18:00:00.000Z");
  assert.equal(appShiftInZone("2027-03-10T19:00:00.000Z", 7, "America/New_York"), "2027-03-17T18:00:00.000Z");
  // And back again in November.
  assert.equal(shiftInZone("2027-10-30T18:00:00.000Z", 7, "America/New_York"), "2027-11-06T18:00:00.000Z");
  assert.equal(shiftInZone("2027-10-31T18:00:00.000Z", 7, "America/New_York"), "2027-11-07T19:00:00.000Z");
  // No zone: whole days. Nothing to move: unchanged.
  assert.equal(shiftInZone("2027-03-10T19:00:00.000Z", 7, null), "2027-03-17T19:00:00.000Z");
  assert.equal(shiftInZone("2027-03-10T19:00:00.000Z", 0, "America/New_York"), "2027-03-10T19:00:00.000Z");
  assert.equal(consultationWhen("2027-03-17T18:00:00.000Z", "America/New_York"), "Wednesday, March 17 at 2:00 PM");
  assert.ok(rangesOverlap("2027-03-17T18:00:00Z", "2027-03-17T19:00:00Z", "2027-03-17T18:30:00Z", "2027-03-17T20:00:00Z"));
  assert.ok(!rangesOverlap("2027-03-17T18:00:00Z", "2027-03-17T19:00:00Z", "2027-03-17T19:00:00Z", "2027-03-17T20:00:00Z"));
});

test("the couple reads which calls move with the date", () => {
  const lines = amendmentChangeLines({
    previousDate: "2027-06-12",
    newDate: "2027-06-19",
    keptPackages: ["Full Day"],
    addedPackages: [],
    removedPackages: [],
    money: amendmentMoney({ previousTotalCents: 600_000, newTotalCents: 600_000, agreedRetainerCents: 150_000, paidCents: 0 }),
    movedCalls: [{ label: "Zoom call", from: "Saturday, May 29 at 3:00 PM", to: "Saturday, June 5 at 3:00 PM" }],
  });
  assert.equal(lines[1], "Your Zoom call on Saturday, May 29 at 3:00 PM moves to Saturday, June 5 at 3:00 PM.");
  // The studio picks; the server checks each call and moves it only if nobody moved it since.
  const amendments = read("functions/src/contracts/amendments.ts");
  assert.match(amendments, /moveConsultationIds: z\.array\(z\.string\(\)\.min\(1\)\)\.max\(10\)\.default\(\[\]\)/);
  assert.match(amendments, /getCalendarBusyIntervals\(tenantId, windowStart, windowEnd\)/);
  const apply = read("functions/src/booking/amendment-apply.ts");
  assert.match(apply, /text\(consultation\.get\("startsAt"\)\) !== move\.fromStartsAt/);
  assert.match(apply, /type: "reschedule_consultation_resources"/);
  assert.match(read("components/booking/booking-amendment.tsx"), /moveConsultationIds: shiftDays \?/);
});

test("a crew member's own calendar copy moves: same event, next version, attached to the email", () => {
  const ics = assignmentIcs({
    assignmentId: "a1",
    startsAt: "2027-06-19T17:00:00.000Z",
    endsAt: "2027-06-20T01:00:00.000Z",
    projectName: "Nora & Quill",
    role: "Second shooter",
    location: "The Foundry, 42 9th St",
    sequence: 2,
    stampedAt: "2026-09-30T12:00:00.000Z",
  });
  assert.match(ics, /UID:a1@studiocue\r\nSEQUENCE:2\r\n/);
  assert.match(ics, /DTSTART:20270619T170000Z/);
  assert.match(ics, /LOCATION:The Foundry\\, 42 9th St/);
  assert.equal(assignmentCalendarUid("a1"), "a1@studiocue");
  // The in-app download is the same event.
  const download = read("lib/crew/calendar-file.ts");
  assert.match(download, /`UID:\$\{input\.assignmentId\}@studiocue`/);
  assert.match(download, /`SEQUENCE:\$\{/);
  for (const screen of ["components/crew/kit/crew-offer.tsx", "components/crew/kit/crew-day-sheet.tsx"])
    assert.match(read(screen), /sequence: typeof \w+\.calendarSequence === "number"/, screen);
  // A date move bumps the version and attaches it to accepted crew's email.
  const apply = read("functions/src/booking/amendment-apply.ts");
  assert.match(apply, /const calendarSequence = num\(assignment\.get\("calendarSequence"\)\) \+ 1;/);
  assert.match(apply, /calendarAttachment:\s*status === "accepted"/);
  assert.match(read("functions/src/operations/jobs.ts"), /type: "text\/calendar"/);
});

test("booking a call from a job starts on that job, and same-name couples are told apart", () => {
  // Walked 2026-09-30: "Scheduling a consultation for Harper Lane wedding" over
  // a form that asked which job, listing two "Harper Lane wedding"s.
  const calendar = read("components/booking/studio-calendar.tsx");
  assert.match(calendar, /projectId=\{schedulingFor \? schedulingFor\.id : null\}/);
  assert.match(calendar, /useState\(initial \? initial\.id : ""\)/);
  assert.match(calendar, /`\$\{String\(project\.name\)\} · \$\{formatDueDate\(project\.eventDate\)\}`/);
});
