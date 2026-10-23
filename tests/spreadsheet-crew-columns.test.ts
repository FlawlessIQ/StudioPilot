import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bookingFromSpreadsheetRow,
  detectColumns,
  spreadsheetFieldLabel,
  spreadsheetTemplateCsv,
} from "../features/imports/spreadsheet";

/**
 * Gabe, 2026-10-23: every job he imported from a sheet came in with no
 * videographer — the import read photographers only. And a DJ with 100+ jobs
 * to bring over has a "DJs" column, not "Photographers".
 */
const headers = ["First name", "Last name", "Email", "Event date", "Contract total", "Date signed", "Photographers", "Video"];
const row = (video: string) => ["Maya", "Johnson", "maya@example.com", "2027-06-12", "6499", "2026-03-02", "2", video];
const parse = (video: string, trade: unknown = "photographer") =>
  bookingFromSpreadsheetRow({ row: 2, cells: row(video), columns: detectColumns(headers, trade), timezone: "America/New_York", trade });

test("a sheet's videographers come through, as a count or a yes/no", () => {
  const two = parse("2");
  assert.ok("booking" in two);
  assert.equal(two.booking.photographers, 2);
  assert.equal(two.booking.videographers, 2);
  const yes = parse("Yes");
  assert.ok("booking" in yes && yes.booking.videographers === 1);
  const no = parse("No");
  assert.ok("booking" in no && no.booking.videographers === undefined);
  assert.ok("problems" in parse("lots"));
});

test("the crew columns are in the studio's own words", () => {
  assert.equal(spreadsheetFieldLabel("photographers", "photographer"), "Photographers");
  assert.equal(spreadsheetFieldLabel("videographers", "photographer"), "Videographers");
  assert.equal(spreadsheetFieldLabel("photographers", "dj"), "DJs");
  // One crew role: no second column to map.
  assert.equal(spreadsheetFieldLabel("videographers", "dj"), null);
  assert.equal(detectColumns(["Name", "DJs"], "dj").photographers, 1);
});

test("a wedding sheet's DJ vendor column is never read as a count", () => {
  assert.equal(detectColumns(["Name", "Photographers", "DJ"], "photographer").photographers, 1);
  assert.equal(Object.values(detectColumns(["Name", "DJ"], "photographer")).includes(1), false);
});

test("the starting template has the videographers column", () => {
  assert.match(spreadsheetTemplateCsv.split("\n")[0]!, /Photographers,Videographers,Notes/);
});
