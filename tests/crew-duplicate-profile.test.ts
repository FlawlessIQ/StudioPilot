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
