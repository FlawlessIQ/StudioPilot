/**
 * Give an existing tenant the starter questionnaires.
 *
 * `saas/onboarding.ts` creates these when a studio signs up, so every tenant
 * created before that shipped has none — and "Questionnaire complete" is a
 * blocking readiness checkpoint on the starter wedding workflow, so those
 * studios can only ever waive it.
 *
 * Deliberately conservative, because this writes to a real studio's data:
 *
 *   - Dry run by default. Pass `--apply` to write.
 *   - One template per event type, and an event type that already has any
 *     questionnaire template is skipped entirely — a studio's own form, or one
 *     they have edited, is never replaced or competed with.
 *   - Deterministic document ids, so running it twice creates nothing new.
 *   - Definitions imported from features/questionnaires/starter-templates.ts
 *     rather than restated, for the same reason the seed imports them.
 *
 * Usage:
 *   npx tsx scripts/backfill-starter-questionnaires.ts --project studiohub-prod
 *   npx tsx scripts/backfill-starter-questionnaires.ts --project studiohub-prod --apply
 *   …optionally --tenant <tenantId> to limit it to one studio.
 */

import { createHash } from "node:crypto";
import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { starterQuestionnaires } from "../features/questionnaires/starter-templates";

const argument = (flag: string): string | null => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
};

const projectId = argument("--project");
const onlyTenant = argument("--tenant");
const apply = process.argv.includes("--apply");

if (!projectId) {
  throw new Error("Pass --project <firebaseProjectId>.");
}

if (!getApps().length) {
  initializeApp({ credential: applicationDefault(), projectId });
}
const db = getFirestore();

/** Stable per tenant and event type, so a second run is a no-op. */
const templateId = (tenantId: string, eventTypeId: string) =>
  `starter_questionnaire_${createHash("sha256")
    .update(`${tenantId}:${eventTypeId}`)
    .digest("hex")
    .slice(0, 24)}`;

const tenants = onlyTenant
  ? [await db.doc(`tenants/${onlyTenant}`).get()]
  : (await db.collection("tenants").get()).docs;

const now = new Date().toISOString();
let created = 0;
let skipped = 0;

for (const tenant of tenants) {
  if (!tenant.exists) {
    console.log(`tenant ${tenant.id}: not found`);
    continue;
  }
  const existing = await db
    .collection("questionnaireTemplates")
    .where("tenantId", "==", tenant.id)
    .get();
  const covered = new Set(
    existing.docs.map((document) => String(document.get("eventTypeId"))),
  );
  console.log(
    `\ntenant ${tenant.id} (${tenant.get("brandName") ?? "unnamed"}) — ${existing.size} existing template(s)`,
  );

  for (const starter of starterQuestionnaires()) {
    if (covered.has(starter.eventTypeId)) {
      console.log(
        `  skip ${starter.eventTypeId}: already has a questionnaire template`,
      );
      skipped += 1;
      continue;
    }
    const id = templateId(tenant.id, starter.eventTypeId);
    const fields = starter.sections.reduce(
      (total, section) => total + section.fields.length,
      0,
    );
    console.log(
      `  ${apply ? "create" : "would create"} ${starter.eventTypeId}: "${starter.name}" — ${starter.sections.length} sections, ${fields} fields`,
    );
    if (apply) {
      // `set` rather than `create`: a re-run must not fail on a document this
      // script wrote itself.
      await db.doc(`questionnaireTemplates/${id}`).set({
        id,
        tenantId: tenant.id,
        name: starter.name,
        eventTypeId: starter.eventTypeId,
        status: "active",
        sections: starter.sections,
        dueDaysBeforeEvent: starter.dueDaysBeforeEvent,
        reminderDaysBeforeDue: starter.reminderDaysBeforeDue,
        version: 1,
        createdAt: now,
        updatedAt: now,
        createdBy: "backfill-starter-questionnaires",
        updatedBy: "backfill-starter-questionnaires",
        archivedAt: null,
      });
    }
    created += 1;
  }
}

console.log(
  `\n${apply ? "Created" : "Would create"} ${created} template(s); skipped ${skipped}.`,
);
if (!apply) console.log("Dry run. Pass --apply to write.");
