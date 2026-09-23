/**
 * Give a studio's existing packages the coverage roles they already describe.
 *
 * A package gains `includedCoverage` only when it is next saved, so a studio
 * that had packages before the roles model shipped still carries the old
 * single number — `includedPhotographers` — whatever its description says. For
 * a video-led studio that number is wrong in kind, not just in shape: the
 * reference studio's five cinematic packages each record a videographer as a
 * photographer, which decides who gets offered the job and what the couple is
 * shown on a proposal.
 *
 * Reads the counts out of the description the studio itself wrote, and prints
 * the sentence each one came from so every row can be checked by a person
 * before anything is written.
 *
 * Refuses to touch a package on a `per_crew_member` retainer: there, coverage
 * decides the price, and no automated read of prose should move what a couple
 * owes. Those are listed for the studio to set by hand.
 *
 * Usage:
 *   node scripts/backfill-package-coverage.mjs "<business name>"           # dry run
 *   node scripts/backfill-package-coverage.mjs "<business name>" --apply   # writes
 *
 * Idempotent: a package that already carries `includedCoverage` is skipped.
 */
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const businessName = process.argv[2];
const apply = process.argv.includes("--apply");
if (!businessName) {
  console.error('Usage: node scripts/backfill-package-coverage.mjs "<business name>" [--apply]');
  process.exit(1);
}

initializeApp({ projectId: "studiohub-prod" });
const db = getFirestore();

const WORD = { one: 1, two: 2, three: 3, four: 4, a: 1, an: 1 };

export function deriveCoverage(description) {
  const text = String(description ?? "");
  const counts = { photographer: 0, videographer: 0 };
  const evidence = [];
  const numbered =
    /\b(one|two|three|four|a|an|\d+)\s+(?:[a-z-]+\s+){0,2}?(videographer|photographer)s?\b/gi;
  let match;
  while ((match = numbered.exec(text))) {
    const word = WORD[match[1].toLowerCase()];
    const count = word === undefined ? Number(match[1]) || 1 : word;
    counts[match[2].toLowerCase()] += count;
    evidence.push(match[0].trim());
  }
  // "Second photographer with up to 6 hours" adds one more and carries no
  // number word of its own.
  for (const role of ["photographer", "videographer"]) {
    const already = evidence.some((entry) => /second/i.test(entry));
    if (already) continue;
    const hits = (text.match(new RegExp(`\\bsecond\\s+(?:associate\\s+)?${role}\\b`, "gi")) || []).length;
    if (hits) {
      counts[role] += hits;
      evidence.push(`second ${role}`);
    }
  }
  const coverage = [];
  if (counts.photographer) coverage.push({ role: "photographer", count: counts.photographer });
  if (counts.videographer) coverage.push({ role: "videographer", count: counts.videographer });
  return { coverage, evidence };
}

const tenants = await db.collection("tenants").where("businessName", "==", businessName).get();
if (tenants.size !== 1) {
  console.error(`Expected exactly one tenant named "${businessName}", found ${tenants.size}.`);
  process.exit(1);
}
const tenantId = tenants.docs[0].id;
const packages = await db
  .collection("packages")
  .where("tenantId", "==", tenantId)
  .where("active", "==", true)
  .get();

console.log(`${businessName} — ${packages.size} active packages`);
console.log(apply ? "APPLYING\n" : "DRY RUN — nothing will be written\n");

let written = 0;
let skipped = 0;
let held = 0;
for (const doc of packages.docs) {
  const data = doc.data();
  const { coverage, evidence } = deriveCoverage(data.description);
  const already = Array.isArray(data.includedCoverage) && data.includedCoverage.length;
  const perCrew = String(data.retainerRule && data.retainerRule.type) === "per_crew_member";

  if (already) {
    console.log(`· ${data.name} — already has coverage, skipped`);
    skipped += 1;
    continue;
  }
  if (!coverage.length) {
    console.log(`· ${data.name} — description names no crew, left for the studio`);
    held += 1;
    continue;
  }
  if (perCrew) {
    console.log(`· ${data.name} — PER-CREW RETAINER, held back (coverage decides the price here)`);
    held += 1;
    continue;
  }

  console.log(`→ ${data.name}`);
  console.log(`    ${data.includedPhotographers} photographer(s)  ⇒  ${JSON.stringify(coverage)}`);
  console.log(`    read from: ${evidence.join(" / ")}`);
  if (apply) {
    await doc.ref.update({
      includedCoverage: coverage,
      // Kept in step: `assertCoverageConsistent` refuses a write where the two
      // disagree, and the old field is still read as a fallback by
      // features/packages/coverage.ts for snapshots that predate the change.
      includedPhotographers: coverage.find((item) => item.role === "photographer")?.count ?? 0,
      updatedAt: new Date().toISOString(),
    });
    written += 1;
  }
}

console.log(
  `\n${apply ? `written: ${written}` : "would write: " + (packages.size - skipped - held)}` +
    `  ·  already had coverage: ${skipped}  ·  held for a person: ${held}`,
);
if (!apply) console.log("\nRe-run with --apply once the rows above have been checked.");
