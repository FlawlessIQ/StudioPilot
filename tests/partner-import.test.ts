import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseCsv } from "../features/imports/spreadsheet.ts";
import {
  PARTNER_EXPORT_HEADER,
  detectPartnerColumns,
  nextFreeCode,
  partnerCodeStem,
  partnerExportRows,
  partnerTypeFromLabel,
  planPartnerImport,
} from "../features/console/partner-import.ts";

/**
 * Partner codes in bulk (Conor, 2026-10-13): Gabe's sheet of 200 partners in,
 * a code for each, and the file back out with signup links for Muse.
 */

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("columns are matched by meaning, and Business name never lands on Name", () => {
  const columns = detectPartnerColumns(["Business Name", "Contact", "E-mail", "Vendor Type", "Referral Code", "Venmo"]);
  assert.deepEqual(columns, { name: 1, business: 0, email: 2, type: 3, code: 4, payoutHandle: 5 });
  assert.deepEqual(detectPartnerColumns(["First Name", "Last Name", "Company"]), { firstName: 0, lastName: 1, business: 2 });
});

test("vendor types from the words a sheet uses", () => {
  assert.equal(partnerTypeFromLabel("Wedding Planner"), "planner");
  assert.equal(partnerTypeFromLabel("Day-of coordinator"), "planner");
  assert.equal(partnerTypeFromLabel("DJ / MC"), "dj");
  assert.equal(partnerTypeFromLabel("MUA"), "makeup");
  assert.equal(partnerTypeFromLabel("Hair & Makeup"), "hair");
  assert.equal(partnerTypeFromLabel("Florist"), "other");
  assert.equal(partnerTypeFromLabel(""), "other");
});

test("a blank code is made from the business, else the name, within the limits", () => {
  assert.equal(partnerCodeStem({ name: "Bella Rossi", business: "Bella Bridal Beauty LLC", type: "makeup" }), "BELLABRIDALBEAUT");
  assert.equal(partnerCodeStem({ name: "Mike Ortiz", business: null, type: "dj" }), "MIKEORTIZ");
  assert.equal(partnerCodeStem({ name: "Al", business: "The Events Co", type: "planner" }), "THEEVENTSCO");
  assert.equal(partnerCodeStem({ name: "Jo", business: null, type: "dj" }), "JODJ");
  assert.equal(nextFreeCode("MIKE", (code) => ["MIKE", "MIKE2"].includes(code)), "MIKE3");
  assert.equal(nextFreeCode("ABCDEFGHIJKLMNOPQRST", (code) => code === "ABCDEFGHIJKLMNOPQRST").length, 20);
});

test("a 200-row sheet: codes made, clashes numbered, existing skipped, bad rows named", () => {
  const lines = ["Name,Business,Email,Type,Code"];
  for (let n = 0; n < 200; n += 1) lines.push(`Person ${n},Glam Squad,p${n}@example.com,Makeup,`);
  const plan = planPartnerImport(lines.join("\n"), []);
  const ready = plan.rows.filter((row) => row.status === "ready");
  assert.equal(ready.length, 200);
  const codes = ready.map((row) => (row.status === "ready" ? row.partner.code : ""));
  assert.equal(new Set(codes).size, 200, "every code unique");
  assert.deepEqual(codes.slice(0, 3), ["GLAMSQUAD", "GLAMSQUAD2", "GLAMSQUAD3"]);
  assert.ok(ready.every((row) => row.status === "ready" && row.partner.codeMade && row.partner.type === "makeup"));

  const mixed = planPartnerImport(
    [
      "Name,Business,Email,Code",
      "Sarah Lee,,sarah@example.com,",
      "Taken Already,,taken@example.com,",
      ",,,ZZ",
      "X,,nope,",
      "Dana,,dana@example.com,sarah lee",
      "Old Code,,,OLDCODE",
      "Dup,,sarah@example.com,",
    ].join("\n"),
    [{ code: "TAKENALREADY", email: "taken@example.com" }, { code: "OLDCODE" }],
  );
  const byLine = new Map(mixed.rows.map((row) => [row.line, row]));
  // Dana asked for SARAHLEE in the sheet, so Sarah's made code steps aside.
  assert.equal(byLine.get(2)?.status === "ready" && byLine.get(2)?.partner.code, "SARAHLEE2");
  assert.equal(byLine.get(3)?.status, "exists");
  assert.equal(byLine.get(4)?.status, "problem");
  assert.equal(byLine.get(5)?.status, "problem");
  const dana = byLine.get(6);
  assert.ok(dana?.status === "ready" && dana.partner.code === "SARAHLEE" && !dana.partner.codeMade);
  assert.equal(byLine.get(7)?.status, "exists", "a code that is already a partner's is skipped, so an exported file can go back in");
  assert.equal(byLine.get(8)?.status, "problem", "same email twice in the sheet");
});

test("the file back out carries the code, the signup link and the offer", () => {
  const [row] = partnerExportRows("https://studio-cue.com/", [{ code: "SARAHMUA", name: "Sarah Lee", business: "Sarah Lee Makeup", type: "makeup", owedCents: -500 }]);
  assert.equal(row?.length, PARTNER_EXPORT_HEADER.length);
  assert.equal(row?.[PARTNER_EXPORT_HEADER.indexOf("Signup link")], "https://studio-cue.com/auth/register?code=SARAHMUA");
  assert.match(String(row?.[PARTNER_EXPORT_HEADER.indexOf("What a photographer gets")]), /14 days free/);
  assert.equal(row?.[PARTNER_EXPORT_HEADER.indexOf("Owed ($)")], 0);
  // An exported file reads straight back in as "already partners".
  const csv = [PARTNER_EXPORT_HEADER.join(","), row!.map((cell) => `"${String(cell)}"`).join(",")].join("\n");
  assert.equal(parseCsv(csv).length, 2);
  assert.equal(planPartnerImport(csv, [{ code: "SARAHMUA" }]).rows[0]?.status, "exists");
});

test("the Console makes them in chunks through one audited command", () => {
  const handler = read("functions/src/console/handlers/partners.ts");
  assert.match(handler, /createPartners: consoleHandler\(\{\s*capability: "codes\.write"/);
  assert.match(handler, /row\.codeMade \? 20 : 1/, "only a made code may be renumbered");
  const drawer = read("components/console/pages/partner-import-drawer.tsx");
  assert.match(drawer, /"createPartners"/);
  assert.match(drawer, /PARTNER_IMPORT_CHUNK/);
  assert.match(read("components/console/pages/partners-tab.tsx"), /Export with signup links/);
});
