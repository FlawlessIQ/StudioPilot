import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import test from "node:test";
import { crewAttention } from "../features/crew/attention";
import { mockCrewData, mockCrewSchedule } from "../features/crew/mock-crew";
import { offerCanBeAnswered } from "../features/crew/offer-moment";
import { workWindow } from "../features/crew/work-window";

/**
 * The crew workspace on a phone (M6 of the mobile-first plan).
 */

test("a finish before the start is after midnight, not a negative shift", () => {
  const worked = workWindow("2027-06-12T18:00:00.000Z", "14:00", "00:30");
  assert.ok(worked);
  assert.equal((worked.endsAt.valueOf() - worked.startsAt.valueOf()) / 60_000, 630);
  assert.equal(workWindow("2027-06-12", "14:00", "nope"), null);
});

test("the mock crew always has an open offer, a job ahead and hours owed", () => {
  for (const now of [new Date("2026-01-15T12:00:00Z"), new Date("2026-07-15T12:00:00Z")]) {
    const data = mockCrewData(now);
    const attention = crewAttention(data.assignments, now);
    assert.equal(attention.invitations.length, 1);
    assert.ok(attention.acknowledgementDue);
    assert.equal(attention.closeoutsDue.length, 1);
    const offer = data.assignments[0]!;
    assert.ok(
      offerCanBeAnswered({ status: "invited", inviteExpiresAt: String(offer.inviteExpiresAt), arrivalAt: String(offer.arrivalAt), now }),
    );
    // A 5 PM ceremony in New York reads 5 PM in winter and summer alike.
    const ceremony = mockCrewSchedule(now).items as Array<Record<string, unknown>>;
    const at = new Date(String(ceremony.find((item) => item.id === "ceremony")!.startAt));
    assert.equal(at.toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric" }), "5 PM");
  }
});

test("declining can say why, and older clients that don't still work", () => {
  const commands = readFileSync("functions/src/crew/commands.ts", "utf8");
  assert.match(commands, /reason: z\.string\(\)\.trim\(\)\.max\(500\)\.nullable\(\)\.default\(null\)/);
  assert.equal(commands.split("declineReason:").length - 1, 2, "both decline paths record the reason");
});

test("crew emails and invitations open the job they are about", () => {
  assert.match(
    readFileSync("functions/src/planning/commands.ts", "utf8"),
    /\/crew\/schedule\?assignment=\$\{encodeURIComponent\(assignment\.id\)\}/,
  );
  assert.match(
    readFileSync("features/auth/accept-crew-invitation.tsx", "utf8"),
    /`\/crew\/pending\$\{assignmentId/,
  );
});

test("old crew routes land somewhere real", () => {
  for (const route of ["requirements", "documents"]) {
    const page = readFileSync(`app/crew/${route}/page.tsx`, "utf8");
    assert.match(page, /\/crew\/prep\?assignment=\$\{encodeURIComponent\(assignment\)\}#checklist/, route);
  }
  assert.match(readFileSync("app/crew/profile/page.tsx", "utf8"), /redirect\("\/crew\/account"\)/);
  assert.equal(existsSync("components/crew/live-crew-views.tsx"), false);
});

test("the day sheet is read in the event's zone and saved for no signal", () => {
  const sheet = readFileSync("components/crew/kit/crew-day-sheet.tsx", "utf8");
  assert.match(sheet, /const zone = text\(schedule\.timezone\) \|\| undefined;/);
  assert.match(sheet, /localStorage\.setItem\(cacheKey/);
  assert.doesNotMatch(sheet, /toLocaleString\(\[\]/);
});
