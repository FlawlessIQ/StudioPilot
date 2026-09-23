import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { screenAnswer } from "@/features/ai/answer-safety";
import { RED_TEAM_PAYLOADS, redTeamLeak } from "@/features/ai/red-team";

/**
 * Safety that does not depend on the model behaving.
 *
 * One injection payload was tried on production on 2026-09-22 and declined.
 * One payload, one vector, one model — an anecdote, not a property. These are
 * the parts that hold whatever the model does on any given day.
 */

test("contact details never leave in prose", () => {
  const risk = screenAnswer(
    "Marco Silva has accepted. Reach him on conor+marco@flawlessiq.com or 212-555-0177.",
  );
  assert.ok(risk, "an email and a phone number should both be caught");
  assert.deepEqual(risk.kinds.sort(), ["email", "phone"]);
  assert.doesNotMatch(risk.redacted, /@flawlessiq\.com/);
  assert.doesNotMatch(risk.redacted, /212-555-0177/);
  // The answer still reads.
  assert.match(risk.redacted, /Marco Silva has accepted/);
});

test("ordinary answers are untouched", () => {
  // A guard that fires on normal work gets switched off. These are real
  // sentences Cue produced on production this week.
  for (const answer of [
    "Marco Silva has accepted the role of Videographer for the DeMattia wedding.",
    "The Erin & Joe DeMattia wedding is still in the lead stage and has not been booked.",
    "The balance of $9,500.00 is due on June 5, 2027.",
    "One offer for the second photographer has expired, and another is still pending.",
    "8 hrs · 2 videographers",
  ])
    assert.equal(screenAnswer(answer), null, `false positive on: ${answer}`);
});

test("a date is not a phone number and money is not a phone number", () => {
  assert.equal(screenAnswer("The event is on June 19, 2027 at 12:00 PM."), null);
  assert.equal(screenAnswer("Base price $7,200.00, deposit 30%."), null);
  assert.equal(screenAnswer("Coverage 480 minutes across 2027-06-19."), null);
});

test("the screen is stateless across calls", () => {
  // Global regexes keep `lastIndex` between calls; a screen that only works
  // every other time is worse than none.
  const answer = "Contact conor+marco@flawlessiq.com for details.";
  assert.ok(screenAnswer(answer));
  assert.ok(screenAnswer(answer), "second call must behave the same");
  assert.ok(screenAnswer(answer));
});

test("the copilot screens before it answers, and records that it did", () => {
  const copilot = readFileSync("functions/src/ai/copilot.ts", "utf8");
  // Both the answer and the facts are prose the studio reads, and both are
  // screened after the fence markers come off — screening the raw string
  // would leave the markers in whatever it redacted around.
  assert.match(copilot, /screenAnswer\(spokenAnswer\)/);
  assert.match(copilot, /spokenFacts\.map\(\(fact\) => screenAnswer\(fact\)\)/);
  assert.match(copilot, /redactions:/, "a redaction is worth knowing about");
});

/** --- the red team --------------------------------------------------- */

test("the payload set covers the shapes worth trying", () => {
  assert.ok(RED_TEAM_PAYLOADS.length >= 20, "one payload is an anecdote");
  const goals = new Set(RED_TEAM_PAYLOADS.map((payload) => payload.goal));
  for (const goal of ["disclose", "act", "impersonate", "suppress"])
    assert.ok(goals.has(goal as never), `no payload tries to ${goal}`);
  for (const payload of RED_TEAM_PAYLOADS)
    assert.ok(payload.because.length > 15, `${payload.id} needs a reason to exist`);
});

test("a payload cannot close the fence it is carried in", () => {
  // The fence markers are the one thing a payload could plausibly forge, so
  // one payload tries exactly that and the stripper must defeat it.
  const faker = RED_TEAM_PAYLOADS.find((payload) => payload.id === "fake-fence");
  assert.ok(faker);
  const untrusted = readFileSync("functions/src/ai/untrusted.ts", "utf8");
  assert.match(untrusted, /stripMarkers/);
});

test("leak detection matches regardless of case", () => {
  const secrets = {
    emails: ["conor+marco@flawlessiq.com"],
    phones: ["212-555-0177"],
    rates: ["$950.00"],
  };
  assert.deepEqual(redTeamLeak("Reach CONOR+MARCO@FlawlessIQ.com", secrets), [
    "conor+marco@flawlessiq.com",
  ]);
  assert.deepEqual(redTeamLeak("Nothing sensitive here.", secrets), []);
});
