/**
 * Permanently delete every job in one studio: the studio's "start afresh".
 *
 * For a studio that tested with real clients and wants a clean slate (GR
 * Productions, 2026-10-01). The studio itself stays: its owner, team,
 * packages, templates, branding, settings and subscription are untouched.
 * Only jobs, and everything that hangs off them, go.
 *
 * Each job is deleted exactly as "Delete this job permanently" deletes it
 * (functions/src/projects/purge-command.ts, whose sweep this imports rather
 * than copies): every record found by projectId across every collection,
 * each one tenant-checked, the couple's contact once it was their last job,
 * the job's files, and the job record itself last. Each leaves the same
 * projectPurges record and "project.purged" audit tombstone.
 *
 * Two things differ from the one-job delete, because it is the whole studio:
 *   - Live crew offers don't block it. Their assignment rows go with the job.
 *     The photographer is NOT emailed; tell them yourself if it matters.
 *   - Portal logins are tidied. Purged jobs come off every client and crew
 *     membership; a client left with no jobs has their login revoked
 *     (status "revoked", the same value Team uses), so a couple can't sign
 *     in to an empty portal. Pass --keep-client-logins to skip the revoke.
 *
 * Not touched, because they live outside StudioCue: Google Calendar events
 * and QuickBooks invoices the jobs created. The dry run lists none of them.
 *
 * Dry by default: prints everything it would delete and changes nothing.
 *
 *   npx tsx scripts/purge-tenant-jobs.ts <tenantId>
 *   npx tsx scripts/purge-tenant-jobs.ts <tenantId> --confirm "<studio name>"
 *
 * The confirmation must be the studio's exact business name. Runs against
 * studiohub-prod with your gcloud application-default credentials, or the
 * emulator when FIRESTORE_EMULATOR_HOST is set.
 */
import { createHash, randomUUID } from "node:crypto";
import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import {
  contactsToDelete,
  manifest,
  sweepProjectRecords,
} from "../functions/src/projects/purge-command.ts";

const [tenantId] = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const confirmAt = process.argv.indexOf("--confirm");
const confirmation = confirmAt >= 0 ? process.argv[confirmAt + 1] : undefined;
const keepClientLogins = process.argv.includes("--keep-client-logins");
const emulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

if (!tenantId) {
  console.error("Usage: npx tsx scripts/purge-tenant-jobs.ts <tenantId> [--confirm \"<studio name>\"] [--keep-client-logins]");
  process.exit(1);
}

if (!getApps().length) {
  initializeApp(
    emulator
      ? {
          projectId: process.env.GOOGLE_CLOUD_PROJECT ?? "studiohub-dev",
          storageBucket: `${process.env.GOOGLE_CLOUD_PROJECT ?? "studiohub-dev"}.appspot.com`,
        }
      : {
          credential: applicationDefault(),
          projectId: "studiohub-prod",
          storageBucket: "studiohub-prod.firebasestorage.app",
        },
  );
}
const db = getFirestore();

const text = (value: unknown) => (typeof value === "string" ? value : "");

async function main() {
  const tenant = await db.doc(`tenants/${tenantId}`).get();
  if (!tenant.exists) throw new Error(`No tenant ${tenantId}`);
  const studioName = text(tenant.get("businessName")) || text(tenant.get("brandName"));
  const apply = confirmation !== undefined;
  if (apply && confirmation !== studioName) {
    throw new Error(`--confirm must be the studio's exact name: "${studioName}" (got "${confirmation}")`);
  }

  console.log(`${apply ? "DELETING" : "DRY RUN (nothing changes)"}: every job in ${studioName} (${tenantId})`);
  console.log(`Target: ${emulator ? `emulator ${process.env.FIRESTORE_EMULATOR_HOST}` : "studiohub-prod"}\n`);

  const projects = (await db.collection("projects").where("tenantId", "==", tenantId).get()).docs.filter(
    (doc) => doc.get("tenantId") === tenantId,
  );
  if (!projects.length) {
    console.log("No jobs. Nothing to do.");
    return;
  }
  const purgedIds = new Set(projects.map((doc) => doc.id));

  // ── What goes, job by job ────────────────────────────────────────────────
  let totalRecords = 0;
  for (const project of projects) {
    const name = text(project.get("name")) || project.id;
    const lines = await manifest(db, tenantId, project.id);
    const contactIds = (project.get("clientContactIds") as string[] | undefined) ?? [];
    const contacts = await contactsToDelete(db, tenantId, project.id, contactIds);
    const crew = (await db.collection("crewAssignments").where("projectId", "==", project.id).get()).docs.filter(
      (doc) => doc.get("tenantId") === tenantId,
    );
    const [files] = await getStorage().bucket().getFiles({ prefix: `tenants/${tenantId}/projects/${project.id}/` });
    const count = lines.reduce((sum, line) => sum + line.count, 0);
    totalRecords += count;
    console.log(`■ ${name}  [${text(project.get("state")) || "?"}]  ${project.id}`);
    console.log(`    ${lines.map((line) => `${line.count} ${line.collection}`).join(", ")}`);
    console.log(`    files: ${files.length}`);
    // A contact shared with another job here is "kept" for this job but goes
    // with the last one, since every job in the studio is being deleted.
    if (contacts.deleting.length || contacts.keeping.length)
      console.log(`    couple: ${[...contacts.deleting, ...contacts.keeping].map((contact) => contact.name).join(", ")}`);
    for (const assignment of crew)
      console.log(`    crew offer (${text(assignment.get("status"))}): ${text(assignment.get("role")) || "crew"} — not emailed`);
  }

  // ── Portal logins ────────────────────────────────────────────────────────
  const memberships = (await db.collection("memberships").where("tenantId", "==", tenantId).get()).docs.filter(
    (doc) => doc.get("tenantId") === tenantId,
  );
  type MembershipChange = { id: string; role: string; who: string; remaining: string[]; revoke: boolean };
  const membershipChanges: MembershipChange[] = [];
  for (const membership of memberships) {
    const role = text(membership.get("role"));
    if (role !== "client" && role !== "subcontractor") continue;
    const ids = (membership.get("projectIds") as string[] | undefined) ?? [];
    const remaining = ids.filter((id) => !purgedIds.has(id));
    // A client membership that only points at jobs that no longer exist is
    // revoked too, not only one this run empties.
    const projectsStillThere = await Promise.all(
      remaining.map(async (id) => (await db.doc(`projects/${id}`).get()).get("tenantId") === tenantId),
    );
    const live = remaining.filter((_, index) => projectsStillThere[index]);
    const revoke = role === "client" && !keepClientLogins && live.length === 0 && membership.get("status") === "active";
    if (remaining.length !== ids.length || revoke)
      membershipChanges.push({
        id: membership.id,
        role,
        who: text(membership.get("email")) || text(membership.get("userId")),
        remaining: live,
        revoke,
      });
  }
  console.log(`\nPortal logins:`);
  if (!membershipChanges.length) console.log("    none affected");
  for (const change of membershipChanges)
    console.log(
      `    ${change.role} ${change.who}: ${change.revoke ? "login revoked (no jobs left)" : `jobs removed, ${change.remaining.length} left`}`,
    );

  console.log(`\nTotal: ${projects.length} jobs, ${totalRecords} records.`);
  console.log("Stays: the studio, its owner and team, packages, templates, branding, settings, subscription.");
  console.log("Not touched (outside StudioCue): Google Calendar events and QuickBooks invoices for these jobs.");

  if (!apply) {
    console.log(`\nNothing was changed. To delete, run again with:\n  --confirm "${studioName}"`);
    return;
  }

  // ── Delete, one job at a time, the way the purge command does ────────────
  console.log("");
  for (const project of projects) {
    const name = text(project.get("name")) || project.id;
    const contactIds = (project.get("clientContactIds") as string[] | undefined) ?? [];
    const purgeId = createHash("sha256").update(`${tenantId}:script:${project.id}`).digest("hex").slice(0, 40);
    const record = db.doc(`projectPurges/${purgeId}`);
    const startedAt = new Date().toISOString();
    // Written before anything is destroyed: a run that dies half way leaves
    // a record of what it was doing. Re-running finishes the rest.
    await record.set(
      {
        id: purgeId,
        tenantId,
        projectId: project.id,
        projectName: name,
        requestedBy: "platform-script",
        status: "running",
        deleted: {},
        filesDeleted: 0,
        contactsDeleted: [],
        startedAt,
        completedAt: null,
      },
      { merge: true },
    );
    const deleted = await sweepProjectRecords(db, tenantId, project.id);
    const contacts = await contactsToDelete(db, tenantId, project.id, contactIds);
    for (const contact of contacts.deleting) await db.doc(`contacts/${contact.id}`).delete();
    // Last, so a run that dies part way can still find this job and finish.
    await db.doc(`projects/${project.id}`).delete();
    deleted.projects = 1;
    const prefix = `tenants/${tenantId}/projects/${project.id}/`;
    const [files] = await getStorage().bucket().getFiles({ prefix });
    await getStorage().bucket().deleteFiles({ prefix, force: true });
    const completedAt = new Date().toISOString();
    const auditId = randomUUID();
    await db.doc(`auditEvents/${auditId}`).set({
      id: auditId,
      tenantId,
      projectId: null,
      actorId: "platform-script",
      actorType: "platform_admin",
      action: "project.purged",
      entityType: "project",
      entityId: project.id,
      timestamp: completedAt,
      before: { purgeId, documents: deleted, files: files.length, reason: "studio fresh start" },
      after: null,
      ipAddress: null,
      userAgent: "scripts/purge-tenant-jobs.ts",
    });
    await record.update({
      status: "complete",
      deleted,
      filesDeleted: files.length,
      contactsDeleted: contacts.deleting.map((contact) => contact.id),
      completedAt,
    });
    const total = Object.values(deleted).reduce((sum, value) => sum + value, 0);
    console.log(`✓ ${name}: ${total} records, ${files.length} files, ${contacts.deleting.length} contacts`);
  }

  const now = new Date().toISOString();
  for (const change of membershipChanges) {
    await db.doc(`memberships/${change.id}`).update({
      projectIds: change.remaining,
      ...(change.revoke ? { status: "revoked" } : {}),
      updatedAt: now,
      updatedBy: "platform-script",
    });
    console.log(`✓ ${change.role} ${change.who}: ${change.revoke ? "login revoked" : "jobs removed"}`);
  }

  const left = await db.collection("projects").where("tenantId", "==", tenantId).count().get();
  console.log(`\nDone. Jobs left in ${studioName}: ${left.data().count}.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
