import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  findDuplicateProfile,
  normalizeEmail,
} from "@/features/crew/duplicate-profile";

/**
 * The production directory grew two entries on one address, differing only by
 * how the name had been typed. Crew are offered work per job, so a duplicate
 * person can be offered the same wedding twice.
 */

const profile = (
  id: string,
  email: string,
  name = "Someone",
  archivedAt: string | null = null,
) => ({ id, email, name, archivedAt });

test("the same address is the same person, however it is capitalised", () => {
  const existing = [profile("p1", "Con.Lawless@Gmail.com ", "Con Law")];
  const verdict = findDuplicateProfile("con.lawless@gmail.com", existing);
  assert.equal(verdict.kind, "active");
  assert.equal(verdict.kind === "active" && verdict.profileId, "p1");
  // The name is returned so the refusal can say who they already have.
  assert.equal(verdict.kind === "active" && verdict.name, "Con Law");
});

test("a different address is a different person", () => {
  const existing = [profile("p1", "jordan@example.com")];
  assert.equal(
    findDuplicateProfile("sam@example.com", existing).kind,
    "unique",
  );
});

test("an archived match is reported as archived, not as unique", () => {
  // Silently creating a second entry is the wrong answer: the studio removed
  // this person and can restore them.
  const existing = [profile("p1", "sam@example.com", "Sam", "2026-08-01T00:00:00Z")];
  const verdict = findDuplicateProfile("sam@example.com", existing);
  assert.equal(verdict.kind, "archived");
  assert.equal(verdict.kind === "archived" && verdict.profileId, "p1");
});

test("an active match wins over an archived one", () => {
  const existing = [
    profile("old", "sam@example.com", "Sam", "2026-08-01T00:00:00Z"),
    profile("live", "sam@example.com", "Sam"),
  ];
  const verdict = findDuplicateProfile("sam@example.com", existing);
  assert.equal(verdict.kind, "active");
  assert.equal(verdict.kind === "active" && verdict.profileId, "live");
});

test("an entry does not collide with itself when its email is edited", () => {
  const existing = [profile("p1", "sam@example.com")];
  assert.equal(
    findDuplicateProfile("sam@example.com", existing, "p1").kind,
    "unique",
  );
  // But it still collides with somebody else's.
  const two = [...existing, profile("p2", "jordan@example.com")];
  assert.equal(
    findDuplicateProfile("jordan@example.com", two, "p1").kind,
    "active",
  );
});

test("an empty address is not a duplicate of every blank record", () => {
  const existing = [profile("p1", "")];
  assert.equal(findDuplicateProfile("   ", existing).kind, "unique");
});

test("normalizeEmail matches the contact rule", () => {
  assert.equal(normalizeEmail("  Foo@BAR.com "), "foo@bar.com");
});

test("the functions copy has not drifted", () => {
  const strip = (source: string) =>
    source.replace(/\/\*\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ").trim();
  assert.equal(
    strip(readFileSync("features/crew/duplicate-profile.ts", "utf8")),
    strip(readFileSync("functions/src/crew/duplicate-profile.ts", "utf8")),
  );
});

/**
 * The guard is only as good as the set it is shown.
 *
 * `findDuplicateProfile` is a pure verdict over a list, and every case above
 * proves it correct. None of that mattered at the two places it is actually
 * called, which read the directory with `.limit(400)` and no ordering:
 * Firestore returned an arbitrary 400 documents, anyone outside that window
 * was invisible, and the verdict came back "unique" — so the check failed
 * open and created the duplicate it exists to prevent. Archived entries count
 * toward the cap, so a studio reaches it on history rather than headcount.
 *
 * A bound on this particular read is always a silent correctness bug, never a
 * safeguard, and it reads as prudent — which is why it wants a test rather
 * than a comment.
 */
test("nothing bounds the directory the duplicate check is shown", () => {
  const commands = readFileSync(
    `${process.cwd()}/functions/src/crew/commands.ts`,
    "utf8",
  );
  const scan = commands.slice(
    commands.indexOf("async function tenantCrewDirectory"),
  );
  const body = scan.slice(0, scan.indexOf("\n}\n"));
  // Paging needs a page size, so a bare limit is expected — what must not
  // exist is a limit with no cursor to continue past it.
  assert.ok(body.includes("startAfter"), "the scan does not page");
  assert.ok(body.includes("orderBy"), "paging without an order is not stable");

  // And both callers must go through it rather than querying for themselves.
  const callers = [...commands.matchAll(/findDuplicateProfile\(/g)];
  assert.equal(callers.length, 2);
  for (const caller of callers) {
    const argument = commands.slice(caller.index, caller.index + 260);
    assert.ok(
      argument.includes("tenantCrewDirectory"),
      "a duplicate check is reading the directory its own way",
    );
  }
});
