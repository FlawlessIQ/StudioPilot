/**
 * Fill StudioCue's vendor database from what studios already have
 * (docs/vendor-network-plan-2026-10-12.md, Phase 4).
 *
 * The trigger (functions/src/saas/platform-vendors.ts) records a vendor the
 * moment a team entry is booked or changed, so everything entered before it
 * was deployed is missing. This reads:
 * - every booked vendor team entry (`projectVendors`), and
 * - every directory vendor (`vendors`) with an address and jobs in
 *   `projectIds` — vendors put on jobs before the vendor team existed —
 * and records each through the same pure rules the trigger uses
 * (`sightingFrom`, `mergeSighting`). Idempotent: a job or studio already
 * counted is not counted again, so a second run changes nothing.
 *
 * DRY RUN by default: prints how many vendors it would record, by kind and
 * prospect, and writes nothing. `--write` records them.
 *
 *   # the emulator (FIRESTORE_EMULATOR_HOST set)
 *   npx tsx scripts/backfill-platform-vendors.mts
 *   npx tsx scripts/backfill-platform-vendors.mts --write
 *
 *   # production needs --prod as well, and your gcloud application-default credentials
 *   npx tsx scripts/backfill-platform-vendors.mts --prod
 *   npx tsx scripts/backfill-platform-vendors.mts --prod --write
 */
import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { FieldPath, getFirestore, type DocumentData, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import { mergeSighting, recordSighting, sightingFrom, type VendorSighting } from "../functions/src/saas/platform-vendors.ts";

const args = process.argv.slice(2);
const write = args.includes("--write");
const prod = args.includes("--prod");
const emulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

if (!emulator && !prod) {
  console.error("Refusing to run: set FIRESTORE_EMULATOR_HOST for the emulator, or pass --prod for studiohub-prod.");
  process.exit(1);
}
if (emulator && prod) {
  console.error("FIRESTORE_EMULATOR_HOST is set and --prod was passed; pick one.");
  process.exit(1);
}
if (!getApps().length) {
  initializeApp(
    emulator
      ? { projectId: process.env.GOOGLE_CLOUD_PROJECT ?? "studiohub-dev" }
      : { credential: applicationDefault(), projectId: "studiohub-prod" },
  );
}
const db = getFirestore();
const now = new Date().toISOString();
const GONE = new Set<string>(["LOST", "CANCELLED", "ARCHIVED"]);

async function* pages(collection: string): AsyncGenerator<QueryDocumentSnapshot> {
  let cursor: QueryDocumentSnapshot | undefined;
  for (;;) {
    let query = db.collection(collection).orderBy(FieldPath.documentId()).limit(500);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    for (const doc of page.docs) yield doc;
    if (page.size < 500) return;
    cursor = page.docs[page.size - 1];
  }
}

const cache = new Map<string, DocumentData | null>();
async function read(path: string): Promise<DocumentData | null> {
  if (!cache.has(path)) {
    const snapshot = await db.doc(path).get();
    cache.set(path, snapshot.exists ? (snapshot.data() ?? null) : null);
  }
  return cache.get(path) ?? null;
}

const sightings: VendorSighting[] = [];
async function consider(entry: DocumentData, at: string) {
  const tenantId = String(entry.tenantId ?? "");
  const projectId = String(entry.projectId ?? "");
  const project = projectId ? await read(`projects/${projectId}`) : null;
  // The trigger's rule: a vendor the team has booked counts whatever the job's
  // own state (platform-vendors.ts recordTeamEntry); only a job gone for good doesn't.
  if (!project || project.tenantId !== tenantId || GONE.has(String(project.state ?? ""))) return;
  const vendorId = String(entry.vendorId ?? "");
  const vendor = vendorId ? await read(`vendors/${vendorId}`) : null;
  const tenant = await read(`tenants/${tenantId}`);
  const sighting = sightingFrom({
    entry,
    project,
    vendor: vendor && vendor.tenantId === tenantId ? vendor : null,
    plannerTrade: tenant?.trade === "planner",
    at,
  });
  if (sighting) sightings.push(sighting);
}

let entries = 0;
for await (const doc of pages("projectVendors")) {
  entries += 1;
  const data = doc.data();
  await consider(data, String(data.updatedAt ?? data.createdAt ?? now));
}

// Directory vendors on booked jobs, from before the vendor team existed.
let directory = 0;
for await (const doc of pages("vendors")) {
  const vendor = doc.data();
  if (vendor.archivedAt || !String(vendor.email ?? "").includes("@")) continue;
  const projectIds = Array.isArray(vendor.projectIds) ? vendor.projectIds.map(String).slice(0, 200) : [];
  for (const projectId of projectIds) {
    directory += 1;
    await consider(
      {
        tenantId: vendor.tenantId,
        projectId,
        vendorId: doc.id,
        status: "booked",
        category: vendor.type,
        email: vendor.email,
        company: vendor.company,
        contactName: vendor.contactName,
        phone: vendor.phone,
        source: "studio",
      },
      String(vendor.updatedAt ?? vendor.createdAt ?? now),
    );
  }
}

// What the database would hold, merged as the trigger merges.
const merged = new Map<string, DocumentData>();
for (const sighting of [...sightings].sort((left, right) => left.at.localeCompare(right.at)))
  merged.set(sighting.hash, mergeSighting(merged.get(sighting.hash) ?? null, sighting));
const count = (field: string) => {
  const tally = new Map<string, number>();
  for (const vendor of merged.values()) tally.set(String(vendor[field]), (tally.get(String(vendor[field])) ?? 0) + 1);
  return [...tally].sort((left, right) => right[1] - left[1]).map(([key, value]) => `${key} ${value}`).join(", ");
};
console.log(`Read ${entries} team entries and ${directory} directory job links.`);
console.log(`${merged.size} vendors from ${sightings.length} sightings.`);
console.log(`By kind: ${count("kind") || "none"}`);
console.log(`By prospect: ${count("prospect") || "none"}`);
console.log(`Seen at more than one studio: ${[...merged.values()].filter((vendor) => Number(vendor.studiosSeen) > 1).length}`);

if (!write) {
  console.log("\nDry run: nothing written. Pass --write to record them.");
  process.exit(0);
}
let written = 0;
for (const sighting of sightings) {
  await recordSighting(db, sighting);
  written += 1;
}
console.log(`\nRecorded ${written} sightings into ${merged.size} vendors.`);
