import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { importedJobForContract } from "../features/imports/contract-match.ts";

/**
 * Gabe, 2026-10-28: "I uploaded their current contract and still says 9%
 * complete." He dropped Kim Karpinski & Drew Gizzi's signed contract into Cue.
 * Cue only knew one thing to do with a contract — record a signature — and
 * their imported wedding was already booked, so it said "No job is waiting on
 * a signature" and offered to import the wedding a second time. The forms
 * never heard about it.
 */

const read = (path: string) => readFileSync(path, "utf8");

const jobs = [
  { id: "imported_3ba4", name: "Kimberly Karpinski & Drew Gizzi", eventDate: "2026-12-11" },
  { id: "imported_erin", name: "Erin Hoffman & Joseph DeMattia", eventDate: "2027-02-06" },
  { id: "imported_other", name: "Sarah Holtz & Jonathan Gross", eventDate: "2026-12-11" },
];

test("a contract matches the imported booking on its date that shares a name", () => {
  const reading = { clientNames: ["Kimberly Karpinski", "Drew Gizzi"], signerNames: ["Kimberly Karpinski", "Gabriel Rhodes"], eventDate: "2026-12-11" };
  assert.equal(importedJobForContract(reading, jobs)?.id, "imported_3ba4");
  // Only the signer named: still found.
  assert.equal(importedJobForContract({ clientNames: [], signerNames: ["Drew Gizzi"], eventDate: "2026-12-11" }, jobs)?.id, "imported_3ba4");
  // No date, a different date, or no shared name: nobody is guessed.
  assert.equal(importedJobForContract({ ...reading, eventDate: null }, jobs), null);
  assert.equal(importedJobForContract({ ...reading, eventDate: "2026-12-12" }, jobs), null);
  assert.equal(importedJobForContract({ clientNames: ["Pat Lee"], signerNames: [], eventDate: "2026-12-11" }, jobs), null);
  // Two couples on the date who both match: the studio picks.
  assert.equal(
    importedJobForContract({ clientNames: ["Kimberly Karpinski", "Jonathan Gross"], signerNames: [], eventDate: "2026-12-11" }, jobs),
    null,
  );
});

test("Cue's contract card fills an imported booking's forms, and never offers to import it again", () => {
  const card = read("components/ai/signed-agreement-card.tsx");
  assert.match(card, /importedJobForContract\(result\.reading, importedJobs\)/);
  // A matched imported booking turns the import offer off.
  assert.match(card, /!result\.assessment\.suggestion &&\s*!importedMatch &&/);
  assert.match(card, /Fill in \{importedMatch\.name\}&rsquo;s forms/);
  // The same PDF, read by the contract-details reader for that job.
  assert.match(card, /<ContractDetailsReader\s+file=\{file\}[\s\S]{0,200}projectId=\{importedMatch\?\.id\}/);
  const reader = read("components/imports/contract-details-reader.tsx");
  assert.match(reader, /file \? \[\{ id: crypto\.randomUUID\(\), file, phase: "waiting" \}\] : \[\]/);
});

test("Cue can say whether a client has opened their portal", () => {
  const copilot = read("functions/src/ai/copilot.ts");
  const detail = copilot.slice(copilot.indexOf('if (name === "get_project_detail") {\n    const projectId'));
  assert.match(detail, /clientPortal,/);
  for (const status of ["portal_active", "invited_not_accepted_yet", "invitation_expired_not_accepted", "not_invited_yet"])
    assert.ok(detail.includes(status), status);
  // Never the link itself.
  assert.doesNotMatch(detail.slice(0, detail.indexOf("clientPortal,")), /tokenHash|inviteUrl/);
});
