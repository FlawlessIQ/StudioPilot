/**
 * Give a tenant the starter workflow templates it was created without.
 *
 * `autoInstantiateWorkflow` resolves an active template by event type when
 * a project books, and returns `{ skipped: "no_active_template" }` when the
 * tenant has none. A tenant created before onboarding began publishing the
 * starters therefore books projects that never get a workflow run, never
 * get checkpoints, and sit at "No readiness steps yet" forever — with no
 * error anywhere, because skipping is the designed behaviour. The machinery
 * is fine; it has nothing to resolve.
 *
 * This writes exactly what functions/src/saas/onboarding.ts writes, from
 * the same `starterTemplates()` definitions — the copy in features/, which
 * is the source of truth the functions/ mirror is tested against.
 *
 *   npx tsx scripts/backfill-starter-workflows.mts <tenantId>            # dry run
 *   npx tsx scripts/backfill-starter-workflows.mts <tenantId> --apply
 *   npx tsx scripts/backfill-starter-workflows.mts --all [--apply]       # every studio
 *
 * Trade-aware, as onboarding is: a DJ's studio gets a DJ's checks under
 * "Bar & bat mitzvah (DJ)", never a photographer's twelve. Re-run after a
 * new kind of job gains a starter (2026-10-28: mitzvah, quinceañera, Sweet
 * 16, vow renewal, sacrament and prom had none, so GR's two mitzvahs never
 * got a checklist).
 *
 * Idempotent per event type: a tenant that already has a wedding template
 * keeps the one it has, so this is safe to re-run and safe on a tenant that
 * was onboarded normally.
 *
 * Talks to Firestore over REST with `gcloud auth print-access-token` rather
 * than the Admin SDK, so it works when application-default credentials need
 * their own reauth — which is most of the time on a machine that has only
 * ever run `gcloud auth login`.
 */
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { starterTemplates } from "@/features/workflows/starter-templates";
import { TRADE_LABELS, tradeProfile } from "@/features/trades/trades";

const project = process.env.FIREBASE_PROJECT ?? "studiohub-prod";
const root = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents`;
const all = process.argv.includes("--all");
const tenantArgument = process.argv[2];
const apply = process.argv.includes("--apply");

if (!all && (!tenantArgument || tenantArgument.startsWith("--"))) {
  console.error(
    "usage: npx tsx scripts/backfill-starter-workflows.mts <tenantId|--all> [--apply]",
  );
  process.exit(1);
}

const token = execFileSync("gcloud", ["auth", "print-access-token"], {
  encoding: "utf8",
}).trim();
const headers = {
  authorization: `Bearer ${token}`,
  "content-type": "application/json",
};

/** Plain values to the Firestore REST encoding. */
function toValue(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number")
    return Number.isInteger(value)
      ? { integerValue: String(value) }
      : { doubleValue: value };
  if (typeof value === "string") return { stringValue: value };
  if (Array.isArray(value))
    return { arrayValue: { values: value.map(toValue) } };
  return { mapValue: { fields: toFields(value as Record<string, unknown>) } };
}

/** Only the shape this script reads back out of a runQuery response. */
type RunQueryRow = {
  document?: {
    fields?: { eventTypeId?: { stringValue?: string } };
  };
};

const toFields = (record: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key, toValue(value)]),
  );

/** What onboarding.ts publishes for a studio of this trade. */
function startersFor(tradeValue: unknown) {
  const trade = tradeProfile(tradeValue);
  const photographer = trade.trade === "photographer";
  const starters =
    trade.journey.readiness !== "full"
      ? starterTemplates(trade.journey.readiness, {
          balanceDueDaysBefore: trade.balanceDueDaysBefore,
          balanceOnTheDay: trade.journey.balanceOnTheDay,
        })
      : starterTemplates();
  return starters.map((starter) => ({
    ...starter,
    name: photographer ? starter.name : `${starter.eventTypeLabel} (${TRADE_LABELS[trade.trade]})`,
    description: photographer ? starter.description : starter.description.replace(/ shoot\b/, " event"),
  }));
}

async function tenantIds(): Promise<string[]> {
  if (!all) return [tenantArgument!];
  const ids: string[] = [];
  let pageToken = "";
  do {
    const page = (await fetch(
      `${root}/tenants?pageSize=300&mask.fieldPaths=tenantId${pageToken ? `&pageToken=${pageToken}` : ""}`,
      { headers },
    ).then((response) => response.json())) as { documents?: { name: string }[]; nextPageToken?: string };
    for (const document of page.documents ?? []) ids.push(document.name.split("/").at(-1)!);
    pageToken = page.nextPageToken ?? "";
  } while (pageToken);
  return ids;
}

async function main() {
  let failed = false;
  for (const tenantId of await tenantIds()) {
    if (!(await backfill(tenantId))) failed = true;
  }
  if (!apply) console.log("\nDRY RUN — pass --apply to write.");
  if (failed) process.exit(1);
}

/** One studio. False when a write failed. */
async function backfill(tenantId: string): Promise<boolean> {
  const tenant = (await fetch(`${root}/tenants/${tenantId}`, { headers }).then((response) => response.json())) as {
    fields?: { trade?: { stringValue?: string } };
  };
  const query = (await fetch(`${root}:runQuery`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: "workflowTemplates" }],
        where: {
          fieldFilter: {
            field: { fieldPath: "tenantId" },
            op: "EQUAL",
            value: { stringValue: tenantId },
          },
        },
      },
    }),
  }).then((response) => response.json())) as RunQueryRow[];

  const existing = query.filter((row) => row.document);
  const present = new Set(
    existing.map((row) => row.document?.fields?.eventTypeId?.stringValue),
  );
  const trade = tenant.fields?.trade?.stringValue ?? "photographer";
  console.log(`\n${project}  ${tenantId}  trade=${trade}`);
  console.log(
    `existing templates: ${existing.length}` +
      (existing.length ? ` (${[...present].join(", ")})` : ""),
  );

  const missing = startersFor(trade).filter(
    (starter) => !present.has(starter.eventTypeId),
  );
  console.log(`to create: ${missing.length}`);
  for (const starter of missing)
    console.log(
      `  ${starter.name}  event=${starter.eventTypeId}  checkpoints=${starter.checkpointTemplates.length}`,
    );

  if (!missing.length || !apply) return true;

  const now = new Date().toISOString();
  const actor = "backfill:starter-workflows";
  let created = 0;
  for (const starter of missing) {
    const id = randomUUID();
    const response = await fetch(`${root}/workflowTemplates?documentId=${id}`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        fields: toFields({
          id,
          tenantId,
          name: starter.name,
          description: starter.description,
          eventTypeId: starter.eventTypeId,
          eventTypeLabel: starter.eventTypeLabel,
          checkpointTemplates: starter.checkpointTemplates,
          automationRules: [],
          version: 1,
          status: "active",
          immutable: true,
          publishedAt: now,
          publishedBy: actor,
          createdAt: now,
          updatedAt: now,
          createdBy: actor,
          updatedBy: actor,
          archivedAt: null,
        }),
      }),
    });
    if (response.ok) {
      created += 1;
      console.log(`  created ${starter.name}`);
    } else {
      console.error(
        `  FAILED ${starter.name}: ${(await response.text()).slice(0, 300)}`,
      );
    }
  }

  // Templates appearing without a person having authored them is exactly the
  // kind of change the audit log exists to explain.
  const audit = await fetch(`${root}/auditEvents`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      fields: toFields({
        tenantId,
        projectId: null,
        actorId: actor,
        actorType: "system",
        action: "workflow.starter_templates_backfilled",
        entityType: "workflow_template",
        entityId: tenantId,
        timestamp: now,
        before: { templateCount: existing.length },
        after: {
          templateCount: existing.length + created,
          eventTypes: missing.map((starter) => starter.eventTypeId),
        },
        ipAddress: null,
        userAgent: null,
        correlationId: actor,
        automationRunId: null,
        providerEventId: null,
      }),
    }),
  });
  console.log(audit.ok ? "audit event written" : "audit event FAILED");
  return created === missing.length;
}

void main();
