import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * What a studio that imported its book could not do.
 *
 * The reference studio imported a year of signed weddings on 2026-09-19 and
 * hit three walls in one evening: nowhere to file the PDFs he had already
 * signed, no sign anywhere on a job of who he had staffed on it, and a panel
 * announcing "No proposal is on file" on every single one of them.
 *
 * Asserted against source: these are render conditions inside "use client"
 * components that pull in Firebase, so there is no seam to call. Same approach
 * as tests/cue-action-turn.test.ts.
 */
const read = (path: string) => readFileSync(`${process.cwd()}/${path}`, "utf8");

// --- G1: filing the contract he already signed ---------------------------

const booking = read("components/booking/project-booking-workspace.tsx");

/**
 * `RecordSignedAgreement` is rendered as `{proposal ? … : null}` at both of
 * its call sites, and an import creates no proposal — so the only upload in
 * the product was hidden on every imported job. The new control must not be
 * behind that same condition.
 */
test("the signed copy can be attached to a job that has no proposal", () => {
  assert.match(booking, /const canAttachSignedCopy =/);
  const gate = booking.slice(
    booking.indexOf("const canAttachSignedCopy ="),
    booking.indexOf("const contractComplete"),
  );
  assert.doesNotMatch(gate, /proposal/, "it must not depend on a proposal");
  assert.match(gate, /importedContract/);
  assert.match(gate, /signedDocumentId/, "an attached copy must close the slot");
});

test("it is offered only where the studio's own attestation is the authority", () => {
  assert.match(
    booking,
    /completionAuthority[\s\S]{0,40}"imported"/,
    "attaching paper to a live signing flow would compete with the provider",
  );
});

test("attaching refreshes the record rather than leaving a stale page", () => {
  const site = booking.slice(booking.indexOf("<AttachSignedCopy"));
  assert.match(site.slice(0, 400), /refreshTenantRecords\(/);
  assert.match(site.slice(0, 400), /void load\(\)/);
});

/** It files evidence; it does not decide anything about the booking. */
test("the control routes to the imported command, not the booking gate", () => {
  const source = read("components/booking/attach-signed-copy.tsx");
  assert.match(source, /attachSignedCopyToImportedBooking/);
  // Below the header comment, which explains why it is not the other command.
  const body = source.slice(source.indexOf("export function AttachSignedCopy"));
  assert.doesNotMatch(body, /recordSignedAgreement/);
  const client = read("lib/booking/command-client.ts");
  assert.match(client, /type: "attachImportedSignedCopy"/);
  // The prefix the command validates, so one couple's paper cannot be filed
  // against another's job.
  assert.match(client, /tenants\/\$\{tenantId\}\/projects\/\$\{input\.projectId\}\/contracts\//);
});

// --- G4: who is on this job ---------------------------------------------

const detail = read("components/projects/live-project-detail.tsx");

/**
 * "I can't see anywhere where my staff is for this job." The page already
 * loaded `crewAssignments` and never named anybody from them, which is also
 * why he doubted the copilot staffing had worked at all.
 */
test("the job page names the crew it has already loaded", () => {
  assert.match(detail, /function ProjectCrewPanel\(/);
  assert.match(detail, /<ProjectCrewPanel[\s\S]{0,120}assignments=\{related\.crewAssignments\}/);
});

test("it shows an answer for every live offer, not only accepted ones", () => {
  const panel = detail.slice(
    detail.indexOf("function ProjectCrewPanel("),
    detail.indexOf("function ProjectCrewPanel(") + 3000,
  );
  for (const status of ["draft", "invited", "viewed", "accepted"])
    assert.ok(panel.includes(`"${status}"`), `${status} is not counted as live`);
  assert.match(panel, /Waiting on them/);
  assert.match(panel, /Nobody is booked on this job yet/);
  // A lapsed offer is not staffing, and saying so is what stops the studio
  // wondering whether the offer it remembers is still out.
  assert.match(panel, /lapsed/);
});

test("the panel sits above the disclosure, not inside it", () => {
  assert.ok(
    detail.indexOf("<ProjectCrewPanel") <
      detail.indexOf('<details className="project-detail-disclosure">'),
    "crew must not be hidden behind More detail",
  );
});

// --- G7: an imported job is not a job missing a proposal -----------------

const autopilot = read("components/booking/booking-autopilot-workspace.tsx");

test("a job booked elsewhere is stated as a fact, not as an absence", () => {
  const quiet = autopilot.indexOf("Booked outside StudioCue — no proposal needed.");
  assert.ok(quiet > 0, "the imported case must not open with what is missing");
  // Flat treatment, like the accepted-proposal note, rather than a card.
  const section = autopilot.lastIndexOf('className="booking-autopilot-empty is-quiet"', quiet);
  assert.ok(section > 0 && quiet - section < 400, "it must use the quiet card");
});

test("it offers no action, because the command would refuse one", () => {
  const start = autopilot.indexOf("Booked outside StudioCue — no proposal needed.");
  const block = autopilot.slice(start, autopilot.indexOf("</section>", start));
  assert.doesNotMatch(block, /<Link/, "there is nothing to prepare on a booked job");
});

test("a job that can still take a proposal is still asked for one", () => {
  assert.match(autopilot, /No proposal is on file for this job\./);
  const start = autopilot.indexOf("No proposal is on file for this job.");
  const block = autopilot.slice(start, autopilot.indexOf("</section>", start));
  assert.match(block, /Prepare the proposal/);
});

test("the quiet card is actually styled, not just labelled", () => {
  assert.match(read("app/globals.css"), /\.booking-autopilot-empty\.is-quiet\s*\{/);
});
