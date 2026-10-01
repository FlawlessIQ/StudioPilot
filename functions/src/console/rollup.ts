import type { Auth, UserRecord } from "firebase-admin/auth";
import type { DocumentSnapshot, Firestore } from "firebase-admin/firestore";
import { DEFAULT_HEALTH_WEIGHTS, type HealthWeightKey, type SetupKey } from "./model.js";
import { roleFromClaims } from "./roles.js";
import { buildStudioSummary, type StudioRaw } from "./summary.js";

/**
 * Fills the Console's summary rows (docs/console.md).
 *
 * `consoleStudios/{tenantId}` and `consolePeople/{uid}` are caches: everything
 * in them is derived from records that stay the source of truth, so a row can
 * be rebuilt at any time and nothing is lost if one is wrong. Fields the
 * Console owns — tags, set by saasAdminCommand — are never written here, and
 * every write merges so they survive.
 *
 * Runs every 15 minutes (consoleRollupScheduler) and on demand from a studio's
 * record page.
 */

const DAY = 86_400_000;
const STUDIO_ROLES = new Set([
  "studio_owner",
  "studio_admin",
  "studio_coordinator",
  "staff_photographer",
  "staff_videographer",
]);
const DEAD_QUEUES = [
  ["providerJobs", "status", ["dead_letter", "failed"]],
  ["emailJobs", "status", ["dead_letter", "failed"]],
  ["aiJobs", "status", ["dead_letter", "failed"]],
  ["pdfJobs", "status", ["dead_letter", "failed"]],
  ["automationRuns", "status", ["dead_letter", "failed"]],
  ["domainEvents", "processingStatus", ["processing_failed"]],
] as const;
const ACTIVE_JOB_EXCLUDED = new Set(["CLOSED", "LOST", "ARCHIVED", "CANCELLED", "POSTPONED"]);
const BOOKED_STATES = new Set([
  "BOOKED",
  "PLANNING",
  "READY",
  "EVENT_COMPLETE",
  "POST_PRODUCTION",
  "DELIVERED",
  "REVIEW_REQUESTED",
  "CLOSED",
]);

const text = (value: unknown): string =>
  typeof value === "string" ? value : "";

async function count(query: FirebaseFirestore.Query): Promise<number> {
  const snapshot = await query.count().get();
  return snapshot.data().count;
}

async function exists(query: FirebaseFirestore.Query): Promise<boolean> {
  return !(await query.limit(1).get()).empty;
}

export async function healthWeights(db: Firestore): Promise<Record<HealthWeightKey, number>> {
  const settings = await db.doc("consoleSettings/health").get();
  const stored = (settings.get("weights") ?? {}) as Partial<Record<HealthWeightKey, unknown>>;
  const weights = { ...DEFAULT_HEALTH_WEIGHTS };
  for (const key of Object.keys(weights) as HealthWeightKey[]) {
    const value = stored[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100) weights[key] = value;
  }
  return weights;
}

function latest(values: Array<string | null | undefined>): string | null {
  return values.filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
}

async function gatherStudio(
  db: Firestore,
  auth: Auth,
  tenant: DocumentSnapshot,
  now: Date,
): Promise<StudioRaw> {
  const tenantId = tenant.id;
  const month = now.toISOString().slice(0, 7);
  const since30 = new Date(now.getTime() - 30 * DAY).toISOString();
  const since60 = new Date(now.getTime() - 60 * DAY).toISOString();
  const byTenant = (collection: string) => db.collection(collection).where("tenantId", "==", tenantId);

  const [
    subscription,
    memberships,
    consultation,
    capture,
    coi,
    features,
    usage,
    projects,
    connections,
    hasPackage,
    hasQuestionnaire,
    hasPublicInquiry,
  ] = await Promise.all([
    db.doc(`subscriptions/${tenantId}`).get(),
    byTenant("memberships").get(),
    db.doc(`consultationSettings/${tenantId}`).get(),
    db.doc(`leadCaptureSettings/${tenantId}`).get(),
    db.doc(`coiSettings/${tenantId}`).get(),
    db.doc(`tenantFeatures/${tenantId}`).get(),
    db.doc(`usageCounters/${tenantId}_${month}`).get(),
    byTenant("projects").select("state", "archivedAt", "createdAt").get(),
    byTenant("integrationConnections").select("provider", "status", "archivedAt").get(),
    exists(byTenant("packages").where("active", "==", true)),
    exists(byTenant("questionnaireTemplates").where("status", "==", "active")),
    exists(byTenant("leads").where("source", "==", "public_inquiry")),
  ]);

  const [events30d, eventsPrior30d, emails30d, emailsFailed30d, openFeedback, openTasks, ...deadCounts] =
    await Promise.all([
      count(byTenant("auditEvents").where("actorType", "==", "user").where("timestamp", ">=", since30)),
      count(
        byTenant("auditEvents")
          .where("actorType", "==", "user")
          .where("timestamp", ">=", since60)
          .where("timestamp", "<", since30),
      ),
      count(byTenant("emailJobs").where("createdAt", ">=", since30)),
      count(byTenant("emailJobs").where("status", "==", "dead_letter")),
      count(byTenant("feedback").where("status", "==", "received")),
      count(db.collection("consoleTasks").where("tenantId", "==", tenantId).where("status", "==", "open")),
      ...DEAD_QUEUES.map(([collection, field, statuses]) =>
        count(byTenant(collection).where(field, "in", [...statuses])),
      ),
    ]);

  const members = memberships.docs.filter((doc) => text(doc.get("status")) === "active");
  const internal = members.filter((doc) => STUDIO_ROLES.has(text(doc.get("role"))));
  const ownerUid =
    internal.find((doc) => text(doc.get("role")) === "studio_owner")?.get("userId") ?? tenant.get("createdBy") ?? null;
  const internalUids = [...new Set(internal.map((doc) => text(doc.get("userId"))).filter(Boolean))];

  const [userDocs, authUsers] = await Promise.all([
    internalUids.length ? db.getAll(...internalUids.map((uid) => db.doc(`users/${uid}`))) : Promise.resolve([]),
    internalUids.length
      ? auth.getUsers(internalUids.slice(0, 100).map((uid) => ({ uid }))).then((result) => result.users)
      : Promise.resolve([] as UserRecord[]),
  ]);
  const ownerAuth = authUsers.find((user) => user.uid === ownerUid);
  const ownerDoc = userDocs.find((doc) => doc.id === ownerUid);

  const contract = (tenant.get("defaultContractSettings") ?? {}) as Record<string, unknown>;
  const nativeSigning = features.get("nativeContractSigning") === true;
  const liveConnections = connections.docs.filter((doc) => !doc.get("archivedAt"));
  const signingConnected = liveConnections.some(
    (doc) => ["docusign", "dropbox_sign"].includes(text(doc.get("provider"))) && text(doc.get("status")) === "connected",
  );
  const windows = consultation.get("windows");
  const setup: Record<SetupKey, boolean> = {
    inquiries:
      Boolean(text(capture.get("lastCaptureAt")) || text(capture.get("lastTestCaptureAt"))) || hasPublicInquiry,
    availability: (Array.isArray(windows) && windows.length > 0) || text(consultation.get("mode")) === "open_default",
    packages: hasPackage,
    agreement:
      Boolean(text(contract.templateId)) ||
      text(contract.signatureMode) === "record_own" ||
      (nativeSigning && Boolean(text(contract.agreementTemplateId))) ||
      signingConnected,
    questionnaire: hasQuestionnaire,
    insurance: coi.exists,
  };

  const projectDocs = projects.docs.filter((doc) => !doc.get("archivedAt"));
  const created = projectDocs.map((doc) => text(doc.get("createdAt"))).filter(Boolean).sort();
  const states = projectDocs.map((doc) => text(doc.get("state")));

  return {
    tenantId,
    tenant: tenant.data() ?? {},
    subscription: subscription.exists ? (subscription.data() ?? {}) : null,
    owner: ownerUid
      ? {
          uid: String(ownerUid),
          name: ownerAuth?.displayName ?? (text(ownerDoc?.get("displayName")) || null),
          email: ownerAuth?.email ?? (text(ownerDoc?.get("email")) || null),
        }
      : null,
    members: {
      internal: internal.length,
      crew: members.filter((doc) => text(doc.get("role")) === "subcontractor").length,
      clients: members.filter((doc) => text(doc.get("role")) === "client").length,
    },
    setup,
    jobs: {
      total: projectDocs.length,
      active: states.filter((state) => !ACTIVE_JOB_EXCLUDED.has(state)).length,
      booked: states.filter((state) => BOOKED_STATES.has(state)).length,
      leads: states.filter((state) => state === "LEAD").length,
      closed: states.filter((state) => state === "CLOSED").length,
      firstAt: created[0] ?? null,
      lastAt: created.at(-1) ?? null,
    },
    aiActionsMonth: Number(usage.get("aiActions") ?? 0) || 0,
    emails30d,
    emailsFailed30d,
    events30d,
    eventsPrior30d,
    lastActiveAt: latest(userDocs.map((doc) => text(doc.get("lastActiveAt")) || null)),
    lastSignInAt: latest(
      authUsers.map((user) =>
        user.metadata.lastSignInTime ? new Date(user.metadata.lastSignInTime).toISOString() : null,
      ),
    ),
    integrations: liveConnections.map((doc) => ({
      provider: text(doc.get("provider")) || "unknown",
      status: text(doc.get("status")) || "unknown",
    })),
    deadLetters: deadCounts.reduce((sum, value) => sum + value, 0),
    openFeedback,
    openTasks,
  };
}

export async function refreshStudioSummary(
  db: Firestore,
  auth: Auth,
  tenantId: string,
  options: { now?: Date; weights?: Record<HealthWeightKey, number> } = {},
) {
  const now = options.now ?? new Date();
  const tenant = await db.doc(`tenants/${tenantId}`).get();
  if (!tenant.exists) {
    await db.doc(`consoleStudios/${tenantId}`).set({ removed: true, refreshedAt: now.toISOString() }, { merge: true });
    return null;
  }
  const weights = options.weights ?? (await healthWeights(db));
  const summary = buildStudioSummary(await gatherStudio(db, auth, tenant, now), now, weights);
  await db.doc(`consoleStudios/${tenantId}`).set(summary, { merge: true });
  return summary;
}

type PersonType = "admin" | "studio" | "client" | "crew" | "none";

/**
 * One row per account. Reads Firebase Auth for the facts only Auth has — when
 * someone last signed in, how, whether they're verified or disabled — which is
 * why "last sign-in" here is real where `users.lastLoginAt` never was.
 */
export async function refreshPeople(db: Firestore, auth: Auth, now = new Date()) {
  const [membershipDocs, userDocs, tenantDocs] = await Promise.all([
    db.collection("memberships").select("tenantId", "userId", "role", "status").get(),
    db.collection("users").select("lastActiveAt", "displayName", "email").get(),
    db.collection("tenants").select("brandName", "businessName", "legalName").get(),
  ]);
  const tenantNames = new Map(
    tenantDocs.docs.map((doc) => [
      doc.id,
      text(doc.get("brandName")) || text(doc.get("businessName")) || text(doc.get("legalName")) || doc.id,
    ]),
  );
  const membershipsByUser = new Map<string, { tenantId: string; tenantName: string; role: string; status: string }[]>();
  for (const doc of membershipDocs.docs) {
    const userId = text(doc.get("userId"));
    if (!userId) continue;
    const list = membershipsByUser.get(userId) ?? [];
    list.push({
      tenantId: text(doc.get("tenantId")),
      tenantName: tenantNames.get(text(doc.get("tenantId"))) ?? text(doc.get("tenantId")),
      role: text(doc.get("role")),
      status: text(doc.get("status")),
    });
    membershipsByUser.set(userId, list);
  }
  const usersById = new Map(userDocs.docs.map((doc) => [doc.id, doc]));
  const admins: { uid: string; role: string; email: string | null; name: string | null }[] = [];

  let pageToken: string | undefined;
  let written = 0;
  do {
    const page = await auth.listUsers(1000, pageToken);
    pageToken = page.pageToken;
    let batch = db.batch();
    let pending = 0;
    for (const user of page.users) {
      const memberships = membershipsByUser.get(user.uid) ?? [];
      const active = memberships.filter((item) => item.status === "active");
      const consoleRole = roleFromClaims(user.customClaims ?? null);
      const type: PersonType = consoleRole
        ? "admin"
        : active.some((item) => STUDIO_ROLES.has(item.role))
          ? "studio"
          : active.some((item) => item.role === "subcontractor")
            ? "crew"
            : active.some((item) => item.role === "client")
              ? "client"
              : "none";
      if (consoleRole) admins.push({ uid: user.uid, role: consoleRole, email: user.email ?? null, name: user.displayName ?? null });
      const userDoc = usersById.get(user.uid);
      const name = user.displayName ?? (text(userDoc?.get("displayName")) || null);
      const email = user.email ?? (text(userDoc?.get("email")) || null);
      batch.set(
        db.doc(`consolePeople/${user.uid}`),
        {
          id: user.uid,
          uid: user.uid,
          name,
          email,
          search: `${name ?? ""} ${email ?? ""}`.toLowerCase(),
          type,
          consoleRole,
          emailVerified: user.emailVerified,
          disabled: user.disabled,
          providers: user.providerData.map((provider) => provider.providerId),
          createdAt: user.metadata.creationTime ? new Date(user.metadata.creationTime).toISOString() : null,
          lastSignInAt: user.metadata.lastSignInTime ? new Date(user.metadata.lastSignInTime).toISOString() : null,
          lastActiveAt: text(userDoc?.get("lastActiveAt")) || null,
          memberships,
          studioCount: active.filter((item) => STUDIO_ROLES.has(item.role)).length,
          removed: false,
          refreshedAt: now.toISOString(),
        },
        { merge: true },
      );
      pending += 1;
      written += 1;
      if (pending === 400) {
        await batch.commit();
        batch = db.batch();
        pending = 0;
      }
    }
    if (pending) await batch.commit();
  } while (pageToken);

  // The admin list Settings shows. Claims are the authority; this mirrors them.
  const existing = await db.collection("platformAdmins").get();
  const batch = db.batch();
  const seen = new Set(admins.map((admin) => admin.uid));
  for (const admin of admins) {
    batch.set(
      db.doc(`platformAdmins/${admin.uid}`),
      { id: admin.uid, uid: admin.uid, role: admin.role, email: admin.email, name: admin.name, active: true, syncedAt: now.toISOString() },
      { merge: true },
    );
  }
  for (const doc of existing.docs)
    if (!seen.has(doc.id) && doc.get("active") !== false)
      batch.set(doc.ref, { active: false, syncedAt: now.toISOString() }, { merge: true });
  await batch.commit();
  return { people: written, admins: admins.length };
}

/**
 * Today's totals, for the Revenue page's trends. One document per UTC day,
 * overwritten by every run that day, so the last run of a day is its record.
 */
export async function writeDailyMetrics(db: Firestore, now = new Date()) {
  const rows = await db
    .collection("consoleStudios")
    .where("removed", "==", false)
    .select("mrrCents", "subscriptionStatus", "comped", "lifecycle", "createdAt", "potentialMrrCents")
    .get();
  const day = now.toISOString().slice(0, 10);
  const studios = rows.docs.map((doc) => doc.data());
  const status = (value: string) => studios.filter((studio) => studio.subscriptionStatus === value && studio.comped !== true).length;
  await db.doc(`consoleMetrics/${day}`).set({
    id: day,
    day,
    mrrCents: studios.reduce((sum, studio) => sum + (Number(studio.mrrCents) || 0), 0),
    trialPipelineCents: studios
      .filter((studio) => studio.subscriptionStatus === "trialing" && studio.comped !== true)
      .reduce((sum, studio) => sum + (Number(studio.potentialMrrCents) || 0), 0),
    studios: studios.length,
    paying: status("active"),
    trialing: status("trialing"),
    pastDue: status("past_due"),
    incomplete: status("incomplete"),
    cancelled: status("cancelled"),
    comped: studios.filter((studio) => studio.comped === true).length,
    signups: studios.filter((studio) => typeof studio.createdAt === "string" && studio.createdAt.startsWith(day)).length,
    updatedAt: now.toISOString(),
  });
}

export async function refreshAllSummaries(db: Firestore, auth: Auth, now = new Date()) {
  const weights = await healthWeights(db);
  const tenants = await db.collection("tenants").get();
  const failures: string[] = [];
  // A handful at a time: each studio is ~25 small reads.
  for (let index = 0; index < tenants.docs.length; index += 8) {
    await Promise.all(
      tenants.docs.slice(index, index + 8).map(async (tenant) => {
        try {
          await refreshStudioSummary(db, auth, tenant.id, { now, weights });
        } catch (caught) {
          failures.push(tenant.id);
          console.error(
            JSON.stringify({
              severity: "ERROR",
              event: "console.rollup_studio_failed",
              tenantId: tenant.id,
              detail: caught instanceof Error ? caught.message.slice(0, 300) : "unknown",
            }),
          );
        }
      }),
    );
  }
  const seen = new Set(tenants.docs.map((doc) => doc.id));
  const stale = await db.collection("consoleStudios").where("removed", "==", false).select().get();
  await Promise.all(
    stale.docs
      .filter((doc) => !seen.has(doc.id))
      .map((doc) => doc.ref.set({ removed: true, refreshedAt: now.toISOString() }, { merge: true })),
  );
  const people = await refreshPeople(db, auth, now);
  await writeDailyMetrics(db, now);
  await db.doc("consoleSettings/rollup").set(
    { lastRunAt: now.toISOString(), studios: tenants.size, failures, ...people },
    { merge: true },
  );
  return { studios: tenants.size, failures, ...people };
}
