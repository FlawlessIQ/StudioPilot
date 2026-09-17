import assert from "node:assert/strict";
import test from "node:test";
import {
  assessExistingBooking,
  existingBookingSchema,
} from "../features/imports/existing-booking";
import {
  bookingFromSpreadsheetRow,
  detectColumns,
  parseCsv,
  parseSpreadsheetDate,
  parseSpreadsheetMoney,
  spreadsheetTemplateCsv,
} from "../features/imports/spreadsheet";

/**
 * A studio's exported spreadsheet, read faithfully.
 *
 * The failure that matters here is a confident misreading: a total taken from
 * the deposit column, a couple collapsed into one client, a date read in the
 * wrong order. Every one of those would import a wrong fact the studio has no
 * reason to re-check, because it came from their own sheet.
 */

test("quoted fields, embedded commas and newlines, and CRLF survive parsing", () => {
  const rows = parseCsv(
    '﻿Name,Notes,Total\r\n"Johnson, Maya","Loves ""golden hour""\nand film",6499\r\n\r\n',
  );
  assert.deepEqual(rows, [
    ["Name", "Notes", "Total"],
    ["Johnson, Maya", 'Loves "golden hour"\nand film', "6499"],
  ]);
});

test("columns are matched by meaning, and never by the shortest word in them", () => {
  const headers = [
    "Client",
    "Client Email",
    "Wedding Date",
    "Venue Name",
    "Collection",
    "Project Total",
    "Deposit Amount",
    "Date Booked",
    "Partner Email",
  ];
  const columns = detectColumns(headers);
  assert.equal(columns.clientName, 0);
  assert.equal(columns.email, 1);
  assert.equal(columns.eventDate, 2);
  assert.equal(columns.venueName, 3);
  assert.equal(columns.packageName, 4);
  assert.equal(columns.total, 5);
  // Contains "amount", but it's what was paid.
  assert.equal(columns.paid, 6);
  assert.equal(columns.signedOn, 7);
  // "Email" is taken; the partner's column is not also the client's.
  assert.equal(columns.partnerEmail, 8);
});

test("dates are read as studios' exports write them, and nonsense is refused", () => {
  assert.equal(parseSpreadsheetDate("2027-06-12"), "2027-06-12");
  assert.equal(parseSpreadsheetDate("06/12/2027"), "2027-06-12");
  assert.equal(parseSpreadsheetDate("6/12/27"), "2027-06-12");
  assert.equal(parseSpreadsheetDate("June 12, 2027"), "2027-06-12");
  assert.equal(parseSpreadsheetDate("Saturday, Jun 12th 2027"), "2027-06-12");
  assert.equal(parseSpreadsheetDate("12 June 2027"), "2027-06-12");
  assert.equal(parseSpreadsheetDate("2027-06-12T15:00:00Z"), "2027-06-12");
  assert.equal(parseSpreadsheetDate("02/30/2027"), null);
  assert.equal(parseSpreadsheetDate("next spring"), null);
});

test("money is read however it's formatted", () => {
  assert.equal(parseSpreadsheetMoney("$6,499.00"), 649_900);
  assert.equal(parseSpreadsheetMoney("6499"), 649_900);
  assert.equal(parseSpreadsheetMoney("USD 2,000"), 200_000);
  assert.equal(parseSpreadsheetMoney(""), null);
  assert.ok(Number.isNaN(parseSpreadsheetMoney("TBD") as number));
  assert.ok((parseSpreadsheetMoney("(150.00)") as number) < 0);
});

test("a HoneyBook-style row becomes the booking it describes", () => {
  const [headers, cells] = parseCsv(
    [
      "Client,Client Email,Wedding Date,Venue Name,Collection,Project Total,Deposit Amount,Date Booked",
      'Maya & Theo Johnson,Maya@Example.com,"June 12, 2027",The Grove,Signature,"$6,499.00",$2000,03/02/2026',
    ].join("\n"),
  );
  const result = bookingFromSpreadsheetRow({
    row: 2,
    cells: cells!,
    columns: detectColumns(headers!),
    timezone: "America/New_York",
  });
  assert.ok("booking" in result, JSON.stringify(result));
  const booking = existingBookingSchema.parse(result.booking);
  assert.deepEqual(
    booking.clients.map((client) => `${client.firstName} ${client.lastName}`),
    ["Maya Johnson", "Theo Johnson"],
  );
  assert.equal(booking.clients[0]!.email, "maya@example.com");
  assert.equal(booking.eventDate, "2027-06-12");
  assert.equal(booking.signedOn, "2026-03-02");
  assert.equal(booking.totalCents, 649_900);
  assert.deepEqual(booking.payments, [
    { amountCents: 200_000, paidOn: "2026-03-02", method: "Paid before StudioCue" },
  ]);
  // The guesses it had to make are said, not hidden.
  assert.ok(result.notes.some((note) => note.includes("dated when the contract was signed")));
  assert.ok(result.notes.some((note) => note.includes("8 hours")));
  // And the server's check has nothing against it.
  assert.deepEqual(
    assessExistingBooking(booking, "2026-09-17").filter((issue) => issue.severity === "error"),
    [],
  );
});

test("a row missing what matters says exactly what, in words", () => {
  const [headers, cells] = parseCsv(
    ["First Name,Last Name,Email,Event Date,Total,Signed", "Maya,,,sometime,TBD,"].join("\n"),
  );
  const result = bookingFromSpreadsheetRow({
    row: 2,
    cells: cells!,
    columns: detectColumns(headers!),
    timezone: "UTC",
  });
  assert.ok("problems" in result);
  assert.deepEqual(result.problems, [
    "No client first and last name.",
    "No client email.",
    'Couldn\'t read the event date "sometime".',
    "No date signed or booked.",
    'Couldn\'t read the contract total "TBD".',
  ]);
});

test("the template a studio can start from imports cleanly", () => {
  const [headers, ...rows] = parseCsv(spreadsheetTemplateCsv);
  const result = bookingFromSpreadsheetRow({
    row: 2,
    cells: rows[0]!,
    columns: detectColumns(headers!),
    timezone: "UTC",
  });
  assert.ok("booking" in result, JSON.stringify(result));
  assert.equal(result.booking.clients.length, 2);
  assert.equal(result.booking.photographers, 2);
  assert.equal(result.booking.taxCents, 42_900);
  assert.equal(result.notes.length, 0, "the template leaves nothing to guess");
});
