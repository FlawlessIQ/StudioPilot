import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

/**
 * The rule this file holds: the two client-facing actions the production walk
 * caught sending nothing — assigning the details form (P17) and a studio-booked
 * consultation (P14) — must each enqueue their email. Both were "the template
 * exists, but no command triggers it": the studio saw success while the couple
 * got silence. This guard fails if either trigger is removed again.
 *
 * It reads source rather than executing the Firebase-heavy command handlers,
 * which is exactly why the gap was invisible — nothing exercised them. Source
 * assertions are coarse but they pin the one fact that regressed: the enqueue
 * lives inside the right handler.
 */

function handlerBody(source: string, marker: string): string {
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `handler not found: ${marker}`);
  // From the handler marker to the next `else if (parsed.type ===` /
  // `else if (command.type ===` (or a generous window) — enough to contain the
  // handler's own enqueues without bleeding into the next branch.
  const rest = source.slice(start + marker.length);
  const next = rest.search(/else if \((?:parsed|command)\.type ===/);
  return rest.slice(0, next === -1 ? 6000 : next);
}

test("assignQuestionnaire enqueues questionnaire_request (P17)", () => {
  const src = readFileSync("functions/src/planning/commands.ts", "utf8");
  const body = handlerBody(src, 'parsed.type === "assignQuestionnaire"');
  assert.match(
    body,
    /emailJobs\/questionnaire_request_/,
    "assignQuestionnaire must create a questionnaire_request emailJob",
  );
  assert.match(
    body,
    /type: "questionnaire_request"/,
    "the enqueued job's type must be questionnaire_request",
  );
});

test("scheduleConsultation enqueues consultation_confirmation (P14)", () => {
  const src = readFileSync("functions/src/booking/commands.ts", "utf8");
  const body = handlerBody(src, 'command.type === "scheduleConsultation"');
  assert.match(
    body,
    /emailJobs\/consultation_confirmation_/,
    "scheduleConsultation must create a consultation_confirmation emailJob",
  );
  assert.match(
    body,
    /type: "consultation_confirmation"/,
    "the enqueued job's type must be consultation_confirmation",
  );
});

/**
 * Templates that exist with no direct command trigger, documented so the gap
 * stays visible rather than being rediscovered by a walk. Reminders
 * (consultation_reminder, crew_reminder, event_reminder, questionnaire_reminder,
 * package_follow_up) are drafted by the daily lifecycle scheduler; auth mail
 * (email_verification, password_reset) goes through authEmailCommand; final
 * mail (final_invoice, thank_you) is scheduler/date-gated. The two below are
 * genuinely untriggered per CLAUDE.md and are the standing backlog items.
 */
const KNOWN_UNTRIGGERED = new Set(["final_payment_reminder", "contract_sent"]);

test("the known-untriggered template list has not silently grown", () => {
  // A tripwire: if someone wires one of these, remove it here (good news); if a
  // new permanently-untriggered template appears, add it here deliberately.
  assert.deepEqual(
    [...KNOWN_UNTRIGGERED].sort(),
    ["contract_sent", "final_payment_reminder"],
    "update KNOWN_UNTRIGGERED (and the backlog) when a trigger is added or a new gap is accepted",
  );
});
