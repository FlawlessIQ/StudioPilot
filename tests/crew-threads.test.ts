import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { crewThreads } from "../features/crew/crew-threads";
import { todayInbox } from "../features/today/inbox";

const assignment = {
  id: "a1",
  projectId: "p1",
  crewProfileId: "cp1",
  role: "Videographer 1",
  projectName: "Conor Lawless Wedding",
};
const profile = { id: "cp1", name: "Conor" };
const message = (over: Record<string, unknown>) => ({
  id: "m1",
  tenantId: "t1",
  projectId: "p1",
  assignmentId: "a1",
  direction: "crew_to_studio",
  subject: "Event day: Conor Lawless Wedding",
  message: "So excited to work this gig!!!",
  urgency: "event_day",
  createdAt: "2026-10-09T20:05:28.659Z",
  ...over,
});

test("a crew member's message is a thread waiting on the studio, named and placed", () => {
  const [thread] = crewThreads({ crewMessages: [message({})], crewAssignments: [assignment], crewProfiles: [profile] });
  assert.equal(thread?.crewName, "Conor");
  assert.equal(thread?.role, "Videographer 1");
  assert.equal(thread?.projectName, "Conor Lawless Wedding");
  assert.equal(thread?.awaitingStudio, true);
  assert.equal(thread?.urgent, true);
});

test("a studio reply answers the thread and clears its urgency", () => {
  const [thread] = crewThreads({
    crewMessages: [
      message({}),
      message({ id: "m2", direction: "studio_to_crew", urgency: "normal", createdAt: "2026-10-09T20:10:00.000Z" }),
    ],
    crewAssignments: [assignment],
  });
  assert.equal(thread?.awaitingStudio, false);
  assert.equal(thread?.urgent, false);
  assert.deepEqual(thread?.messages.map((entry) => entry.fromCrew), [true, false]);
});

test("Today asks the studio to reply, and links to the crew thread", () => {
  const inbox = todayInbox({
    now: "2026-10-09T20:30:00.000Z",
    projects: [{ id: "p1", name: "Conor Lawless Wedding", state: "BOOKED", eventDate: "2026-10-24" }],
    crewMessages: [message({})],
    crewAssignments: [assignment],
    crewProfiles: [profile],
  } as never) as unknown as { act: Array<{ id: string; title: string; band: string; action: { kind: string; href?: string } }> };
  const card = inbox.act.find((item) => item.id === "crew-message-a1");
  assert.ok(card, "a crew message card on Today");
  assert.equal(card.title, "Conor needs you — event day");
  assert.equal(card.band, "overdue");
  assert.equal(card.action.href, "/studio/messages?view=crew&assignment=a1");
});

test("a studio reply to crew is emailed to them, as crew mail", () => {
  const source = readFileSync("functions/src/crew/commands.ts", "utf8");
  const branch = source.slice(source.indexOf('parsed.type === "contactStudio"'));
  assert.match(branch, /crew_reply_\$\{messageId\}/);
  assert.match(branch, /audience: "crew"/);
  assert.match(branch, /recipient: crewEmail/);
});
