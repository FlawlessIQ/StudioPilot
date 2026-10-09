/**
 * Give vendor studios onboarded before "simpler vendor journeys" their four
 * readiness checks.
 *
 * A DJ, makeup artist or hair stylist studio was created with a
 * photographer's twelve checks — venue, primary contacts, a certificate of
 * insurance, crew accepted and acknowledging the schedule, locations, travel —
 * and every one of them was something to tick or waive on every job
 * (2026-10-09). New vendor studios now start with four: booked, the planning
 * form in, the day's plan set, the balance paid
 * (features/workflows/starter-templates.ts, `starterTemplates("essentials")`).
 * This brings the studios that came before up to the same place.
 *
 * Two collections, for the reason backfill-checkpoint-dependencies.mts gives:
 * onboarding publishes a *copy* of the templates and every job copies its own
 * checks from it, so fixing the code reaches neither.
 *
 *   workflowTemplates  The studio's unedited starter templates are replaced
 *                      by the essentials, published as the next version of
 *                      the same template — templates are immutable once
 *                      active, so the old version is superseded rather than
 *                      rewritten, exactly as publishing an edit does. A
 *                      template the studio changed itself is left alone and
 *                      named in the output.
 *   checkpoints        On each open job, every check outside the four is
 *                      waived with the note "Not part of a vendor's journey".
 *                      Never one already complete or waived, never one a
 *                      person marked failed, never one whose template forbids
 *                      waiving — and not the certificate check on a job whose
 *                      venue asked for insurance, which stays exactly as a
 *                      photographer's would. If a venue asks later, the
 *                      readiness reconciler takes the waived check back up.
 *
 * Dry by default; `--apply` writes. Each studio is named explicitly: there is
 * no "all", because a photographer's studio must never be touched (one is
 * refused if named by mistake).
 *
 *   npx tsx scripts/backfill-vendor-readiness.mts --tenant <id>[,<id>…]
 *   npx tsx scripts/backfill-vendor-readiness.mts --tenant <id> --tenant <id> --apply
 *
 * Runs against studiohub-prod with your gcloud application-default
 * credentials, or the emulator when FIRESTORE_EMULATOR_HOST is set.
 * Idempotent: a second run finds the four already in place and nothing left
 * to waive. Readiness recomputes itself as the checkpoints change (the
 * deployed readiness triggers), so the scores follow without a second step.
 */
import { createHash, randomUUID } from "node:crypto";
import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, type DocumentSnapshot, type WriteBatch } from "firebase-admin/firestore";
import {
  INSURANCE_CHECK_KEY,
  VENDOR_JOURNEY_WAIVER,
  starterTemplates,
  type StarterTemplate,
} from "@/features/workflows/starter-templates";
import { tradeProfile } from "@/features/trades/trades";

const ACTOR = "backfill:vendor-readiness";
// The readiness reconciler knows this note: a certificate check waived with
// it is taken back up if the venue later asks (workflow/readiness-triggers.ts).
const NOTE = VENDOR_JOURNEY_WAIVER;
/** Jobs with nothing left to be ready for. */
const FINISHED_STATES = new Set(["CLOSED", "ARCHIVED", "CANCELLED", "LOST"]);

const args = process.argv.slice(2);
const apply = args.includes("--apply");
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
  console.error("usage: npx tsx scripts/backfill-vendor-readiness.mts --tenant <id>[,<id>…] [--apply]");
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

const text = (value: unknown): string => (typeof value === "string" ? value : "");
const keysOf = (checkpoints: unknown): string[] =>
  (Array.isArray(checkpoints) ? checkpoints : [])
    .map((checkpoint) => text((checkpoint as { key?: unknown })?.key))
    .sort();
const sameKeys = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length && left.every((key, index) => key === right[index]);
const auditId = (...parts: string[]) =>
  `vendor_readiness_${createHash("sha256").update(parts.join(":")).digest("hex").slice(0, 32)}`;

/** Writes in batches under Firestore's 500, committed only with --apply. */
class Writes {
  private batches: WriteBatch[] = [db.batch()];
  private count = 0;
  total = 0;
  private next(): WriteBatch {
    if (this.count >= 400) {
      this.batches.push(db.batch());
      this.count = 0;
    }
    this.count += 1;
    this.total += 1;
    return this.batches.at(-1)!;
  }
  create(path: string, data: Record<string, unknown>) {
    this.next().create(db.doc(path), data);
  }
  set(path: string, data: Record<string, unknown>) {
    this.next().set(db.doc(path), data);
  }
  update(path: string, data: Record<string, unknown>) {
    this.next().update(db.doc(path), data);
  }
  async commit() {
    for (const batch of this.batches) await batch.commit();
  }
}

async function backfillTenant(tenantId: string, writes: Writes, now: string): Promise<void> {
  const tenant = await db.doc(`tenants/${tenantId}`).get();
  if (!tenant.exists) {
    console.log(`✗ ${tenantId}: no such studio — skipped`);
    return;
  }
  const trade = tradeProfile(tenant.get("trade"));
  const name = text(tenant.get("businessName")) || text(tenant.get("brandName")) || tenantId;
  if (trade.journey.readiness !== "essentials") {
    console.log(`✗ ${name} (${tenantId}): a ${trade.trade} studio keeps its full checks — skipped`);
    return;
  }
  console.log(`■ ${name} (${tenantId}) · ${trade.trade}`);

  // ── Templates ──────────────────────────────────────────────────────────
  const full = starterTemplates();
  const essentials = starterTemplates("essentials", {
    balanceDueDaysBefore: trade.balanceDueDaysBefore,
    balanceOnTheDay: trade.journey.balanceOnTheDay,
  });
  const essentialKeys = new Set(essentials.flatMap((template) => template.checkpointTemplates.map((checkpoint) => checkpoint.key)));
  const templates = (await db.collection("workflowTemplates").where("tenantId", "==", tenantId).get()).docs.filter(
    (template) => template.get("tenantId") === tenantId,
  );
  for (const template of templates) {
    if (template.get("status") !== "active" || template.get("archivedAt")) continue;
    const label = `${text(template.get("name")) || template.id} v${Number(template.get("version") ?? 1)}`;
    const eventTypeId = text(template.get("eventTypeId"));
    const starter = full.find((candidate) => candidate.eventTypeId === eventTypeId);
    const target: StarterTemplate | undefined = essentials.find((candidate) => candidate.eventTypeId === eventTypeId);
    const keys = keysOf(template.get("checkpointTemplates"));
    if (!starter || !target) {
      console.log(`    template ${label}: not a starter event type — left alone`);
      continue;
    }
    if (sameKeys(keys, keysOf(target.checkpointTemplates))) {
      console.log(`    template ${label}: already the essentials`);
      continue;
    }
    if (!sameKeys(keys, keysOf(starter.checkpointTemplates))) {
      console.log(`    template ${label}: changed by the studio (${keys.length} checks) — left alone`);
      continue;
    }
    // Versioned by name, as publishing an edit does (workflow/commands.ts).
    const sameName = templates.filter((candidate) => text(candidate.get("name")) === text(template.get("name")));
    const version = Math.max(...sameName.map((candidate) => Number(candidate.get("version") ?? 1))) + 1;
    const id = randomUUID();
    console.log(`    template ${label}: ${keys.length} checks → v${version} with ${target.checkpointTemplates.length}`);
    writes.update(`workflowTemplates/${template.id}`, { status: "superseded", updatedAt: now, updatedBy: ACTOR });
    writes.create(`workflowTemplates/${id}`, {
      id,
      tenantId,
      name: text(template.get("name")) || target.name,
      description: target.description,
      eventTypeId,
      eventTypeLabel: text(template.get("eventTypeLabel")) || target.eventTypeLabel,
      checkpointTemplates: target.checkpointTemplates,
      automationRules: Array.isArray(template.get("automationRules")) ? template.get("automationRules") : [],
      version,
      status: "active",
      immutable: true,
      publishedAt: now,
      publishedBy: ACTOR,
      createdAt: now,
      updatedAt: now,
      createdBy: ACTOR,
      updatedBy: ACTOR,
      archivedAt: null,
    });
    writes.set(`auditEvents/${auditId(tenantId, template.id, id)}`, {
      tenantId,
      projectId: null,
      actorId: ACTOR,
      actorType: "system",
      action: "workflow_template.created",
      entityType: "workflowTemplate",
      entityId: id,
      timestamp: now,
      before: { workflowTemplateId: template.id, version: version - 1, checkpointCount: keys.length },
      after: { version, status: "active", checkpointCount: target.checkpointTemplates.length, reason: NOTE },
      ipAddress: null,
      userAgent: null,
      correlationId: ACTOR,
      automationRunId: null,
      providerEventId: null,
    });
  }

  // ── Open jobs ──────────────────────────────────────────────────────────
  const [projectDocs, checkpointDocs] = await Promise.all([
    db.collection("projects").where("tenantId", "==", tenantId).get(),
    db.collection("checkpoints").where("tenantId", "==", tenantId).where("archivedAt", "==", null).get(),
  ]);
  const openJobs = new Map<string, DocumentSnapshot>(
    projectDocs.docs
      .filter(
        (project) =>
          project.get("tenantId") === tenantId &&
          !project.get("archivedAt") &&
          !FINISHED_STATES.has(text(project.get("state"))),
      )
      .map((project) => [project.id, project]),
  );
  const byJob = new Map<string, DocumentSnapshot[]>();
  for (const checkpoint of checkpointDocs.docs) {
    if (checkpoint.get("tenantId") !== tenantId) continue;
    const projectId = text(checkpoint.get("projectId"));
    if (!openJobs.has(projectId)) continue;
    byJob.set(projectId, [...(byJob.get(projectId) ?? []), checkpoint]);
  }
  let waived = 0;
  for (const [projectId, checkpoints] of byJob) {
    const project = openJobs.get(projectId)!;
    const insuranceAsked = project.get("insuranceRequired") === "required";
    const lines: string[] = [];
    const settledIds = new Set(
      checkpoints.filter((checkpoint) => ["complete", "waived"].includes(text(checkpoint.get("status")))).map((checkpoint) => checkpoint.id),
    );
    for (const checkpoint of checkpoints) {
      const key = text(checkpoint.get("templateKey"));
      const status = text(checkpoint.get("status"));
      const label = text(checkpoint.get("name")) || key || checkpoint.id;
      if (essentialKeys.has(key)) continue;
      if (key === INSURANCE_CHECK_KEY && insuranceAsked) {
        lines.push(`kept ${label} — the venue asked for insurance`);
        continue;
      }
      if (status === "complete" || status === "waived") continue;
      if (status === "failed") {
        lines.push(`left ${label} — marked failed by a person`);
        continue;
      }
      if (checkpoint.get("waiverAllowed") !== true) {
        lines.push(`left ${label} — its template does not allow waiving`);
        continue;
      }
      lines.push(`waive ${label} (${status || "no status"})`);
      settledIds.add(checkpoint.id);
      waived += 1;
      // The same fields a person's waiver writes (resolveCheckpoint).
      writes.update(`checkpoints/${checkpoint.id}`, {
        status: "waived",
        completionTimestamp: now,
        completionActorId: ACTOR,
        evidence: [],
        notes: NOTE,
        waiverReason: NOTE,
        waiverExpiresAt: null,
        updatedAt: now,
        updatedBy: ACTOR,
      });
      writes.set(`auditEvents/${auditId(tenantId, checkpoint.id, now)}`, {
        tenantId,
        projectId,
        actorId: ACTOR,
        actorType: "system",
        action: "checkpoint.waived",
        entityType: "checkpoint",
        entityId: checkpoint.id,
        timestamp: now,
        before: { status },
        after: { status: "waived", reason: NOTE },
        ipAddress: null,
        userAgent: null,
        correlationId: ACTOR,
        automationRunId: text(checkpoint.get("workflowRunId")) || null,
        providerEventId: null,
      });
    }
    // A check that was waiting on one just waived can start, as it would
    // after a person's waiver. Templates written before the checks were
    // unchained made each one wait on the one before it.
    for (const checkpoint of checkpoints) {
      if (text(checkpoint.get("status")) !== "not_started" || settledIds.has(checkpoint.id)) continue;
      const dependencies = Array.isArray(checkpoint.get("dependencyIds")) ? (checkpoint.get("dependencyIds") as unknown[]) : [];
      if (!dependencies.length || !dependencies.every((id) => settledIds.has(text(id)))) continue;
      lines.push(`ready ${text(checkpoint.get("name")) || checkpoint.id} — what it waited on is settled`);
      writes.update(`checkpoints/${checkpoint.id}`, { status: "ready", updatedAt: now, updatedBy: ACTOR });
    }
    if (lines.length) {
      console.log(`    job ${text(project.get("name")) || projectId} [${text(project.get("state"))}] ${projectId}`);
      for (const line of lines) console.log(`      ${line}`);
    }
  }
  console.log(`    open jobs: ${openJobs.size} · checks to waive: ${waived}`);
}

async function main() {
  const now = new Date().toISOString();
  console.log(`${apply ? "APPLYING" : "DRY RUN (nothing changes)"} · ${emulator ? `emulator ${emulator}` : process.env.FIREBASE_PROJECT ?? "studiohub-prod"}\n`);
  const writes = new Writes();
  for (const tenantId of tenantIds) await backfillTenant(tenantId, writes, now);
  console.log(`\n${writes.total} writes${apply ? "" : " would be made"}.`);
  if (!apply) {
    console.log("DRY RUN — pass --apply to write.");
    return;
  }
  if (writes.total) await writes.commit();
  console.log("Done.");
}

main().catch((caught: unknown) => {
  console.error(caught instanceof Error ? caught.message : caught);
  process.exit(1);
});
