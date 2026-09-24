import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { crewForTrade } from "@/features/crew/roster-trade";
import type { RosterMember } from "@/features/crew/roster-trade";

const member = (over: Partial<RosterMember> & { id: string; name: string }): RosterMember => ({
  active: true,
  specialties: [],
  ...over,
});

/** A roster shaped like a real one: some tagged, some never touched. */
const ROSTER: RosterMember[] = [
  member({ id: "c1", name: "Marco Silva", trades: ["videographer"] }),
  member({ id: "c2", name: "Albert Gershengoren", trades: ["photographer"] }),
  member({ id: "c3", name: "Jordan Reid", trades: ["photographer", "videographer"] }),
  member({ id: "c4", name: "Dana Okafor", specialties: ["weddings", "video"] }),
  member({ id: "c5", name: "Sam Ellis", specialties: ["weddings", "portraits"] }),
  member({ id: "c6", name: "Retired Rita", active: false, trades: ["videographer"] }),
];

test("a stated trade decides, and covers someone who holds two", () => {
  const answer = crewForTrade(ROSTER, "videographer");
  assert.deepEqual(
    answer.confirmed.map((c) => c.name),
    ["Marco Silva", "Jordan Reid"],
  );
  assert.ok(answer.confirmed.every((c) => c.basis === "trade"));
});

test("an untagged profile falls back to its specialties, and says so", () => {
  const answer = crewForTrade(ROSTER, "videographer");
  assert.deepEqual(
    answer.inferred.map((c) => c.name),
    ["Dana Okafor"],
  );
  assert.equal(answer.inferred[0]?.basis, "specialty");
  // Sam's specialties say nothing about video, so he is neither.
  assert.ok(![...answer.confirmed, ...answer.inferred].some((c) => c.name === "Sam Ellis"));
});

test("an inactive profile is never offered, whatever its trade", () => {
  const answer = crewForTrade(ROSTER, "videographer");
  assert.ok(
    ![...answer.confirmed, ...answer.inferred].some((c) => c.name === "Retired Rita"),
  );
  assert.equal(answer.rosterSize, 5);
});

/**
 * The failure this function exists to prevent. A roster nobody has tagged is
 * not a roster without videographers, and an answer that says so is worse than
 * no answer — it tells the studio to go hire someone they already employ.
 */
test("an entirely untagged roster reports uncertainty, not absence", () => {
  const untagged: RosterMember[] = [
    member({ id: "a", name: "Ana", specialties: ["weddings"] }),
    member({ id: "b", name: "Bo", specialties: ["corporate"] }),
  ];
  const answer = crewForTrade(untagged, "videographer");
  assert.equal(answer.confirmed.length, 0);
  assert.equal(answer.untagged, 2);
  assert.equal(answer.rosterSize, 2);
});

test("a tagged person is not counted as untagged", () => {
  const answer = crewForTrade(ROSTER, "photographer");
  // Dana and Sam are the only active profiles without trades.
  assert.equal(answer.untagged, 2);
  assert.deepEqual(
    answer.confirmed.map((c) => c.name),
    ["Albert Gershengoren", "Jordan Reid"],
  );
});

test("the specialty fallback matches in both directions", () => {
  const roster = [member({ id: "x", name: "Vi", specialties: ["video"] })];
  // specialty "video" reaches the role "videographer"…
  assert.equal(crewForTrade(roster, "videographer").inferred.length, 1);
  // …and a specialty longer than the role still matches.
  const other = [member({ id: "y", name: "Pho", specialties: ["photographer"] })];
  assert.equal(crewForTrade(other, "photo").inferred.length, 1);
});

/**
 * functions/ is a separate package with no "@/features" path, so the copilot's
 * read tool can only use a duplicate. Compare below the headers.
 */
test("the functions copy of the roster trade rule matches features/", () => {
  const body = (path: string) => {
    const source = readFileSync(`${process.cwd()}/${path}`, "utf8");
    return source.slice(source.indexOf("export type RosterMember = {"));
  };
  assert.equal(
    body("functions/src/crew/roster-trade.ts"),
    body("features/crew/roster-trade.ts"),
  );
});
