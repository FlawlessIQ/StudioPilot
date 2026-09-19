import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { rankCrewCandidates, type CrewCandidateInput } from "@/features/crew/cascade";
import { crewProfileSchema } from "@/features/crew/schema";
import { coverageRoleForLabel } from "@/features/crew/staffing-plan";

/**
 * What somebody shoots, stated rather than guessed.
 *
 * From the reference studio's live test: "I want to invite my videographers
 * too. Completely separate crew type then photographer." His roster reads
 * "Weddings, Events, Headshots" — `specialties` describes the *kind of event*
 * — so asking "is this a videographer?" of that field was a substring match on
 * text that never claimed to answer it.
 */

const base: Omit<CrewCandidateInput, "id" | "name" | "specialties" | "trades"> = {
  active: true,
  serviceAreas: ["Hudson Valley"],
  travelRadiusMiles: 100,
  preferenceRank: null,
  w9Status: "verified",
  insuranceStatus: "verified",
  contractStatus: "completed",
  availability: [],
  acceptedAssignments: [],
};

const shoot = {
  serviceArea: "Hudson Valley",
  startsAt: "2026-10-03T16:00:00.000Z",
  endsAt: "2026-10-04T02:00:00.000Z",
};

const ROSTER: CrewCandidateInput[] = [
  {
    ...base,
    id: "video",
    name: "Vera Video",
    specialties: ["Weddings", "Events"],
    trades: ["videographer"],
  },
  {
    ...base,
    id: "photo",
    name: "Pat Photo",
    specialties: ["Weddings", "Events"],
    trades: ["photographer"],
  },
  {
    ...base,
    id: "both",
    name: "Sam Both",
    specialties: ["Weddings"],
    trades: ["photographer", "videographer"],
  },
];

const eligibleIds = (roleSpecialty: string, roleTrade?: string) =>
  rankCrewCandidates({ ...shoot, roleSpecialty, roleTrade, candidates: ROSTER })
    .filter((candidate) => candidate.eligible)
    .map((candidate) => candidate.crewProfileId)
    .sort();

test("a stated trade decides the role, not the words in specialties", () => {
  // Nobody's specialties mention video; on substring matching alone the
  // videographer role would have excluded the entire roster.
  assert.deepEqual(eligibleIds("video", "videographer"), ["both", "video"]);
  assert.deepEqual(eligibleIds("weddings", "photographer"), ["both", "photo"]);
});

test("the wrong trade is an exclusion, and it says so", () => {
  const ranked = rankCrewCandidates({
    ...shoot,
    roleSpecialty: "video",
    roleTrade: "videographer",
    candidates: ROSTER,
  });
  const photographer = ranked.find((c) => c.crewProfileId === "photo");
  assert.equal(photographer?.eligible, false);
  assert.ok(photographer?.exclusions.includes("Role or specialty does not match"));
});

/**
 * No existing profile has trades, and a studio that never fills them in must
 * rank exactly as it did before — by specialty.
 */
test("a profile with no trades still ranks on its specialties", () => {
  const untyped: CrewCandidateInput[] = [
    { ...base, id: "legacy", name: "Legacy", specialties: ["Weddings"], trades: [] },
  ];
  const ranked = rankCrewCandidates({
    ...shoot,
    roleSpecialty: "weddings",
    roleTrade: "videographer",
    candidates: untyped,
  });
  assert.equal(ranked[0]?.eligible, true);
});

test("trades are optional on the profile record", () => {
  const profile = {
    id: "c1",
    tenantId: "t1",
    userId: null,
    name: "Legacy",
    email: "legacy@example.com",
    phone: null,
    specialties: ["weddings"],
    serviceAreas: ["NYC"],
    travelRadiusMiles: 50,
    rateType: "event" as const,
    rateCents: 75000,
    currency: "USD",
    equipment: [],
    w9Status: "missing" as const,
    insuranceStatus: "missing" as const,
    contractStatus: "missing" as const,
    emergencyContact: null,
    preferenceRank: null,
    notes: null,
    active: true,
    archivedAt: null,
    createdAt: "2026-09-19T00:00:00.000Z",
    updatedAt: "2026-09-19T00:00:00.000Z",
    createdBy: "u1",
    updatedBy: "u1",
  };
  assert.equal(crewProfileSchema.safeParse(profile).success, true);
  assert.equal(
    crewProfileSchema.safeParse({ ...profile, trades: ["videographer"] }).success,
    true,
  );
  assert.equal(
    crewProfileSchema.safeParse({ ...profile, trades: ["drone"] }).success,
    false,
  );
});

test("a retitled role still resolves to a trade", () => {
  assert.equal(coverageRoleForLabel("Second videographer"), "videographer");
  assert.equal(coverageRoleForLabel("Video lead"), "videographer");
  assert.equal(coverageRoleForLabel("Second shooter"), "photographer");
});

// --- somewhere to actually set it ---------------------------------------

/**
 * The field was the easy half. It is worth nothing until a studio, or the
 * crew member themselves, can say what they shoot — which is why this asserts
 * against all three profile forms rather than the schema alone.
 */
test("every crew profile form offers the trade", () => {
  for (const path of [
    "components/crew/create-crew-profile-form.tsx",
    "components/crew/crew-record-actions.tsx",
    "components/crew/live-crew-views.tsx",
  ]) {
    const source = readFileSync(`${process.cwd()}/${path}`, "utf8");
    assert.match(source, /<TradeField/, `${path} has no trade input`);
    assert.match(source, /tradesFromForm\(/, `${path} never reads it back`);
  }
});

/** And the readers must pass it on, or it is stored and ignored. */
test("every ranking reads the trades off the profile", () => {
  for (const path of [
    "components/crew/crew-cascade-workspace.tsx",
    "components/ai/flow-runner.tsx",
    "functions/src/crew/prepare-staffing.ts",
  ]) {
    const source = readFileSync(`${process.cwd()}/${path}`, "utf8");
    assert.match(source, /trades:/, `${path} builds candidates without trades`);
  }
});

test("the command persists the trade on every write of a profile", () => {
  const source = readFileSync(
    `${process.cwd()}/functions/src/crew/commands.ts`,
    "utf8",
  );
  // create, the studio's directory edit, and the crew member's own edit.
  assert.equal(source.split("trades: parsed.input.trades ?? []").length - 1, 3);
});
