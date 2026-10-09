/**
 * Give vendor studios onboarded before "one form" their one planning form.
 *
 * A DJ, makeup artist or hair stylist studio was created with two forms
 * switched on: StudioCue's event details form (on the inquiry link) and the
 * trade's own — the Music & moments planner or the Party list. Their client
 * was asked where and when twice. New vendor studios now start with the
 * trade's own form alone, which asks the few things the event details form
 * did that the day's plan needs (features/questionnaires/recommended-templates.ts,
 * `recommendedFor`; simpler vendor journeys, Phase 2, Conor 2026-10-09). This
 * brings the studios that came before up to the same place:
 *
 *   questionnaireTemplates  The preloaded event details form
 *                           (`recommendedId: "wedding-event-details"`) is
 *                           archived — only when the trade's own form is
 *                           there and active, so no studio is left with no
 *                           form. It stays in the library to copy.
 *   tenants                 `planningTimeline.formTemplateId` names the
 *                           trade's own form, so the form sent at booking is
 *                           the one form.
 *   leadCaptureSettings     An inquiry link that opened on the archived form
 *                           opens on none (`inquiryEventForm: null`, which is
 *                           the studio's "no form" answer, as if chosen in
 *                           Questionnaires).
 *
 * The trade's own form gains the questions it now asks (a DJ's where and
 * when, which the night is laid out from now that the event details form is
 * gone; a day-of contact on the Party list) only if the studio never changed
 * it: the new questions are published as its next version, superseding the
 * old one exactly as an edit does, so answers already given keep the version
 * they answered. A copy the studio changed is its own, left as it is, and
 * named in the output with what it doesn't ask.
 *
 * Dry by default; `--apply` writes. Each studio is named explicitly: there is
 * no "all", because a photographer's studio must never be touched (one is
 * refused if named by mistake).
 *
 *   npx tsx scripts/backfill-vendor-forms.mts --tenant <id>[,<id>…]
 *   npx tsx scripts/backfill-vendor-forms.mts --tenant <id> --tenant <id> --apply
 *
 * Runs against studiohub-prod with your gcloud application-default
 * credentials, or the emulator when FIRESTORE_EMULATOR_HOST is set.
 * Idempotent: a second run finds the event details form archived and the
 * planning form already chosen.
 */
import { createHash } from "node:crypto";
import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, type QueryDocumentSnapshot, type WriteBatch } from "firebase-admin/firestore";
import { recommendedFor } from "@/features/questionnaires/recommended-templates";
import { tradeProfile } from "@/features/trades/trades";

const ACTOR = "backfill:vendor-forms";
const EVENT_DETAILS_ID = "wedding-event-details";

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
  console.error("usage: npx tsx scripts/backfill-vendor-forms.mts --tenant <id>[,<id>…] [--apply]");
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
const live = (template: QueryDocumentSnapshot) => text(template.get("status")) === "active" && !template.get("archivedAt");
const auditId = (...parts: string[]) =>
  `vendor_forms_${createHash("sha256").update(parts.join(":")).digest("hex").slice(0, 32)}`;
/** Newest first: the highest version, then the latest made. */
const newest = (left: QueryDocumentSnapshot, right: QueryDocumentSnapshot) =>
  Number(right.get("version") ?? 0) - Number(left.get("version") ?? 0) ||
  text(right.get("createdAt")).localeCompare(text(left.get("createdAt")));

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
  set(path: string, data: Record<string, unknown>, merge = false) {
    this.next().set(db.doc(path), data, { merge });
  }
  update(path: string, data: Record<string, unknown>) {
    this.next().update(db.doc(path), data);
  }
  async commit() {
    for (const batch of this.batches) await batch.commit();
  }
}

function audit(
  writes: Writes,
  input: { tenantId: string; action: string; entityType: string; entityId: string; before: unknown; after: unknown; now: string },
) {
  writes.set(`auditEvents/${auditId(input.tenantId, input.action, input.entityId, input.now)}`, {
    tenantId: input.tenantId,
    projectId: null,
    actorId: ACTOR,
    actorType: "system",
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    timestamp: input.now,
    before: input.before,
    after: input.after,
    ipAddress: null,
    userAgent: null,
    correlationId: ACTOR,
    automationRunId: null,
    providerEventId: null,
  });
}

async function backfillTenant(tenantId: string, writes: Writes, now: string): Promise<void> {
  const tenant = await db.doc(`tenants/${tenantId}`).get();
  if (!tenant.exists) {
    console.log(`✗ ${tenantId}: no such studio — skipped`);
    return;
  }
  const trade = tradeProfile(tenant.get("trade"));
  const name = text(tenant.get("businessName")) || text(tenant.get("brandName")) || tenantId;
  if (!trade.journey.oneForm) {
    console.log(`✗ ${name} (${tenantId}): a ${trade.trade} studio keeps its forms — skipped`);
    return;
  }
  console.log(`■ ${name} (${tenantId}) · ${trade.trade}`);

  // The trade's own form: what a studio of this trade now starts with.
  const ownIds = new Set(recommendedFor(trade.trade).map((form) => form.id));
  const templates = (await db.collection("questionnaireTemplates").where("tenantId", "==", tenantId).get()).docs.filter(
    (template) => template.get("tenantId") === tenantId,
  );
  const own = templates.filter((template) => live(template) && ownIds.has(text(template.get("recommendedId")))).sort(newest)[0];
  if (!own) {
    console.log(`    no active ${[...ownIds].join(" / ")} form — nothing changed, so the studio is never left with no form`);
    return;
  }
  console.log(`    own form: "${text(own.get("name"))}" ${own.id} (v${Number(own.get("version") ?? 1)})`);

  // ── The own form's new questions, when the studio never changed it ─────
  let planningFormId = own.id;
  const recommended = recommendedFor(trade.trade).find((form) => form.id === text(own.get("recommendedId")));
  const fieldsOf = (sections: unknown): Array<Record<string, unknown>> =>
    (Array.isArray(sections) ? sections : []).flatMap((section) => {
      const fields = (section as { fields?: unknown } | null)?.fields;
      return Array.isArray(fields) ? (fields as Array<Record<string, unknown>>) : [];
    });
  if (recommended) {
    const stored = fieldsOf(own.get("sections"));
    const fresh = new Map(fieldsOf(recommended.sections).map((field) => [text(field.id), field]));
    const missing = [...fresh.keys()].filter((id) => !stored.some((field) => text(field.id) === id));
    // Unchanged: every question it asks is one of ours, in our words.
    const unedited =
      stored.length > 0 &&
      stored.every((field) => {
        const match = fresh.get(text(field.id));
        return match !== undefined && match.label === field.label && match.type === field.type;
      });
    if (missing.length && unedited) {
      const id = `vendor_forms_${createHash("sha256").update(`${tenantId}:${own.id}`).digest("hex").slice(0, 24)}`;
      const version = Number(own.get("version") ?? 1) + 1;
      console.log(`    publish v${version} of it as ${id}, adding: ${missing.join(", ")}`);
      writes.set(`questionnaireTemplates/${id}`, {
        id,
        tenantId,
        name: text(own.get("name")) || recommended.name,
        eventTypeId: text(own.get("eventTypeId")) || recommended.eventTypeId,
        status: "active",
        sections: recommended.sections,
        dueDaysBeforeEvent: own.get("dueDaysBeforeEvent") ?? recommended.dueDaysBeforeEvent,
        reminderDaysBeforeDue: own.get("reminderDaysBeforeDue") ?? recommended.reminderDaysBeforeDue,
        recommendedId: recommended.id,
        version,
        supersedesTemplateId: own.id,
        createdAt: now,
        updatedAt: now,
        createdBy: ACTOR,
        updatedBy: ACTOR,
        archivedAt: null,
      });
      writes.update(`questionnaireTemplates/${own.id}`, { status: "archived", archivedAt: now, updatedAt: now, updatedBy: ACTOR });
      audit(writes, {
        tenantId,
        action: "questionnaire_template.superseded",
        entityType: "questionnaireTemplate",
        entityId: own.id,
        before: { templateId: own.id, version: version - 1 },
        after: { templateId: id, version, added: missing },
        now,
      });
      planningFormId = id;
    } else if (missing.length) {
      console.log(`    changed by the studio, so left as it is — it doesn't ask: ${missing.join(", ")}`);
    } else console.log("    asks every question already");
  }

  // ── The event details form, archived ──────────────────────────────────
  const eventDetails = templates.filter((template) => live(template) && text(template.get("recommendedId")) === EVENT_DETAILS_ID);
  for (const template of eventDetails) {
    console.log(`    archive "${text(template.get("name"))}" ${template.id}`);
    writes.update(`questionnaireTemplates/${template.id}`, {
      status: "archived",
      archivedAt: now,
      updatedAt: now,
      updatedBy: ACTOR,
    });
    audit(writes, {
      tenantId,
      action: "questionnaire_template.archived",
      entityType: "questionnaireTemplate",
      entityId: template.id,
      before: { status: text(template.get("status")) },
      after: { status: "archived", reason: "A vendor's client fills in one form" },
      now,
    });
  }
  if (!eventDetails.length) console.log("    event details form: none active");

  // ── The planning form ───────────────────────────────────────────────────
  const timeline = (tenant.get("planningTimeline") ?? {}) as Record<string, unknown>;
  const current = text(timeline.formTemplateId) || null;
  if (current !== planningFormId) {
    console.log(`    planning form: ${current ?? "(newest for the event type)"} → ${planningFormId}`);
    writes.update(`tenants/${tenantId}`, {
      "planningTimeline.formTemplateId": planningFormId,
      "planningTimeline.updatedAt": now,
      "planningTimeline.updatedBy": ACTOR,
    });
    audit(writes, {
      tenantId,
      action: "planning_timeline.updated",
      entityType: "tenant",
      entityId: tenantId,
      before: { formTemplateId: current },
      after: { formTemplateId: planningFormId },
      now,
    });
  } else console.log("    planning form: already the trade's own");

  // ── The inquiry link ────────────────────────────────────────────────────
  const archived = new Set(eventDetails.map((template) => template.id));
  const settings = await db.doc(`leadCaptureSettings/${tenantId}`).get();
  const inquiryForm = (settings.get("inquiryEventForm") ?? null) as { templateId?: unknown } | null;
  const inquiryFormId = text(inquiryForm?.templateId);
  if (inquiryFormId && archived.has(inquiryFormId)) {
    console.log(`    inquiry link: opened on ${inquiryFormId} → no form`);
    writes.set(`leadCaptureSettings/${tenantId}`, { tenantId, inquiryEventForm: null, updatedAt: now }, true);
    audit(writes, {
      tenantId,
      action: "inquiry_form_setting.updated",
      entityType: "leadCaptureSettings",
      entityId: tenantId,
      before: { inquiryEventForm: inquiryForm },
      after: { inquiryEventForm: null },
      now,
    });
  } else console.log(`    inquiry link: ${inquiryFormId ? `opens on ${inquiryFormId}, left as it is` : "no form"}`);
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
