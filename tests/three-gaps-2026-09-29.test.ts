import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * Three dead ends found while giving Cue every studio action (2026-09-29).
 * Each was a control the app offered and the server, or the screen, never let
 * work. These hold the shape of the fixes; the emulator walk exercised them.
 */

const booking = readFileSync("functions/src/booking/commands.ts", "utf8");
const orchestration = readFileSync("functions/src/booking/orchestration.ts", "utf8");
const planning = readFileSync("functions/src/planning/commands.ts", "utf8");
const portalRoute = readFileSync("app/api/client/portal/route.ts", "utf8");
const clientSchedule = readFileSync("components/client/kit/client-schedule.tsx", "utf8");
const communications = readFileSync("functions/src/communications/commands.ts", "utf8");
const inbox = readFileSync("components/communications/message-inbox.tsx", "utf8");
const approvals = readFileSync("components/communications/message-approvals.tsx", "utf8");

const branch = (source: string, type: string) => {
  const start = source.indexOf(`command.type === "${type}"`);
  assert.ok(start > 0, `no ${type} branch`);
  return source.slice(start, source.indexOf("} else if (command.type ===", start + 10));
};

test("a retainer owed after booking on an exception can be recorded", () => {
  const retainer = branch(booking, "recordRetainerPayment");
  assert.match(retainer, /collection\("bookingExceptions"\)/);
  assert.match(retainer, /owedAfterBooking/);
  assert.match(
    retainer,
    /!\(project\.get\("state"\) === "RETAINER_PENDING" \|\| owedAfterBooking\)/,
    "RETAINER_PENDING alone was the only state that could record a retainer",
  );
  // A booked job's orchestration is finished; it is not re-pointed.
  assert.match(retainer, /!owedAfterBooking &&\s*orchestration\.exists/);
});

test("paying a retainer on a booked job does not try to book it again", () => {
  const trigger = orchestration.slice(orchestration.indexOf("export const bookingRetainerPaid"));
  const guard = trigger.indexOf('"BOOKED", "PLANNING"');
  assert.ok(guard > 0 && guard < trigger.indexOf("const declineReason"), "the booked guard runs before the plan checks");
});

test("a couple can answer a published timeline, and it stays published", () => {
  assert.match(planning, /status === "published" && current\.get\("approvalState"\) === "client_pending"/);
  assert.match(planning, /\.\.\.\(status === "published" \? \{\} : \{ status: parsed\.input\.decision \}\)/);
  assert.match(planning, /schedule_changes_\$\{parsed\.input\.scheduleId\}/, "a request for changes reaches the studio as a task");
  const fields = portalRoute.slice(portalRoute.indexOf("  schedules: ["), portalRoute.indexOf("  documents: ["));
  assert.match(fields, /"approvalState"/, "the portal must see whether the couple answered");
  assert.match(clientSchedule, /status === "published" && approval === "client_pending"/);
});

test("a message waiting on the owner can be approved or declined, and can be asked for", () => {
  assert.match(communications, /type: z\.literal\("declineMessage"\)/);
  assert.match(branch(communications, "declineMessage"), /status: "declined"/);
  assert.match(approvals, /approve \? "approveMessage" : "declineMessage"/);
  assert.match(inbox, /<MessageApprovals \/>/);
  assert.match(inbox, /category: draftCategory/, "the composer hardcoded category general, so approval was never asked for");
});

/**
 * An archived job holds no date. An archived test booking (Noor & Eli
 * Haddad) blocked Maya Test Wedding's booking on production — "Still waiting
 * on the date" — and every inquiry for that day read "date taken".
 */
test("an archived job does not hold its date anywhere availability is decided", async () => {
  const { dateHeldByAnother } = await import("../features/inquiries/pipeline.ts");
  const day = "2027-06-12";
  assert.equal(dateHeldByAnother([{ id: "old", eventDate: day, state: "BOOKED", archivedAt: "2026-09-01" }], day, "new"), false);
  assert.equal(dateHeldByAnother([{ id: "live", eventDate: day, state: "BOOKED", archivedAt: null }], day, "new"), true);
  const sites: Array<[string, RegExp]> = [
    ["functions/src/booking/commands.ts", /!candidate\.get\("archivedAt"\) &&\s*blockingStates\.has/],
    ["functions/src/booking/orchestration.ts", /!candidate\.get\("archivedAt"\) &&\s*blockingStates\.has/],
    ["functions/src/crm/public-lead.ts", /dateConflicts\.docs\.some\(\(project\) => !project\.get\("archivedAt"\)\)/],
    ["functions/src/crm/commands.ts", /clash\.docs\.some\(\(project\) => !project\.get\("archivedAt"\)\)/],
    ["functions/src/intake/inquiry-link.ts", /clash\.docs\.some\(\(project\) => !project\.get\("archivedAt"\)\)/],
    ["functions/src/intake/capture.ts", /dateConflicts\?\.docs\.some\(\(project\) => !project\.get\("archivedAt"\)\)/],
    ["functions/src/intake/enrich.ts", /conflicts\.docs\.some\(\(project\) => !project\.get\("archivedAt"\)\)/],
  ];
  for (const [path, pattern] of sites) assert.match(readFileSync(path, "utf8"), pattern, path);
});
