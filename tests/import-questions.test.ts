import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyImportAnswers,
  applyImportUpdate,
  honoreeInNotes,
  importQuestions,
  phoneLooksWrong,
  planImportUpdate,
  retainerInNotes,
  type ImportCandidate,
} from "../features/imports/import-questions";
import { assessExistingBooking, planImportedBooking, type ExistingBooking } from "../features/imports/existing-booking";
import { bookingFromSpreadsheetRow, detectColumns, detectCrewColumns, parseCsv } from "../features/imports/spreadsheet";
import { todayInbox } from "../features/today/inbox";

/**
 * What the import asks before a row goes in (2026-10-26), built from GR's own
 * sheet: retainers listed as paid beside notes saying no payment was
 * confirmed, a $3,000 "paid" where the notes said the retainer was $1,000, a
 * photo-only wedding with a videographer, a nine-digit phone, an unsigned
 * contract, and a mitzvah child named only in the notes.
 */

const TODAY = "2026-10-26";

// The shapes of GR's sheet, with made-up people: the same headers, and notes
// written the way Gabe's are.
const SHEET = [
  "First name,Last name,Email,Phone,Partner's name,Partner's email,Event date,Event type,Venue,City,Package,Contract total,Tax,Amount paid,Date paid,Date signed,Coverage hours,Videographers,Photographers,Notes",
  'Ava,Stone,ava.stone@example.com,5550100101,Leo Marsh,leo.marsh@example.com,2/6/27,Wedding,The Orchard Hall,Clifton,Gold Photo Package + Silver Cinematic Package,7000,,3000,,3/21/26,8,1,2,"Gold package includes $500 credit; still $4500 + video $2500; $3000 retainer required, no payment confirmation in contract"',
  'Lily,Park,lily.park@example.com,5550100102,Owen Reid,owen.reid@example.com,3/12/27,Wedding,Harbor View,Jersey City,Gold Photo Package,4999,,2000,,4/30/26,8,1,2,"PHOTO ONLY per Gabe (Oct 23); $2000 retainer PAID in full (per Gabe, Oct 23; payment date not stated)"',
  'Nora,Quinn,nora.quinn@example.com,5550100103,Eli Grant,eli.grant@example.com,4/10/27,Wedding,Lakeside Country Club,,Gold Photo Package + Silver Cinematic Package,7998,,3000,,2/21/26,8,1,2,"guests more than 150; retainer stated as $1000; no payment confirmation in contract"',
  'Ruth,Adler,ruth.adler@example.com,555-010-0104,,,5/1/27,Bar Mitzvah,The Grand Room,Randolph,Photo Package + Cinematic Package,4898,,2000,,11/12/25,8,1,1,"Contract signer is parent Ruth Adler; mitzvah child is Sam Adler; $2000 deposit stated; no payment confirmation in contract"',
  'Ivy,Lane,ivy.lane@example.com,5550100105,Max Ford,max.ford@example.com,5/28/27,Wedding,Bayside Club,Harwich Port,Silver Photo Package,3500,,0,,,8,0,1,"signature blocks BLANK in this PDF (unsigned copy); NO retainer received yet"',
  'Jade,Moss,jade.moss@example.com,555010019,Theo Moss,jade.moss@example.com,11/27/27,Wedding,Willow Estate,Florham Park,Gold Photo Package + Silver Cinematic Package,7998,,3000,,5/1/26,8,1,2,"bride and groom share the same email; $3000 retainer required, no payment confirmation in contract"',
].join("\n");

function readSheet() {
  const [head, ...body] = parseCsv(SHEET);
  const columns = detectColumns(head!, "photographer");
  const crewColumns = detectCrewColumns(head!, "photographer", body);
  return body.map((cells, index) =>
    bookingFromSpreadsheetRow({ row: index + 2, cells, columns, timezone: "America/New_York", trade: "photographer", crewColumns, headers: head, today: TODAY }),
  );
}

function candidate(row: number): ImportCandidate {
  const result = readSheet().find((entry) => entry.row === row)!;
  if ("problems" in result) throw new Error(result.problems.join(" "));
  return "booking" in result ? { kind: "booking", booking: result.booking } : { kind: "inquiry", inquiry: result.inquiry };
}

const bookingOf = (row: number) => {
  const found = candidate(row);
  assert.equal(found.kind, "booking");
  return (found as { booking: ExistingBooking }).booking;
};

test("the notes are read for what they say about money, the phone and who it celebrates", () => {
  assert.equal(retainerInNotes("$3000 retainer required, no payment confirmation"), 300_000);
  assert.equal(retainerInNotes("guests more than 150; retainer stated as $1000"), 100_000);
  assert.equal(retainerInNotes("$2,000 deposit stated"), 200_000);
  assert.equal(retainerInNotes("still $4500 + video $2500"), null);
  assert.equal(honoreeInNotes("Contract signer is parent Ruth; mitzvah child is Sam Adler; home photos"), "Sam Adler");
  assert.equal(phoneLooksWrong("555010019"), true);
  assert.equal(phoneLooksWrong("555-010-0104"), false);
  assert.equal(phoneLooksWrong("15550100106"), false);
  assert.equal(phoneLooksWrong("+44 7700 900123"), false);
});

test("an amount paid beside notes saying no payment was confirmed is asked, never assumed", () => {
  const row = candidate(2);
  const questions = importQuestions(row);
  assert.deepEqual(questions.map((question) => question.id), ["payment"]);
  assert.match(questions[0]!.prompt, /no payment confirmation\. Has the \$3,000 been received\?/);
  assert.deepEqual(questions[0]!.options.map((option) => option.id), ["received_sheet", "owed"]);
  assert.equal(applyImportAnswers(row, {}).kind, "open");

  const received = applyImportAnswers(row, { payment: "received_sheet" });
  assert.equal(received.kind, "booking");
  if (received.kind !== "booking") return;
  assert.equal(received.booking.payments[0]!.amountCents, 300_000);
  assert.deepEqual(received.booking.confirmations, [{ question: questions[0]!.prompt, answer: "Yes, it's been received" }]);

  const owed = applyImportAnswers(row, { payment: "owed" });
  assert.equal(owed.kind, "booking");
  if (owed.kind !== "booking") return;
  assert.deepEqual(owed.booking.payments, []);
  assert.equal(owed.booking.retainerOwedCents, 300_000);
  assert.ok(!(owed.booking.assumed ?? []).includes("paidOn"));
});

test("a confirmed payment in the notes asks nothing; a different retainer offers both figures", () => {
  // "$2000 retainer PAID in full" beside $2,000 paid.
  assert.deepEqual(importQuestions(candidate(3)).map((question) => question.id), ["video"]);

  const quinn = candidate(4);
  const [payment] = importQuestions(quinn);
  assert.equal(payment!.prompt, "Your notes say the retainer is $1,000, but the sheet says $3,000 paid. What's been received?");
  assert.deepEqual(payment!.options.map((option) => option.label), ["$1,000 received", "$3,000 received", "Nothing yet · $1,000 owed"]);
  const settled = applyImportAnswers(quinn, { payment: "received_notes" });
  assert.equal(settled.kind === "booking" && settled.booking.payments[0]!.amountCents, 100_000);
  const owed = applyImportAnswers(quinn, { payment: "owed" });
  assert.equal(owed.kind === "booking" && owed.booking.retainerOwedCents, 100_000);
  // A vendor's client pays a deposit.
  assert.match(importQuestions(quinn, {}, { deposit: "deposit" })[0]!.prompt, /the deposit is \$1,000/);
});

test("a photo-only wedding with a videographer is asked, and No videographer takes them off", () => {
  const park = candidate(3);
  const [video] = importQuestions(park);
  assert.equal(video!.prompt, "Your notes say photo only, but the sheet has 1 videographer.");
  const settled = applyImportAnswers(park, { video: "no_video" });
  assert.equal(settled.kind, "booking");
  if (settled.kind !== "booking") return;
  assert.deepEqual(settled.booking.crew, [{ role: "photographer", count: 2, names: [] }]);
});

test("a mitzvah child named in the notes is offered as who it celebrates, with the variant from the type", () => {
  const adler = candidate(5);
  assert.equal(adler.kind === "booking" && adler.booking.kindVariant, "bar");
  const honoree = importQuestions(adler).find((question) => question.id === "honoree")!;
  assert.equal(honoree.prompt, "Your notes name Sam Adler for the bar mitzvah. Save Sam as who it celebrates?");
  const settled = applyImportAnswers(adler, { payment: "received_sheet", honoree: "yes" });
  assert.equal(settled.kind === "booking" && settled.booking.honoreeName, "Sam");
  const blank = applyImportAnswers(adler, { payment: "received_sheet", honoree: "no" });
  assert.equal(blank.kind === "booking" && (blank.booking.honoreeName ?? null), null);
});

test("an unsigned row is an inquiry if the studio says so, and Leave it out leaves it out", () => {
  const lane = candidate(6);
  assert.equal(lane.kind, "inquiry");
  if (lane.kind !== "inquiry") return;
  assert.equal(lane.inquiry.quotedCents, 350_000);
  assert.deepEqual(importQuestions(lane).map((question) => question.id), ["signed"]);
  const inquiry = applyImportAnswers(lane, { signed: "inquiry" });
  assert.equal(inquiry.kind, "inquiry");
  assert.equal(applyImportAnswers(lane, { signed: "skip" }).kind, "skip");
});

test("a booking whose notes say it isn't signed asks how it comes in", () => {
  const unsigned: ImportCandidate = { kind: "booking", booking: { ...bookingOf(2), notes: "signature blocks BLANK in this PDF" } };
  const [signed] = importQuestions(unsigned);
  assert.equal(signed!.id, "signed");
  // Going in as an inquiry, its money no longer matters.
  assert.deepEqual(importQuestions(unsigned, { signed: "inquiry" }).map((question) => question.id), ["signed"]);
  const settled = applyImportAnswers(unsigned, { signed: "inquiry" });
  assert.equal(settled.kind, "inquiry");
});

test("one email for two people stays with the first, and a nine-digit phone is asked", () => {
  const result = readSheet().find((entry) => entry.row === 7)!;
  assert.ok("booking" in result);
  if (!("booking" in result)) return;
  assert.equal(result.booking.clients[1]!.email, null);
  assert.ok(result.notes.includes("Both people had the same email, so it's kept on Jade only."));
  assert.equal(assessExistingBooking(result.booking, TODAY).some((issue) => issue.code === "DUPLICATE_CLIENT_EMAIL"), false);
  const moss: ImportCandidate = { kind: "booking", booking: result.booking };
  const phone = importQuestions(moss).find((question) => question.id === "phone")!;
  assert.equal(phone.prompt, "Jade's phone number, 555010019, has 9 digits.");
  const settled = applyImportAnswers(moss, { payment: "received_sheet", phone: "blank" });
  assert.equal(settled.kind === "booking" && settled.booking.clients[0]!.phone, null);
});

test("a sheet row with money paid and no signing date is still a problem, not an inquiry", () => {
  const [head, ...body] = parseCsv(SHEET);
  const columns = detectColumns(head!, "photographer");
  const cells = [...body[0]!];
  cells[15] = "";
  const result = bookingFromSpreadsheetRow({ row: 2, cells, columns, timezone: "UTC", trade: "photographer", headers: head, today: TODAY });
  assert.ok("problems" in result && result.problems.includes("No date signed or booked."));
});

test("a retainer still owed is a bill due, not a payment, and only before the event", () => {
  const settled = applyImportAnswers(candidate(2), { payment: "owed" });
  assert.equal(settled.kind, "booking");
  if (settled.kind !== "booking") return;
  const booking = settled.booking;
  const issues = assessExistingBooking(booking, TODAY);
  assert.ok(issues.some((issue) => issue.code === "RETAINER_OWED" && /\$3,000 retainer is still owed/.test(issue.message)));
  assert.ok(!issues.some((issue) => issue.code === "NO_PAYMENTS_RECORDED"));
  const records = planImportedBooking(booking, {
    tenantId: "t",
    projectId: "p",
    packageSnapshotId: "s",
    contractId: "c",
    invoiceId: "i",
    owedInvoiceId: "o",
    contactIds: ["k"],
    actorId: "gabe",
    now: "2026-10-26T15:00:00.000Z",
    source: "spreadsheet",
    batchId: "b",
  });
  assert.equal(records.paidInvoice, null);
  assert.equal(records.owedInvoice?.status, "sent");
  assert.equal(records.owedInvoice?.balanceCents, 300_000);
  assert.equal(records.owedInvoice?.provider, null);
  assert.equal(records.owedInvoice?.providerCustomerId, null);
  assert.equal(records.owedInvoice?.dueDate, "2026-10-26");
  assert.equal(records.packageSnapshot.retainerCents, 300_000);
  assert.equal(records.project.nextAction, "Collect the $3,000 retainer");
  assert.deepEqual(records.project.importConfirmations, [
    { ...booking.confirmations![0]!, confirmedBy: "gabe", confirmedAt: "2026-10-26T15:00:00.000Z" },
  ]);

  // After the event, what isn't in is the balance.
  const past = { ...booking, eventDate: "2026-09-01", signedOn: "2026-01-01", state: "CLOSED" as const };
  assert.ok(assessExistingBooking(past, TODAY).some((issue) => issue.code === "RETAINER_OWED_AFTER_EVENT"));
  // And owed plus paid can't pass the total.
  const over = { ...booking, payments: [{ amountCents: 600_000, paidOn: "2026-03-21", method: "Check" }] };
  assert.ok(assessExistingBooking(over, TODAY).some((issue) => issue.code === "PAID_MORE_THAN_TOTAL"));
});

test("who a mitzvah celebrates goes on the job in the fields job-kinds reads", () => {
  const settled = applyImportAnswers(candidate(5), { payment: "received_sheet", honoree: "yes" });
  assert.equal(settled.kind, "booking");
  if (settled.kind !== "booking") return;
  const records = planImportedBooking(settled.booking, {
    tenantId: "t", projectId: "p", packageSnapshotId: "s", contractId: "c", invoiceId: "i", contactIds: ["k"],
    actorId: "gabe", now: "2026-10-26T15:00:00.000Z", source: "spreadsheet", batchId: "b",
  });
  assert.equal(records.project.honoreeName, "Sam");
  assert.equal(records.project.mitzvahType, "bar");
});

test("Already here: what the job lacks is filled, what disagrees is asked, money is only said", () => {
  const booking = { ...bookingOf(3), startTime: "14:30" };
  const plan = planImportUpdate(
    { venueName: "Harbor View", city: null, startTime: null, honoreeName: null, kindVariant: null, notes: null, coverage: [{ role: "photographer", count: 1 }], totalCents: 450_000 },
    booking,
    "photographer",
  );
  assert.deepEqual(plan.filled, ["city", "start time", "notes"]);
  assert.deepEqual(plan.changes.city, "Jersey City");
  assert.deepEqual(plan.conflicts.map((question) => question.prompt), ["The job has 1 photographer; the sheet says 2 photographers and 1 videographer."]);
  assert.match(plan.moneyNote!, /The job's total is \$4,500 and the sheet says \$4,999/);
  assert.ok("open" in applyImportUpdate(plan, booking, {}));
  const kept = applyImportUpdate(plan, booking, { job_crew: "job" });
  assert.ok(!("open" in kept) && kept.changes.crew === undefined);
  const sheet = applyImportUpdate(plan, booking, { job_crew: "sheet" });
  assert.ok(!("open" in sheet) && sheet.changes.crew === booking.crew);
  assert.ok(!("open" in sheet) && sheet.confirmations[0]!.answer === "Use the sheet's crew");

  // Nothing new: the same job, the same sheet.
  const same = planImportUpdate(
    { venueName: "harbor view", city: "Jersey City", startTime: "14:30", honoreeName: null, kindVariant: null, notes: booking.notes, coverage: [{ role: "videographer", count: 1 }, { role: "photographer", count: 2 }], totalCents: booking.totalCents },
    booking,
    "photographer",
  );
  assert.deepEqual([same.filled, same.conflicts, same.moneyNote], [[], [], null]);
});

test("rows kept for later reach Today as one card", () => {
  const inbox = todayInbox({
    now: "2026-10-26T15:00:00.000Z",
    importDrafts: [
      { id: "d1", tenantId: "t", status: "held", label: "Jade & Theo Moss · 2027-11-27", heldAt: "2026-10-26T14:00:00.000Z" },
      { id: "d2", tenantId: "t", status: "held", label: "Nora Quinn & Eli Grant · 2027-04-10", heldAt: "2026-10-26T14:00:00.000Z" },
      { id: "d3", tenantId: "t", status: "imported", label: "Ava Stone", heldAt: "2026-10-26T14:00:00.000Z" },
    ],
  });
  const card = [...inbox.act, ...inbox.approve, ...inbox.fyi].find((item) => item.id === "import-drafts");
  assert.ok(card);
  assert.equal(card!.title, "2 imported jobs need an answer");
  assert.deepEqual(card!.action, { kind: "link", label: "Answer them", href: "/studio/projects/import#held-rows" });
});
