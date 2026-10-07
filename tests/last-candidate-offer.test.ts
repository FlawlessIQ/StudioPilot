import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { cascadeAssignment, LAST_CANDIDATE_LOCK_DAYS } from "../functions/src/crew/offer";
import { renderEmailTemplate } from "../functions/src/communications/email-templates";

/**
 * Conor's call, 2026-10-07: a crew offer to the last name on the list doesn't
 * expire into a dead end (GR's second shooter, 2026-10-06). It's held open to
 * the details lock; at the usual window they're reminded and Today says so.
 */

const read = (path: string) => readFileSync(path, "utf8");
const now = "2026-10-07T12:00:00.000Z";
const profile = { id: "albert", get: (key: string) => ({ email: "albert@example.com", name: "Albert", userId: null } as Record<string, unknown>)[key] } as never;
const offer = (candidateIds: string[], candidateIndex: number, arrivalAt = "2027-03-13T16:00:00.000Z") =>
  cascadeAssignment({
    id: "c1_offer_1",
    tenantId: "t1",
    cascadeId: "c1",
    candidateIndex,
    profile,
    cascade: { candidateIds, responseWindowHours: 24, arrivalAt, projectId: "p1", role: "Second photographer" },
    token: "x".repeat(43),
    now,
    actorId: "test",
  });

test("someone with a name after them keeps the usual window", () => {
  const prepared = offer(["albert", "vittor"], 0);
  assert.equal(prepared.expiresAt, "2026-10-08T12:00:00.000Z");
  assert.equal(prepared.remindAt, null);
  assert.equal(prepared.assignment.lastCandidate, false);
});

test("the last name is held open to the details lock and reminded at the window", () => {
  const prepared = offer(["albert"], 0);
  const lock = new Date(Date.parse("2027-03-13T16:00:00.000Z") - LAST_CANDIDATE_LOCK_DAYS * 86_400_000).toISOString();
  assert.equal(prepared.expiresAt, lock);
  assert.equal(prepared.assignment.inviteExpiresAt, lock);
  assert.equal(prepared.remindAt, "2026-10-08T12:00:00.000Z");
  // The email still asks for an answer by the usual time.
  assert.equal(prepared.emailJob.respondBy, "2026-10-08T12:00:00.000Z");
  // Inside the lock already: the usual window stands.
  assert.equal(offer(["albert"], 0, "2026-10-20T16:00:00.000Z").remindAt, null);
});

test("the reminder goes out once, the cascade says who it's waiting on, and Today shows it", () => {
  const commands = read("functions/src/crew/commands.ts");
  assert.match(commands, /await remindLastCandidate\(db, cascadeSnapshot\.ref, now\)/);
  assert.match(commands, /id: reminderId,\s*reminder: true,/);
  assert.match(commands, /currentRemindedAt: now,\s*waitingOn: \{/);
  const inbox = read("features/today/inbox.ts");
  assert.match(inbox, /title: `\$\{who\} hasn't answered`/);
  assert.match(inbox, /label: "Offer to someone else"/);
});

test("the reminder email says so", () => {
  const email = renderEmailTemplate({
    key: "crew_invitation",
    brand: { studioName: "GR Productions", productName: "StudioCue", accentColor: "#0f8a5e", logoUrl: null, contactEmail: null },
    recipientName: "Albert",
    projectName: "Dionne Rhodes Wedding",
    values: { reminder: true, role: "Second photographer", inviteUrl: "https://studio-cue.com/auth/crew-invite?token=abc", appUrl: "https://studio-cue.com" },
  });
  assert.match(email.subject, /^Reminder: Second photographer/);
  assert.match(email.text, /still holding it for you/);
  assert.match(email.text, /crew-invite\?token=abc/);
});
