import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  dueLifecycleMessages,
  resolveLifecycleSettings,
} from "@/features/messaging/lifecycle";

/**
 * An imported booking reaches nobody until the studio brings the couple in.
 *
 * There is no single place to hold that back. The automations that reach a
 * couple are spread across schedulers, a trigger-driven rules engine, a job
 * worker and a payment runner, each written for live bookings and none of them
 * asking where a booking came from. So each one checks, and this test names
 * every one. The risk it guards is the next automation somebody adds: a new
 * scheduler that emails booked couples will email a couple who booked last
 * year, the morning after their studio imports them.
 */
const read = (path: string) => readFileSync(`${process.cwd()}/${path}`, "utf8");

test("the catch-up scheduler drafts nothing for a quiet couple", () => {
  // Ten days out: every thirty-day and one-day message is already due, which is
  // exactly what an import would otherwise be handed on its first morning.
  const project = {
    id: "p",
    tenantId: "t",
    state: "BOOKED",
    eventDate: "2026-09-27",
  };
  // Every lifecycle message switched on, starting from the studio defaults.
  const settings = structuredClone(resolveLifecycleSettings(undefined));
  for (const trigger of Object.keys(settings))
    (settings as Record<string, { enabled: boolean }>)[trigger]!.enabled = true;

  assert.ok(
    dueLifecycleMessages({ project, settings, today: "2026-09-17" }).length > 0,
    "the premise: a live booking this close has messages due",
  );
  assert.deepEqual(
    dueLifecycleMessages({
      project: { ...project, clientAutomationsPausedAt: "2026-09-17T14:00:00.000Z" },
      settings,
      today: "2026-09-17",
    }),
    [],
  );
});

const guarded: Array<[string, string, RegExp]> = [
  [
    "lifecycle scheduler passes the pause through",
    "functions/src/communications/lifecycle-scheduler.ts",
    /clientAutomationsPausedAt:/,
  ],
  [
    "lifecycle core (functions copy) honours it",
    "functions/src/communications/lifecycle-core.ts",
    /clientAutomationsPausedAt === "string"\) return \[\]/,
  ],
  [
    "final invoice scheduler skips a quiet booking",
    "functions/src/operations/invoice-scheduler.ts",
    /if \(clientAutomationsPaused\(project\.data\(\)\)\) continue;/,
  ],
  [
    "workflow rules don't fire for a quiet booking",
    "functions/src/automation/runtime.ts",
    /if \(clientAutomationsPaused\(project\.data\(\)\)\) \{/,
  ],
  [
    "autopay never charges a quiet booking",
    "functions/src/billing/autopay.ts",
    /if \(clientAutomationsPaused\(project\.data\(\)\)\) continue;/,
  ],
  [
    "questionnaire reminders skip a quiet booking",
    "functions/src/planning/questionnaire-reminder-scheduler.ts",
    /if \(clientAutomationsPaused\(project\.data\(\)\)\) continue;/,
  ],
  [
    "the email sender holds automated mail for a quiet booking",
    "functions/src/operations/jobs.ts",
    /clientAutomationEmailTypes\.includes\(type\)/,
  ],
  [
    "an imported booking never gets \"You're booked\"",
    "functions/src/operations/provider-runtime.ts",
    /if\(!project\.get\("importedAt"\)\)batch\.set\(db\.doc\(`emailJobs\/booking_confirmation_/,
  ],
];

for (const [name, path, pattern] of guarded) {
  test(name, () => {
    assert.match(read(path), pattern, `${path} no longer holds back a quiet couple`);
  });
}

test("the email sender checks before it resolves anyone to send to", () => {
  const jobs = read("functions/src/operations/jobs.ts");
  const start = jobs.indexOf("async function sendEmail(");
  const body = jobs.slice(start, jobs.indexOf("\n}\n", start));
  assert.ok(
    body.indexOf("clientAutomationsPaused(") < body.indexOf("recipientFor("),
    "the hold must come before anything is rendered or addressed",
  );
});

test("an import never walks the live booking path", () => {
  const commands = read("functions/src/imports/commands.ts");
  const code = commands
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1");
  const start = code.indexOf("export async function importExistingBooking(");
  const body = code.slice(start, code.indexOf("export async function attachImportedSignedCopy("));
  // Each of these exists to act on a live booking, and would email the couple.
  for (const forbidden of [
    "bookingOrchestrations",
    "complete_booking_side_effects",
    "recordSignedAgreement",
    "recordRetainerPayment",
    "runBookingGate",
    "emailJobs",
  ])
    assert.ok(!body.includes(forbidden), `the import touches ${forbidden}`);
  // And it records its evidence as what it is.
  assert.match(read("functions/src/imports/existing-booking.ts"), /completionAuthority: "imported"/);
});

test("the booking gate reads an imported contract as the studio's word, not a provider's", () => {
  for (const path of [
    "functions/src/booking/commands.ts",
    "functions/src/booking/orchestration.ts",
  ]) {
    const source = read(path);
    assert.doesNotMatch(
      source,
      /get\("completionAuthority"\) === "manual_attested"/,
      `${path} still treats only manual attestation as the studio's word`,
    );
    assert.match(source, /studioVouchedAuthorities\.includes\(/);
  }
});
