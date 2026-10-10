import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  rosterEnabled,
  rosterOffered,
  rosterOrder,
  rosterSummary,
  type Participant,
} from "../features/group-events/participants.ts";
import { billingHoldApplies } from "../functions/src/saas/billing-hold.ts";
import { renderEmailTemplate } from "../functions/src/communications/email-templates.ts";

const read = (path: string) => readFileSync(path, "utf8");

const person = (fields: Partial<Participant>): Participant => ({
  id: fields.id ?? "p",
  tenantId: "t",
  projectId: "job",
  parentName: "Dana Reyes",
  email: null,
  phone: null,
  athleteName: fields.athleteName ?? "Mia",
  team: null,
  packageName: null,
  amountCents: 4500,
  status: "unpaid",
  payment: null,
  receiptQueuedAt: null,
  createdAt: "2026-10-04T00:00:00Z",
  ...fields,
});

// ── The roster's arithmetic ──

test("the summary counts what was taken and what is still owed, leaving the cancelled out", () => {
  const summary = rosterSummary([
    person({ status: "paid", payment: { amountCents: 5000, method: "cash", paidAt: "x", recordedBy: "u" } }),
    person({ status: "unpaid", amountCents: 4500 }),
    person({ status: "pay_on_day", amountCents: 3000 }),
    person({ status: "cancelled", amountCents: 9999 }),
  ]);
  assert.deepEqual(summary, { total: 3, paid: 1, unpaid: 1, payOnDay: 1, cancelled: 1, collectedCents: 5000, outstandingCents: 7500 });
});

test("the roster lists who still owes first, then by athlete", () => {
  const order = rosterOrder([
    person({ athleteName: "Zoe", status: "paid" }),
    person({ athleteName: "ava", status: "unpaid" }),
    person({ athleteName: "Bea", status: "pay_on_day" }),
    person({ athleteName: "Cara", status: "unpaid" }),
    person({ athleteName: "Ann", status: "cancelled" }),
  ]).map((item) => item.athleteName);
  assert.deepEqual(order, ["ava", "Cara", "Bea", "Zoe", "Ann"]);
});

test("a roster is offered on sports jobs and kept wherever it was turned on", () => {
  assert.equal(rosterOffered({ eventKind: "sports" }), true);
  assert.equal(rosterOffered({ eventKind: "wedding" }), false);
  assert.equal(rosterOffered({ eventKind: "wedding", groupEvent: { enabled: true } }), true);
  assert.equal(rosterOffered(null), false);
  assert.equal(rosterEnabled({ groupEvent: { enabled: true } }), true);
  assert.equal(rosterEnabled({ eventKind: "sports" }), false, "offered is not the same as on");
});

// ── The server ──

test("the five commands go through crmCommand, each checking the job and leaving a receipt", () => {
  const crm = read("functions/src/crm/commands.ts");
  for (const type of ["setGroupEvent", "addParticipant", "updateParticipant", "cancelParticipant", "recordParticipantPayment"]) {
    assert.match(crm, new RegExp(`type: z\\.literal\\("${type}"\\)`), type);
    const branch = crm.slice(crm.indexOf(`if (command.type === "${type}")`));
    const body = branch.slice(0, branch.indexOf("return output;"));
    assert.match(body, /hasProjectAccess\(membershipData, command\.input\.projectId\)/, `${type} checks assignment`);
    assert.match(body, /transaction\.create\(commandReference/, `${type} records a receipt`);
    assert.match(body, /participantAudit\(/, `${type} is audited`);
  }
});

test("a participant keeps no child's details: the athlete is a name and a team", () => {
  const crm = read("functions/src/crm/commands.ts");
  const fields = crm.slice(crm.indexOf("const participantFields = {"), crm.indexOf("};", crm.indexOf("const participantFields = {")));
  assert.doesNotMatch(fields, /\b(birth\w*|dob|age|athleteEmail|athletePhone|photo\w*)\b/i);
  assert.match(fields, /athleteName:/);
});

test("money already taken is never undone by a click", () => {
  const crm = read("functions/src/crm/commands.ts");
  assert.match(crm, /if \(!command\.input\.restore && participant\.get\("status"\) === "paid"\) throw new Error\("PARTICIPANT_PAID"\);/);
  assert.match(crm, /if \(participant\.get\("status"\) === "paid"\) throw new Error\("PARTICIPANT_ALREADY_PAID"\);/);
});

test("a subscription refusal says which one, on every endpoint that used to say 'start your trial'", () => {
  for (const file of ["functions/src/crm/commands.ts", "functions/src/workflow/commands.ts", "functions/src/integrations/commands.ts", "functions/src/integrations/quickbooks-setup.ts"]) {
    assert.doesNotMatch(read(file), /\} catch \{\s*response\.status\(402\)\.json\(\{ error: "ACTIVE_SUBSCRIPTION_REQUIRED" \}\)/, file);
  }
});

// ── The receipt ──

test("the parent's receipt names the payment, the athlete and the studio", () => {
  const rendered = renderEmailTemplate({
    key: "participant_receipt",
    brand: { studioName: "GR Productions", productName: "StudioCue", accentColor: null, logoUrl: null, replyTo: null } as never,
    recipientName: "Dana Reyes",
    projectName: "Spring Cheer Classic",
    values: { amountText: "$45.00", methodText: "in cash", athleteName: "Mia", packageName: "Digital set" },
  });
  assert.match(rendered.subject, /Your receipt from GR Productions/);
  assert.match(rendered.text, /received \$45\.00 in cash for Mia's photos \(Digital set\)/);
  assert.doesNotMatch(rendered.text, /wedding|couple/i);
});

test("a receipt still reaches the parent if the studio's billing lapses", () => {
  assert.equal(billingHoldApplies("emailJobs", "participant_receipt"), false);
});

// ── Data handling ──

test("participants are readable by the studio and its crew on the event, written only by the server, exported and purged with the job", () => {
  const rules = read("firestore.rules");
  const block = rules.slice(rules.indexOf("match /eventParticipants/{participantId}"), rules.indexOf("match /crewMessages/{messageId}"));
  assert.match(block, /allow write: if false;/);
  assert.match(block, /hasRole\(resource\.data\.tenantId, \["studio_owner","studio_admin"\]\)/);
  // Crew read only the event they're assigned to; the organiser (the job's client) never.
  assert.match(block, /"subcontractor"\]\)\s*&& isAssignedToProject\(resource\.data\.tenantId, resource\.data\.projectId\)/);
  assert.doesNotMatch(block, /"client"/);
  assert.match(read("functions/src/saas/data-lifecycle.ts"), /"eventParticipants",/);
  for (const file of ["functions/src/projects/purge-policy.ts", "features/projects/purge-policy.ts"]) {
    assert.match(read(file), /eventParticipants: \{ one: "participant", many: "participants" \}/, file);
  }
});

// ── The screen ──

test("the job page shows the roster beside the crew on desktop and phone, reading only this job's people", () => {
  const page = read("components/projects/live-project-detail.tsx");
  assert.equal(page.match(/<ParticipantRoster project=\{project\} projectId=\{projectId\} tenantId=\{workspace\.tenantId\} \/>/g)?.length, 2);
  const roster = read("components/group-events/participant-roster.tsx");
  assert.match(roster, /where\("tenantId", "==", tenantId\),[\s\S]{0,120}where\("projectId", "==", projectId\)/);
  // Compact rows, never expanded cards on a phone.
  assert.match(roster, /className="participant-roster-list"/);
});
