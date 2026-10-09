import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { dateHeldByAnother, inquiryPipeline } from "../features/inquiries/pipeline.ts";

/**
 * What walking FlawlessIQ on production found on 2026-09-29: a test couple's
 * inquiry, reply, proposal, agreement and crew offer, with real email. Each of
 * these had passed every suite.
 */
const read = (path: string) => readFileSync(path, "utf8");

const job = (id: string, state: string, extra: Record<string, unknown> = {}) => ({
  id,
  tenantId: "t1",
  state,
  name: `${id} Wedding`,
  eventDate: "2027-06-12",
  createdAt: "2026-09-16T10:00:00Z",
  archivedAt: null,
  ...extra,
});

test("an inquiry stamped 'free' says booked once another job holds the date", () => {
  // Maya arrived while 12 Jun was free; a job awaiting signature took it later.
  const rows = inquiryPipeline({
    projects: [job("maya", "LEAD", { leadId: "l1" }), job("taken", "CONTRACT_PENDING")],
    leads: [{ id: "l1", projectId: "maya", status: "converted", availabilityStatus: "available" }],
    conversations: [],
  });
  assert.equal(rows.find((row) => row.id === "maya")!.availability, "conflict");
});

test("a job never conflicts with itself, and an inquiry does not hold a date", () => {
  const projects = [job("self", "PROPOSAL"), job("other-inquiry", "LEAD")];
  assert.equal(dateHeldByAnother(projects, "2027-06-12", "self"), false);
  assert.equal(dateHeldByAnother(projects, "2027-06-12", null), true);
  assert.equal(dateHeldByAnother([job("other-inquiry", "LEAD")], "2027-06-12", null), false);
  assert.equal(dateHeldByAnother(projects, null, null), false);
});

test("Today's inquiry card reads the date the same way", () => {
  const inbox = read("features/today/inbox.ts");
  assert.match(inbox, /dateHeldByAnother\(\s*rows\(input\.projects\),\s*typeof lead\.eventDate === "string" \? lead\.eventDate : null,/);
});

test("the inquiry form's 'things are missing' counts what is still missing", () => {
  const form = read("components/crm/lead-intake-form.tsx");
  // Live from `errors`, so it goes when the last one is fixed.
  assert.match(form, /const missingCount = Object\.keys\(errors\)\.length;/);
  assert.doesNotMatch(form, /setServerError\(\s*names\.length === 1/);
});

test("a double tap on Continue doesn't send step 3 unseen", () => {
  const form = read("components/crm/lead-intake-form.tsx");
  assert.match(form, /if \(Date\.now\(\) - stepShownAt\.current < 600\) return event\.preventDefault\(\);/);
  assert.match(form, /stepShownAt\.current = Date\.now\(\);/);
});

test("adding a crew member says it emails them", () => {
  assert.match(read("components/crew/create-crew-profile-form.tsx"), /Saving emails them an invitation/);
  assert.match(read("app/studio/crew/new/page.tsx"), /we&rsquo;ll email them an invitation/);
});

test("the proposal shows the couple's initials, not a hardcoded SC", () => {
  const workspace = read("components/proposals/studio-proposal-workspace.tsx");
  assert.doesNotMatch(workspace, /<span>SC<\/span>/);
  assert.match(workspace, /initialsOf\(text\(client\.displayName, "Client"\)\)/);
});

test("the couple's link stops offering a call once the proposal is out", () => {
  const server = read("functions/src/booking/public-scheduling.ts");
  assert.match(server, /return Boolean\(state\) && !\["LEAD", "CONSULTATION"\]\.includes\(state\);/);
  assert.match(server, /pastConsultation,/);
  // A new booking is refused; moving the one they have still works.
  assert.match(server, /if \(pastTheCall\(context\) && !\(await upcomingConsultation\(db, context\)\)\) \{/);
  const page = read("components/inquiries/couple-inquiry-page.tsx");
  assert.match(page, /: result\.pastConsultation\s*\? "moved_on"/);
  // And names what is actually waiting: an agreement out is not "your proposal".
  assert.match(server, /if \(state === "CONTRACT_PENDING"\) return "agreement";/);
  assert.match(page, /heading: "your agreement is ready to sign"/);
  // Cancelling no longer promises a new booking the link won't take.
  // The call by the studio's own name (tradeVocab): a photographer's "consultation".
  assert.match(page, /preview\.pastConsultation\s*\? `Cancel your \$\{callName\}\?`/);
  assert.match(page, /const callName = tradeWords\.consultation\.toLowerCase\(\);/);
});

test("the couple's link shows no stand-in studio while it loads", () => {
  assert.match(read("components/inquiries/couple-inquiry-page.tsx"), /<AppBar studio=\{preview \? brand : undefined\} \/>/);
});

test("the studio's input styles leave the mobile kit's fields alone", () => {
  // At 0,4,1 the .ds-root input rule out-ranked the kit: 12px padding under
  // the icon, and `font: inherit` below iOS's 16px no-zoom floor.
  const bridge = read("app/legacy-bridge.css");
  const rule = bridge.slice(bridge.indexOf("/* ---- Form controls"), bridge.indexOf("font: inherit;"));
  assert.match(rule, /\.ds-root input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\):not\(\[type="range"\]\):not\(\.kit-input\),/);
  assert.match(rule, /\.ds-root select:not\(\.kit-input\),/);
  assert.match(rule, /\.ds-root textarea:not\(\.kit-input\) \{/);
});
