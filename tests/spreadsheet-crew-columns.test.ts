import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bookingFromSpreadsheetRow,
  detectColumns,
  detectCrewColumns,
  parseCsv,
  spreadsheetTemplateFor,
  stateFromStatus,
  unusedColumns,
} from "../features/imports/spreadsheet";
import { assessExistingBooking, existingBookingSchema, importedCoverage, importedNamedCrew } from "../features/imports/existing-booking";

/**
 * The crew a real studio sends, read from the sheets studios actually keep
 * (docs/import-bookings-review-2026-10-26.md). Before this, "Lead
 * Photographer" (names) was read as the photographer *count* and blocked every
 * row, "Assistant Names" became the client, and assistants, second shooters
 * and DJs' assistants weren't read at all. Gabe (2026-10-23): every job he
 * imported came in with no videographer.
 */
function read(trade: string, csv: string, today = "2026-10-26") {
  const [headers, ...rows] = parseCsv(csv);
  const columns = detectColumns(headers!, trade);
  const crewColumns = detectCrewColumns(headers!, trade, rows);
  const keep = unusedColumns(headers!, columns, crewColumns);
  return rows.map((cells, index) =>
    bookingFromSpreadsheetRow({ row: index + 2, cells, columns, crewColumns, headers: headers!, keepInNotes: keep, timezone: "America/New_York", trade, today }),
  );
}
const booking = (result: ReturnType<typeof read>[number]) => {
  assert.ok("booking" in result, JSON.stringify(result));
  return existingBookingSchema.parse(result.booking);
};

test("a photo studio's lead, second shooter and videographers all come through", () => {
  const [maya, ana] = read(
    "photographer",
    `Client,Email,Wedding Date,Venue,Package,Total,Deposit Paid,Booked,Hours,Lead Photographer,Second Shooter,Videographers,Photo Booth
Maya & Theo Johnson,maya@x.com,06/12/2027,The Grove,Signature,6499,2000,03/02/2026,8,Gabe,Yes,2,Yes
Ana Ruiz,ana@x.com,2027-08-01,Hollow Oak,Essential,3200,960,2026-04-10,6,Sam,No,0,No`,
  );
  assert.deepEqual(booking(maya!).crew, [
    { role: "photographer", count: 2, names: ["Gabe"] },
    { role: "videographer", count: 2, names: [] },
  ]);
  assert.deepEqual(importedCoverage(booking(maya!)), [
    { role: "photographer", count: 2 },
    { role: "videographer", count: 2 },
  ]);
  assert.deepEqual(booking(ana!).crew, [{ role: "photographer", count: 1, names: ["Sam"] }]);
  // Nothing the sheet held is lost.
  assert.match(booking(maya!).notes ?? "", /Photo Booth: Yes/);
});

test("a hair studio's assistants: three on one wedding, two different ones on the next", () => {
  const [jess, priya] = read(
    "hair",
    `Bride,Email,Phone,Event Date,Location,Service,Total,Deposit,Booked On,Start Time,Stylists,Assistants,Assistant Names,Party Size
Jess Lee,jess@x.com,555-0101,2027-05-20,The Lodge,Bridal + 6,1450,300,2026-09-01,7:00 AM,1,3,"Kim, Tara, Joy",7
Priya Shah,,555-0102,2027-06-02,Hotel Ivy,Bridal + 3,980,200,2026-09-15,8:30 AM,1,2,"Tara, Mel",4`,
  );
  const first = booking(jess!);
  // The bride is the client; the assistants' names never are.
  assert.equal(`${first.clients[0]!.firstName} ${first.clients[0]!.lastName}`, "Jess Lee");
  assert.deepEqual(first.crew, [
    { role: "hair_stylist", count: 1, names: [] },
    { role: "hair_assistant", count: 3, names: ["Kim", "Tara", "Joy"] },
  ]);
  assert.equal(first.startTime, "07:00");
  // A morning, not a photographer's eight hours.
  assert.equal(first.coverageMinutes, 120);
  const second = booking(priya!);
  assert.deepEqual(second.crew?.[1], { role: "hair_assistant", count: 2, names: ["Tara", "Mel"] });
  // A phone-only bride imports; her portal waits for an email.
  assert.equal(second.clients[0]!.email, null);
  assert.deepEqual(
    assessExistingBooking(second, "2026-10-26").filter((issue) => issue.severity === "error"),
    [],
  );
  assert.deepEqual(
    importedNamedCrew(first).map((person) => `${person.label}: ${person.name}`),
    ["Hair assistant: Kim", "Hair assistant: Tara", "Hair assistant: Joy"],
  );
});

test("a DJ's assistant, and a DJ column of names, read as a DJ's crew", () => {
  const [park, ocean] = read(
    "dj",
    `Client Name,Email,Event Date,Event Type,Venue,Package,Contract Amount,Paid,Date Booked,Hours,DJ,Assistant,Uplighting,Team size
Sam & Alex Park,sam@x.com,09/18/2027,Wedding,Rosewood,Ceremony + Reception,2400,600,01/05/2026,6,Mike,Yes,12 uplights,2
Ocean HS,events@ocean.edu,2027-04-30,Prom,Ocean HS Gym,Prom Night,1800,900,2026-10-01,4,Dre,No,No,1`,
  );
  assert.deepEqual(booking(park!).crew, [
    { role: "dj", count: 1, names: ["Mike"] },
    { role: "dj_assistant", count: 1, names: [] },
  ]);
  assert.deepEqual(booking(ocean!).crew, [{ role: "dj", count: 1, names: ["Dre"] }]);
  assert.match(booking(park!).notes ?? "", /Uplighting: 12 uplights/);
});

test("a wedding sheet's DJ vendor column is never a photographer's crew", () => {
  const [row] = read(
    "photographer",
    `Client,Email,Wedding Date,Total,Booked,Photographers,DJ
Maya Johnson,maya@x.com,2027-06-12,6499,2026-03-02,2,DJ Mike`,
  );
  assert.deepEqual(booking(row!).crew, [{ role: "photographer", count: 2, names: [] }]);
  assert.match(booking(row!).notes ?? "", /DJ: DJ Mike/);
});

test("past jobs land where they are: by status, or by date with the studio's choice", () => {
  assert.equal(stateFromStatus("Delivered"), "DELIVERED");
  assert.equal(stateFromStatus("In editing"), "POST_PRODUCTION");
  assert.equal(stateFromStatus("Closed"), "CLOSED");
  assert.equal(stateFromStatus("Booked"), "BOOKED");
  const [delivered, undated] = read(
    "photographer",
    `Client,Email,Wedding Date,Total,Paid,Booked,Status,Gallery Link
Maya Johnson,maya@x.com,2026-06-12,6499,6499,2026-01-02,Delivered,https://maya.pixieset.com/wedding
Ana Ruiz,ana@x.com,2026-08-01,3200,3200,2026-02-10,,`,
  );
  const first = booking(delivered!);
  assert.equal(first.state, "DELIVERED");
  assert.equal(first.galleryUrl, "https://maya.pixieset.com/wedding");
  assert.deepEqual(assessExistingBooking(first, "2026-10-26").filter((issue) => issue.severity === "error"), []);
  // No status: a passed date is finished, and said to be assumed.
  const second = booking(undated!);
  assert.equal(second.state, "CLOSED");
  assert.ok(second.assumed?.includes("state"));
  // A DJ delivers nothing: a "Delivered" status is finished.
  const [dj] = read("dj", `Client,Email,Event Date,Total,Booked,Status\nSam Park,sam@x.com,2026-06-12,2400,2026-01-05,Delivered`);
  assert.equal(booking(dj!).state, "CLOSED");
});

test("each trade's template reads back with its own crew", () => {
  for (const [trade, roles] of [
    ["photographer", ["photographer", "videographer"]],
    ["dj", ["dj", "dj_assistant"]],
    ["hair", ["hair_stylist", "hair_assistant"]],
    ["makeup", ["makeup_artist", "makeup_assistant", "hair_stylist"]],
    ["planner", ["coordinator"]],
  ] as const) {
    const [row] = read(trade, spreadsheetTemplateFor(trade));
    assert.deepEqual(booking(row!).crew?.map((line) => line.role), [...roles], trade);
  }
});
