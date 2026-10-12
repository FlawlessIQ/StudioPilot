/**
 * Give returning clients the jobs their portal accounts could not open.
 *
 * Until functions/src/client/returning-client-access.ts, a client's
 * membership gained a job only by accepting an invitation, and a client who
 * already had a portal account was never sent one. So a returning client's
 * later jobs — Priya Shah's Sangeet at Jess Styles Bridal, booked 2026-10-12
 * beside her wedding — were never on their account: the links in their
 * emails opened the old job, and nothing let them reach the new one.
 *
 * New sends and new jobs grant access on their own now. This brings the jobs
 * made before that to the same place, for one studio at a time:
 *
 *   memberships/{tenantId}_{uid}   the job added to `projectIds` (arrayUnion),
 *                                  for a job's client contact whose portal
 *                                  account has an ACTIVE client membership in
 *                                  this studio that lacks the job.
 *   auditEvents                    one `client.project_access_granted` each.
 *
 * Nothing else. A revoked, suspended or missing membership is reported and
 * left exactly as it is — never re-activated; the studio's next send carries
 * an invitation for that client. So is an account accepted with an address
 * the studio has since changed on the contact (email_changed): it proves
 * nothing about whoever holds the new one.
 *
 * Skipped, as the server's own job trigger skips them (automaticGrantHold): a
 * job put away (archived, deleted, lost); an inquiry that made itself a job
 * and that nobody at the studio has acted on yet — the public form and inbox
 * capture take anyone's word for an address; and an imported booking still
 * held quiet (ADR 0005). Each of those reaches the account with the studio's
 * first send for it.
 *
 * Each grant is re-checked inside its own transaction before it is written,
 * job and all, by the same rule the server uses (accessPlanFromSnapshots).
 *
 * Dry by default; `--apply` writes. Each studio is named explicitly: there is
 * no "all".
 *
 *   npx tsx scripts/backfill-returning-client-access.mts --tenant <id>[,<id>…]
 *   npx tsx scripts/backfill-returning-client-access.mts --tenant <id> --apply
 *
 * Runs against studiohub-prod with your gcloud application-default
 * credentials, or the emulator when FIRESTORE_EMULATOR_HOST is set.
 * Idempotent: a second run finds every such job already on the account.
 */
import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore, type DocumentSnapshot } from "firebase-admin/firestore";
import {
  accessGrantKey,
  accessPlanFromSnapshots,
  automaticGrantHold,
  jobClientContactIds,
  type AutomaticGrantHold,
  type ClientAccessPlan,
  type GrantHoldJob,
} from "../functions/src/client/returning-client-access.ts";

const ACTOR = "backfill:returning-client-access";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
if (args.includes("--all")) {
  console.error("There is no --all: name each studio with --tenant <id>.");
  process.exit(1);
}
const tenantIds = [
  ...new Set(
    args
      .flatMap((arg, index) =>
        arg === "--tenant" ? [args[index + 1] ?? ""] : arg.startsWith("--tenant=") ? [arg.slice("--tenant=".length)] : [],
      )
      .flatMap((value) => value.split(","))
      .map((value) => value.trim())
      .filter((value) => value && !value.startsWith("--")),
  ),
];

if (!tenantIds.length) {
  console.error("usage: npx tsx scripts/backfill-returning-client-access.mts --tenant <id>[,<id>…] [--apply]");
  process.exit(1);
}

const emulator = process.env.FIRESTORE_EMULATOR_HOST;
if (!getApps().length) {
  initializeApp(
    emulator
      ? { projectId: process.env.GOOGLE_CLOUD_PROJECT ?? "studiohub-dev" }
      : { credential: applicationDefault(), projectId: process.env.FIREBASE_PROJECT ?? "studiohub-prod" },
  );
}
const db = getFirestore();

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

function planFor(tenantId: string, projectId: string, contact: DocumentSnapshot, membership: DocumentSnapshot | null): ClientAccessPlan {
  return accessPlanFromSnapshots({ tenantId, projectId, contact, membership });
}

const holdFor = (project: DocumentSnapshot): AutomaticGrantHold | null =>
  automaticGrantHold((project.data() ?? null) as GrantHoldJob | null);

/** Grants one job to one account, if the rule still says so when it is written. */
async function grant(tenantId: string, projectId: string, contactId: string, now: string): Promise<boolean> {
  return db.runTransaction(async (transaction) => {
    // The job as it is now: still this studio's, still not on hold, and still
    // this contact's.
    const project = await transaction.get(db.doc(`projects/${projectId}`));
    if (!project.exists || project.get("tenantId") !== tenantId || holdFor(project)) return false;
    if (!jobClientContactIds(project.get("clientContactIds")).includes(contactId)) return false;
    const contact = await transaction.get(db.doc(`contacts/${contactId}`));
    const uid = contact.exists && contact.get("tenantId") === tenantId ? text(contact.get("portalUserId")) : "";
    const membershipReference = uid ? db.doc(`memberships/${tenantId}_${uid}`) : null;
    const membership = membershipReference ? await transaction.get(membershipReference) : null;
    if (!membershipReference || planFor(tenantId, projectId, contact, membership) !== "grant") return false;
    transaction.update(membershipReference, {
      projectIds: FieldValue.arrayUnion(projectId),
      updatedAt: now,
      updatedBy: ACTOR,
    });
    const audit = db.collection("auditEvents").doc();
    transaction.create(audit, {
      id: audit.id,
      tenantId,
      projectId,
      actorId: ACTOR,
      actorType: "system",
      action: "client.project_access_granted",
      entityType: "membership",
      entityId: membershipReference.id,
      timestamp: now,
      before: null,
      after: { projectId, contactId, reason: "backfill" },
      ipAddress: null,
      userAgent: null,
      correlationId: accessGrantKey(tenantId, uid, projectId),
      automationRunId: null,
      providerEventId: null,
    });
    return true;
  });
}

async function backfillTenant(tenantId: string, now: string): Promise<number> {
  const tenant = await db.doc(`tenants/${tenantId}`).get();
  if (!tenant.exists) {
    console.log(`✗ ${tenantId}: no such studio — skipped`);
    return 0;
  }
  const name = text(tenant.get("businessName")) || text(tenant.get("brandName")) || tenantId;
  console.log(`■ ${name} (${tenantId})`);

  const held = new Map<AutomaticGrantHold, number>();
  const projects = (await db.collection("projects").where("tenantId", "==", tenantId).get()).docs.filter(
    (project) => {
      if (project.get("tenantId") !== tenantId) return false;
      const hold = holdFor(project);
      if (hold) held.set(hold, (held.get(hold) ?? 0) + 1);
      return !hold;
    },
  );
  if (held.size)
    console.log(
      `    held back, as the server's job trigger holds them (a send still gives them): ${[...held].map(([hold, count]) => `${count} ${hold.replace(/_/g, " ")}`).join(", ")}`,
    );
  const contacts = new Map<string, DocumentSnapshot>();
  const memberships = new Map<string, DocumentSnapshot>();
  let found = 0;
  let written = 0;
  for (const project of projects) {
    for (const contactId of jobClientContactIds(project.get("clientContactIds"))) {
      if (!contacts.has(contactId)) contacts.set(contactId, await db.doc(`contacts/${contactId}`).get());
      const contact = contacts.get(contactId)!;
      const uid = contact.exists && contact.get("tenantId") === tenantId ? text(contact.get("portalUserId")) : "";
      if (!uid) continue;
      const membershipPath = `memberships/${tenantId}_${uid}`;
      if (!memberships.has(membershipPath)) memberships.set(membershipPath, await db.doc(membershipPath).get());
      const plan = planFor(tenantId, project.id, contact, memberships.get(membershipPath)!);
      const who = text(contact.get("displayName")) || text(contact.get("email")) || contactId;
      const job = `"${text(project.get("name")) || project.id}" ${project.id} (${text(project.get("eventDate")) || "no date"}, ${text(project.get("state"))})`;
      if (plan === "grant") {
        found += 1;
        console.log(`    + ${who} (${contactId}, uid ${uid}) → ${job}`);
        if (apply && (await grant(tenantId, project.id, contactId, now))) written += 1;
      } else if (plan === "email_changed") {
        const membership = memberships.get(membershipPath)!;
        console.log(
          `    ! ${who} (${contactId}) on ${job}: email_changed — account ${uid} was accepted as ${text(membership.get("email"))}, the contact is now ${text(contact.get("email"))}. Left as it is; their next email invites the new address, which can accept once the contact's portalUserId is cleared (an email change does that from now on).`,
        );
      } else if (plan !== "already") {
        console.log(`    · ${who} (${contactId}) on ${job}: ${plan} — left as it is; their next email carries an invitation`);
      }
    }
  }
  if (!found) console.log("    every returning client's jobs are already on their account — nothing to do");
  return apply ? written : found;
}

async function main() {
  const now = new Date().toISOString();
  console.log(`${apply ? "APPLYING" : "DRY RUN (nothing changes)"} · ${emulator ? `emulator ${emulator}` : process.env.FIREBASE_PROJECT ?? "studiohub-prod"}\n`);
  let total = 0;
  for (const tenantId of tenantIds) total += await backfillTenant(tenantId, now);
  console.log(`\n${total} job${total === 1 ? "" : "s"} ${apply ? "added to client accounts" : "would be added to client accounts"}.`);
  if (!apply) console.log("DRY RUN — pass --apply to write.");
  else console.log("Done.");
}

main().catch((caught: unknown) => {
  console.error(caught instanceof Error ? caught.message : caught);
  process.exit(1);
});
