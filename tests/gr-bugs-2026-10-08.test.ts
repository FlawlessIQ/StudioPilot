import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { wallClockToIso } from "@/features/schedules/day-clock";
import {
  applyTimeEdits,
  matchLine,
  parseTimeRequests,
  planTimeEdits,
} from "@/features/schedules/time-edits";
import { crewEmailWarning, teamEmailWarning } from "@/lib/crm/command-client";

/** Gabe's run-through, 2026-10-08. */
const read = (path: string) => readFileSync(path, "utf8");
const NY = "America/New_York";
const DAY = "2027-01-23";
const at = (clock: string) => wallClockToIso(DAY, clock, NY)!;

// Albert's test wedding, as its published timeline read.
const lines = [
  { id: "i1", title: "Photo and video arrive", startAt: at("12:30"), endAt: at("13:15") },
  { id: "i2", title: "Cocktail hour", startAt: at("15:00"), endAt: at("16:00") },
  { id: "i3", title: "Entrances, first dance, parent dances and speeches", startAt: at("16:00"), endAt: at("17:00") },
  { id: "i4", title: "Dinner — time TBD", startAt: at("17:00"), endAt: at("17:00") },
  { id: "i5", title: "Cake cutting — time TBD", startAt: at("17:00"), endAt: at("17:00") },
  { id: "i6", title: "Night pictures, dessert and dancing — time TBD", startAt: at("17:00"), endAt: at("17:00") },
];

test("Gabe's words, read: each line and its time, 'pm' carried across a range", () => {
  assert.deepEqual(
    parseTimeRequests("Can we make dinner 7-8pm, Cake cutting 8:30pm, and night pictures 9pm"),
    [
      { phrase: "dinner", start: "19:00", end: "20:00" },
      { phrase: "Cake cutting", start: "20:30", end: null },
      { phrase: "night pictures", start: "21:00", end: null },
    ],
  );
  assert.deepEqual(parseTimeRequests("dinner at 7:53 PM"), [{ phrase: "dinner", start: "19:53", end: null }]);
  // No am/pm on a wedding hour is the evening; a leading zero or "am" is the morning.
  assert.deepEqual(parseTimeRequests("first look 3"), [{ phrase: "first look", start: "15:00", end: null }]);
  assert.deepEqual(parseTimeRequests("hair 9am"), [{ phrase: "hair", start: "09:00", end: null }]);
  assert.deepEqual(parseTimeRequests("hair 09:30"), [{ phrase: "hair", start: "09:30", end: null }]);
});

test("each phrase finds its line, and a phrase naming nothing finds nothing", () => {
  assert.equal(matchLine("dinner", lines)?.id, "i4");
  assert.equal(matchLine("Cake cutting", lines)?.id, "i5");
  assert.equal(matchLine("night pictures", lines)?.id, "i6");
  assert.equal(matchLine("first dance", lines)?.id, "i3");
  assert.equal(matchLine("sparklers", lines), null);
});

test("the plan shows what changes, from TBD; the timeline comes back with times and no TBD", () => {
  const planned = planTimeEdits("dinner 7-8pm, cake cutting 8:30pm, night pictures 9pm, sparklers 10pm", lines, NY);
  assert.deepEqual(planned.unmatched, ["sparklers"]);
  assert.deepEqual(
    planned.edits.map((edit) => [edit.title, edit.before, edit.start, edit.end]),
    [
      ["Dinner", "TBD", "19:00", "20:00"],
      ["Cake cutting", "TBD", "20:30", null],
      ["Night pictures, dessert and dancing", "TBD", "21:00", null],
    ],
  );
  const updated = applyTimeEdits(lines, planned.edits, DAY, NY);
  const byId = Object.fromEntries(updated.map((item) => [item.id, item]));
  assert.equal(byId.i4!.title, "Dinner");
  assert.equal(byId.i4!.startAt, at("19:00"));
  assert.equal(byId.i4!.endAt, at("20:00"));
  assert.equal(byId.i5!.title, "Cake cutting");
  assert.equal(byId.i5!.startAt, at("20:30"));
  assert.equal(byId.i6!.startAt, at("21:00"));
  // Everything else exactly as it was.
  assert.deepEqual(byId.i2, lines[1]);
});

test("Cue can prepare it, the card publishes it, and the job panel shows what Cue prepared", () => {
  assert.match(read("functions/src/ai/action-catalog.ts"), /id: "edit_timeline_times", scope: "project"/);
  assert.match(read("components/ai/actions/prepared-actions.tsx"), /edit_timeline_times: TimelineTimesCard,/);
  const card = read("components/ai/actions/planning-actions.tsx");
  assert.match(card, /sendPlanningCommand\("publishSchedule"/);
  assert.match(card, /The crew are asked to confirm it again/);
  const panel = read("components/projects/project-thread.tsx");
  assert.match(panel, /<PreparedActionCards actions=\{prepared\?\.actions\} \/>/);
  assert.match(panel, /prepared\?\.flow \? <FlowRunner flow=\{prepared\.flow\} \/> : null/);
  assert.doesNotMatch(panel, /changes nothing/);
  // Where cards can't be shown, Cue is told so and must not call anything ready.
  const copilot = read("functions/src/ai/copilot.ts");
  assert.match(copilot, /if \(input\.cards === false\)/);
  assert.match(copilot, /Do not say anything is ready or drafted/);
  assert.equal((read("components/ai/event-day-copilot.tsx").match(/cards: false/g) ?? []).length, 2);
});

test("crew and vendor mail is never the couple's, even at the couple's address", () => {
  const worker = read("functions/src/operations/jobs.ts");
  assert.match(worker, /!CREW_EMAIL_TYPES\.has\(templateKey\) &&\s+!\["crew", "vendor"\]\.includes\(String\(document\.get\("audience"\) \?\? ""\)\) &&\s+clientContactEmails\.has/);
  const planning = read("functions/src/planning/commands.ts");
  assert.match(planning, /type: "final_schedule_published",\s+\/\/[^\n]*\n[^\n]*\n\s+audience: "crew",/);
  assert.match(planning, /type: "manual_message",\s+audience: "vendor",/);
});

test("one address in two roles is said when it's entered, both ways, and never silently overwritten", () => {
  assert.match(String(crewEmailWarning({ emailBelongsToClient: "Albert Gersh" })), /also belongs to your client Albert Gersh/);
  assert.match(String(crewEmailWarning({ emailBelongsToTeamRole: "studio_owner" })), /you, the studio owner/);
  assert.equal(crewEmailWarning({}), null);
  assert.match(String(teamEmailWarning({ emailBelongsToTeamRole: "subcontractor" })), /one of your crew/);
  assert.match(String(teamEmailWarning({ emailBelongsToTeamRole: "subcontractor" })), /plus address/);
  // Pending crew count, not just those signed up.
  assert.match(read("functions/src/crm/team-email.ts"), /return \(await crewProfileNameForEmail\(db, tenantId, address\)\) \? "subcontractor" : null;/);
  assert.match(read("functions/src/crew/commands.ts"), /emailBelongsToClient: clientName/);
  assert.match(read("functions/src/client/invitations.ts"), /emailBelongsToTeamRole: teamRole/);
  // Accepting a staff invite refuses an existing client or crew role.
  assert.match(read("functions/src/saas/memberships.ts"), /if \(wasActive && existingRole && !internalRoles\.has\(existingRole\)\)\s+throw new Error\("MEMBERSHIP_ROLE_CONFLICT"\);/);
  // And the accept pages say what is actually in the way.
  assert.match(read("features/auth/accept-crew-invitation.tsx"), /already the studio's client, or on its team/);
  assert.match(read("features/auth/accept-client-invitation.tsx"), /already on the studio's crew or team/);
  assert.match(read("features/auth/accept-invitation.tsx"), /already the studio's client or one of its crew/);
});
