import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

/**
 * A descending sort needs its own index. An ascending one will not do.
 *
 * The crew workspace ordered assignments by `arrivalAt desc` and
 * `firestore.indexes.json` carried `(tenantId, userId, arrivalAt ASCENDING)`.
 * The field names line up, so it reads as covered — and it is not: the
 * required index is `arrivalAt DESCENDING` right down to `__name__`, so
 * Firestore refused every load with FAILED_PRECONDITION.
 *
 * Nobody caught it because no crew member had ever opened that workspace on
 * production. It took a real phone, and then it presented as "Crew workspace
 * unavailable" with the reason swallowed by the error mapper.
 *
 * This walks every descending `orderBy` in the product and insists the index
 * file has a matching descending entry on the same collection. It is
 * deliberately keyed on the collection, not just the field: `lastMessageAt`
 * descending on `conversations` says nothing about `arrivalAt` on
 * `crewAssignments`.
 */

const sources = (): { path: string; text: string }[] => {
  const out: { path: string; text: string }[] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const next = `${directory}/${entry.name}`;
      if (entry.isDirectory()) walk(next);
      else if (/\.tsx?$/.test(entry.name))
        out.push({ path: next, text: readFileSync(next, "utf8") });
    }
  };
  for (const root of ["components", "app", "lib", "features", "server"])
    walk(`${process.cwd()}/${root}`);
  return out;
};

/** Every (collection, field) pair sorted descending, with where it came from. */
const descendingSorts = (): { collection: string; field: string; where: string }[] => {
  const found: { collection: string; field: string; where: string }[] = [];
  for (const { path, text } of sources()) {
    // Both call styles: the web SDK's `collection(firestore, "x")` and the
    // Admin SDK's `.collection("x")`, each followed by its orderBy.
    const pattern =
      /(?:collection\(\s*\w+\s*,\s*"([A-Za-z]+)"|\.collection\(\s*"([A-Za-z]+)")([\s\S]{0,600}?)(?=collection\(|$)/g;
    for (const match of text.matchAll(pattern)) {
      const name = match[1] ?? match[2]!;
      for (const sort of match[3]!.matchAll(
        /orderBy\(\s*"([A-Za-z_]+)"\s*,\s*"desc"/g,
      )) {
        found.push({
          collection: name,
          field: sort[1]!,
          where: path.replace(`${process.cwd()}/`, ""),
        });
      }
    }
  }
  return found;
};

const indexes = JSON.parse(
  readFileSync(`${process.cwd()}/firestore.indexes.json`, "utf8"),
) as {
  indexes: {
    collectionGroup: string;
    fields: { fieldPath: string; order?: string }[];
  }[];
};

const hasDescendingIndex = (collection: string, field: string): boolean =>
  indexes.indexes.some(
    (index) =>
      index.collectionGroup === collection &&
      index.fields.some(
        (entry) => entry.fieldPath === field && entry.order === "DESCENDING",
      ),
  );

test("every descending query has a descending index", () => {
  const sorts = descendingSorts();
  assert.ok(
    sorts.length > 0,
    "the scanner found no descending queries at all — it has stopped working",
  );
  const missing = sorts
    .filter((sort) => !hasDescendingIndex(sort.collection, sort.field))
    .map(
      (sort) =>
        `${sort.collection}.${sort.field} is sorted descending in ${sort.where}, but firestore.indexes.json has no DESCENDING index for it`,
    );
  assert.deepEqual([...new Set(missing)], []);
});

/** The one that failed in production, named so a revert is obvious. */
test("the crew workspace's own sort is covered", () => {
  assert.equal(hasDescendingIndex("crewAssignments", "arrivalAt"), true);
});
