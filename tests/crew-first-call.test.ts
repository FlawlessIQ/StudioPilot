import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { CrewCandidateInput } from "@/features/crew/cascade";
import { moveInOrder, ordinal, readFirstCall, tradeGroups } from "@/features/crew/first-call";
import { assignCandidatesToRoles, planCrewStaffing } from "@/features/crew/staffing-plan";
import { planCrewStaffing as functionsPlanCrewStaffing } from "../functions/src/crew/staffing-plan";

/**
 * GR Productions (2026-10-06): "How do I order crew members for staffing
 * events? And categorize them by types." The answer is a first-call order per
 * trade, set on the Crew page, that every staffing plan follows.
 */

const startsAt = "2027-06-12T14:00:00.000Z";
const endsAt = "2027-06-12T23:00:00.000Z";
const read = (path: string) => readFileSync(path, "utf8");

const crew = (id: string, trades: string[], overrides: Partial<CrewCandidateInput> = {}): CrewCandidateInput => ({
  id,
  name: id,
  active: true,
  specialties: ["Weddings"],
  trades,
  serviceAreas: ["Madison"],
  travelRadiusMiles: 50,
  preferenceRank: null,
  w9Status: "verified",
  insuranceStatus: "verified",
  contractStatus: "completed",
  availability: [{ startsAt, endsAt, status: "available" }],
  acceptedAssignments: [],
  ...overrides,
});

// Vittor ranks higher on his own: paperwork done and marked available. Albert
// has neither, so without a first call the engine asks Vittor first.
const vittor = crew("vittor", ["photographer", "videographer"]);
const albert = crew("albert", ["photographer"], { w9Status: "missing", availability: [] });
const sam = crew("sam", ["photographer"], { availability: [] });

const secondShooter = (firstCall?: Parameters<typeof assignCandidatesToRoles>[0]["firstCall"], preferredOrder?: string[]) =>
  assignCandidatesToRoles({
    roles: [{ role: "Second photographer", coverageRole: "photographer" }],
    eventSpecialty: "weddings",
    serviceArea: "Madison",
    startsAt,
    endsAt,
    candidates: [vittor, albert, sam],
    firstCall,
    preferredOrder,
  })[0]!.candidates.map((candidate) => candidate.crewProfileId);

test("without a first call, the engine's ranking decides", () => {
  assert.equal(secondShooter()[0], "vittor");
});

test("the studio's first call leads; everyone unplaced follows in the engine's order", () => {
  assert.deepEqual(secondShooter({ photographer: ["albert"] }), ["albert", "vittor", "sam"]);
  // An order for the other trade changes nothing here.
  assert.equal(secondShooter({ videographer: ["albert", "sam"] })[0], "vittor");
});

test("one job's own order still wins over the studio's", () => {
  assert.deepEqual(secondShooter({ photographer: ["albert", "sam"] }, ["sam"]), ["sam", "albert", "vittor"]);
});

test("first call never makes someone unavailable offerable", () => {
  const busy = crew("busy", ["photographer"], { availability: [{ startsAt, endsAt, status: "unavailable" }] });
  const plan = assignCandidatesToRoles({
    roles: [{ role: "Second photographer", coverageRole: "photographer" }],
    eventSpecialty: "weddings",
    serviceArea: "Madison",
    startsAt,
    endsAt,
    candidates: [busy, vittor],
    firstCall: { photographer: ["busy"] },
  });
  assert.deepEqual(plan[0]!.candidates.map((candidate) => candidate.crewProfileId), ["vittor"]);
});

test("booking's automatic plan and the functions copy follow it the same way", () => {
  const input = {
    coverage: [{ role: "photographer" as const, count: 2 }],
    eventSpecialty: "weddings",
    serviceArea: "Madison",
    startsAt,
    endsAt,
    candidates: [vittor, albert, sam],
    firstCall: { photographer: ["albert"] },
  };
  const app = planCrewStaffing(input).roles.map((role) => role.candidates.map((c) => c.crewProfileId));
  const functions = functionsPlanCrewStaffing(input).roles.map((role) => role.candidates.map((c) => c.crewProfileId));
  assert.deepEqual(app, functions);
  assert.equal(app[0]![0], "albert");
  const prepare = read("functions/src/crew/prepare-staffing.ts");
  assert.match(prepare, /ownerCovers: ownerShootsJob\(project\.data\(\)\),\s*firstCall,/);
});

test("the Crew page groups by trade in call order; both trades means both groups", () => {
  const people = [
    { id: "vittor", name: "Vittor Diniz", trades: ["photographer", "videographer"] },
    { id: "albert", name: "Albert Gershengoren", trades: ["photographer"] },
    { id: "gabe", name: "Gabriel Rhodes", trades: ["photographer"] },
    { id: "new", name: "New Person", trades: [] },
  ];
  const groups = tradeGroups(people, readFirstCall({ firstCall: { photographer: ["gabe", "albert", "gone"], videographer: [] } }));
  assert.deepEqual(groups.map((group) => group.label), ["Photographers", "Videographers", "No type yet"]);
  // Placed people first in the studio's order (an id no longer on the roster is
  // skipped), then the rest by name.
  assert.deepEqual(groups[0]!.people.map((person) => person.id), ["gabe", "albert", "vittor"]);
  assert.equal(groups[0]!.placed, 2);
  assert.deepEqual(groups[1]!.people.map((person) => person.id), ["vittor"]);
  assert.deepEqual(groups[2]!.people.map((person) => person.id), ["new"]);
});

test("moving writes the whole group's order; the ends don't move further", () => {
  assert.deepEqual(moveInOrder(["a", "b", "c"], "c", -1), ["a", "c", "b"]);
  assert.deepEqual(moveInOrder(["a", "b", "c"], "a", -1), ["a", "b", "c"]);
  assert.deepEqual(moveInOrder(["a", "b", "c"], "c", 1), ["a", "b", "c"]);
  assert.deepEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "21st", "22nd"], [1, 2, 3, 4, 11, 12, 21, 22].map(ordinal));
});

test("stored orders are tidied: unknown trades, duplicates and junk dropped", () => {
  assert.deepEqual(readFirstCall({ firstCall: { photographer: ["a", "a", 3, "", "b"], drone: ["x"] } }), { photographer: ["a", "b"] });
  assert.deepEqual(readFirstCall(undefined), {});
});

test("the order is set on the Crew page and saved by its own command", () => {
  assert.match(read("components/crew/crew-hub.tsx"), /<CrewCallOrder/);
  const commands = read("functions/src/crew/commands.ts");
  assert.match(commands, /type: z\.literal\("setCrewFirstCall"\)/);
  assert.match(commands, /\[`crewOffers\.firstCall\.\$\{parsed\.input\.trade\}`\]: order/);
  // Owner and admin; a crew member or coordinator can't reorder the studio.
  assert.match(commands, /setCrewFirstCall"\) \{\s*if \(!\["studio_owner", "studio_admin"\]\.includes\(role\)\)/);
});
