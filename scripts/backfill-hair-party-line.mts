/**
 * Give hair studios made before the hair party line their own.
 *
 * A studio's Party list is copied from the recommended form when it joins
 * (saas/onboarding.ts), so a hair studio that joined before the hair walk
 * (Priya Shah, Jess Styles Bridal, 2026-10-10) still asks for its party with
 * makeup's note — "hair, makeup or both", with sensitive skin and lashes as
 * examples. New hair studios start with a note about hair alone
 * (features/questionnaires/recommended-templates.ts, HAIR_PARTY). This brings
 * the studios before them to the same place:
 *
 *   questionnaireTemplates  A live form whose "party-list" note is still
 *                           makeup's, word for word, is published as its next
 *                           version with that one note replaced, superseding
 *                           the old one exactly as an edit does. Nothing else
 *                           on the form changes, so the studio's own edits to
 *                           other questions stay. A note the studio rewrote is
 *                           its own and is left as it is.
 *
 * Forms already sent keep the version they were sent with, as after any edit
 * (planning/commands.ts, updateQuestionnaireTemplate): Priya's keeps makeup's
 * note, and the next form the studio sends has the hair one. The planning
 * timeline and the inquiry link follow `supersedesTemplateId` to the new
 * version on their own (intake/inquiry-form.ts, resolveInquiryFormTemplate).
 *
 * Dry by default; `--apply` writes. Each studio is named explicitly: there is
 * no "all", and a studio that isn't a hair stylist's is refused — a
 * photographer's above all, and a makeup artist's, whose note this is.
 *
 *   npx tsx scripts/backfill-hair-party-line.mts --tenant <id>[,<id>…]
 *   npx tsx scripts/backfill-hair-party-line.mts --tenant <id> --apply
 *
 * Runs against studiohub-prod with your gcloud application-default
 * credentials, or the emulator when FIRESTORE_EMULATOR_HOST is set.
 * Idempotent: a second run finds the note already the hair one.
 */
import { createHash } from "node:crypto";
import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import { recommendedFor } from "@/features/questionnaires/recommended-templates";
import { tradeOf } from "@/features/trades/trades";

const ACTOR = "backfill:hair-party-line";
const FIELD_ID = "party-list";

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
  console.error("usage: npx tsx scripts/backfill-hair-party-line.mts --tenant <id>[,<id>…] [--apply]");
  process.exit(1);
}

type Field = Record<string, unknown>;
type Section = { fields?: unknown } & Record<string, unknown>;

/** The party line's note on a trade's recommended form. */
function partyNote(trade: "hair" | "makeup"): string {
  const note = recommendedFor(trade)
    .flatMap((form) => form.sections)
    .flatMap((section) => section.fields)
    .find((field) => field.id === FIELD_ID)?.help;
  if (!note) throw new Error(`No ${FIELD_ID} note on the ${trade} form`);
  return note;
}
const MAKEUP_NOTE = partyNote("makeup");
const HAIR_NOTE = partyNote("hair");
if (MAKEUP_NOTE === HAIR_NOTE) throw new Error("The hair and makeup party notes are the same: nothing to do");

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
const sectionsOf = (value: unknown): Section[] =>
  (Array.isArray(value) ? value : []).filter((section): section is Section => typeof section === "object" && section !== null);
const fieldsOf = (section: Section): Field[] =>
  (Array.isArray(section.fields) ? section.fields : []).filter((field): field is Field => typeof field === "object" && field !== null);

/** The form's sections with makeup's party note replaced by the hair one, or null when it doesn't carry makeup's. */
function withHairNote(sections: unknown): Section[] | null {
  let replaced = false;
  const next = sectionsOf(sections).map((section) => ({
    ...section,
    fields: fieldsOf(section).map((field) => {
      if (text(field.id) !== FIELD_ID || field.help !== MAKEUP_NOTE) return field;
      replaced = true;
      return { ...field, help: HAIR_NOTE };
    }),
  }));
  return replaced ? next : null;
}

async function backfillTenant(tenantId: string, now: string): Promise<number> {
  const tenant = await db.doc(`tenants/${tenantId}`).get();
  if (!tenant.exists) {
    console.log(`✗ ${tenantId}: no such studio — skipped`);
    return 0;
  }
  const trade = tradeOf(tenant.get("trade"));
  const name = text(tenant.get("businessName")) || text(tenant.get("brandName")) || tenantId;
  if (trade !== "hair") {
    console.log(`✗ ${name} (${tenantId}): a ${trade} studio, not a hair stylist's — refused`);
    return 0;
  }
  console.log(`■ ${name} (${tenantId}) · ${trade}`);

  const templates = (await db.collection("questionnaireTemplates").where("tenantId", "==", tenantId).get()).docs.filter(
    (template) => template.get("tenantId") === tenantId,
  );
  let written = 0;
  for (const own of templates.filter(live)) {
    const formName = text(own.get("name"));
    const sections = withHairNote(own.get("sections"));
    if (!sections) {
      const asks = sectionsOf(own.get("sections")).some((section) => fieldsOf(section).some((field) => text(field.id) === FIELD_ID));
      if (asks) console.log(`    "${formName}" ${own.id}: its party note isn't makeup's — left as it is`);
      continue;
    }
    // The next version, as an edit numbers it: past every version of this form.
    const version =
      Math.max(
        Number(own.get("version") ?? 1),
        ...templates.filter((template) => text(template.get("name")) === formName).map((template) => Number(template.get("version") ?? 0)),
      ) + 1;
    const id = `hair_party_line_${createHash("sha256").update(`${tenantId}:${own.id}`).digest("hex").slice(0, 24)}`;
    console.log(`    "${formName}" ${own.id} (v${Number(own.get("version") ?? 1)}) → v${version} as ${id}, with the hair party note`);
    written += 3;
    if (!apply) continue;
    const batch = db.batch();
    batch.create(db.doc(`questionnaireTemplates/${id}`), {
      ...own.data(),
      id,
      tenantId,
      status: "active",
      sections,
      version,
      supersedesTemplateId: own.id,
      createdAt: now,
      updatedAt: now,
      createdBy: ACTOR,
      updatedBy: ACTOR,
      archivedAt: null,
    });
    batch.update(db.doc(`questionnaireTemplates/${own.id}`), { status: "archived", archivedAt: now, updatedAt: now, updatedBy: ACTOR });
    const auditId = `hair_party_line_${createHash("sha256").update(`${tenantId}:${own.id}:${now}`).digest("hex").slice(0, 32)}`;
    batch.set(db.doc(`auditEvents/${auditId}`), {
      tenantId,
      projectId: null,
      actorId: ACTOR,
      actorType: "system",
      action: "questionnaire_template.superseded",
      entityType: "questionnaireTemplate",
      entityId: own.id,
      timestamp: now,
      before: { templateId: own.id, version: Number(own.get("version") ?? 1), partyNote: MAKEUP_NOTE },
      after: { templateId: id, version, partyNote: HAIR_NOTE },
      ipAddress: null,
      userAgent: null,
      correlationId: ACTOR,
      automationRunId: null,
      providerEventId: null,
    });
    await batch.commit();
  }
  if (!written) console.log("    no live form carries makeup's party note — nothing to do");
  return written;
}

async function main() {
  const now = new Date().toISOString();
  console.log(`${apply ? "APPLYING" : "DRY RUN (nothing changes)"} · ${emulator ? `emulator ${emulator}` : process.env.FIREBASE_PROJECT ?? "studiohub-prod"}\n`);
  let total = 0;
  for (const tenantId of tenantIds) total += await backfillTenant(tenantId, now);
  console.log(`\n${total} writes${apply ? "" : " would be made"}.`);
  if (!apply) console.log("DRY RUN — pass --apply to write.");
  else console.log("Done.");
}

main().catch((caught: unknown) => {
  console.error(caught instanceof Error ? caught.message : caught);
  process.exit(1);
});
