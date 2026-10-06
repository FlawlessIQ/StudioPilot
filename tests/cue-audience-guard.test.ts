import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { EXPLAINERS } from "@/features/help/explainers";
import { GLOSSARY } from "@/features/help/glossary";
import {
  emailTemplateKeys,
  renderEmailTemplate,
} from "../functions/src/communications/email-templates.ts";

/**
 * Couples and crew never see Cue.
 *
 * Cue is the studio's office manager — the studio's hire, seen only inside the
 * studio workspace. Everything a couple or a crew member reads speaks as the
 * studio (docs/positioning-office-manager-plan-2026-10-06.md). A couple told
 * "Cue scheduled your call" is being told the studio handed them to software.
 *
 * "StudioCue" is the company and may appear (footers, "powered by"); the bare
 * word "Cue" may not. Comments are stripped first: code may talk about Cue.
 */

const CUE = /(?<![A-Za-z])Cue(?![A-Za-z])/;

const read = (path: string) => readFileSync(path, "utf8");
/** Strings and JSX text, roughly: the source without its comments. */
const copy = (path: string) =>
  read(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

function sourceFiles(path: string): string[] {
  if (statSync(path).isFile()) return [path];
  return readdirSync(path).flatMap((entry) => {
    const child = join(path, entry);
    if (statSync(child).isDirectory()) return sourceFiles(child);
    return /\.(tsx?|json)$/.test(entry) ? [child] : [];
  });
}

/** Screens a couple, a vendor or a crew member opens. */
const COUPLE_AND_CREW_SOURCES = [
  // The couple's portal.
  "app/client",
  "components/client",
  "features/client",
  // Public couple pages: the /i/ inquiry link, the inquiry form, booking a
  // consultation, replying to an email, the vendor run-of-show share.
  "app/i",
  "app/inquiry",
  "app/schedule",
  "app/reply",
  "app/share",
  "components/inquiries/couple-inquiry-page.tsx",
  "components/crm/lead-intake-form.tsx",
  "components/booking/public-consultation-scheduler.tsx",
  // The crew app. The rest of components/crew is the studio's crew screens.
  "app/crew",
  "components/crew/kit",
  "components/crew/crew-portal-shell.tsx",
  // Scheduled client messages rendered from the job's facts.
  "features/messaging/lifecycle.ts",
  "features/messaging/render.ts",
];

test("couple and crew screens never name Cue", () => {
  const files = COUPLE_AND_CREW_SOURCES.flatMap(sourceFiles);
  assert.ok(files.length > 40, `only ${files.length} files: a listed path moved`);
  const hits = files.flatMap((path) =>
    copy(path)
      .split("\n")
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => CUE.test(line))
      .map(({ line, index }) => `${path}:${index + 1}: ${line.trim()}`),
  );
  assert.deepEqual(hits, [], "speak as the studio, not as Cue");
});

/**
 * Email the studio itself receives. Everything else in emailTemplateKeys goes
 * to a couple, a client, a crew member, a vendor or an insurance agent.
 */
const STUDIO_OR_PLATFORM_EMAIL = new Set<string>([
  "staff_invitation",
  "studio_contract_signed",
  "studio_contract_waiting",
  "studio_booking_confirmed",
  "studio_capture_silent",
  "studio_new_inquiry",
  "studio_schedule_changes_requested",
  "client_message_received",
  "daily_digest",
  "feedback_received",
  "feedback_thanks",
  "feedback_planned",
  "feedback_shipped",
  "platform_message",
  "feedback_reply",
  "billing_trial_ending",
  "billing_payment_failed",
  "billing_payment_recovered",
  // "Cue's first two weeks", to the studio owner during the trial.
  "trial_cue_starts",
  "trial_cue_so_far",
  "trial_cue_without_asking",
]);

const brand = {
  studioName: "Alder & Muse Photography",
  productName: "StudioCue",
  accentColor: "#35664a",
  logoUrl: null,
  contactEmail: "hello@example.com",
};

const values = {
  inviteUrl: "https://example.com/invite",
  actionUrl: "https://example.com/action",
  destinationUrl: "https://example.com/review",
  invoiceUrl: "https://example.com/invoice",
  portalUrl: "https://example.com/portal",
  scheduleUrl: "https://example.com/schedule",
  galleryUrl: "https://example.com/gallery",
  startsAt: "2027-06-12T14:00:00.000Z",
  location: "Studio consultation room",
  venueName: "The Garden Conservatory",
  amountCents: 125000,
  dueDate: "2027-05-12",
};

test("email to couples, clients and crew never names Cue", () => {
  const outward = emailTemplateKeys.filter((key) => !STUDIO_OR_PLATFORM_EMAIL.has(key));
  assert.ok(outward.length >= 40, "the client-facing template list shrank: check the exclusions");
  const hits: string[] = [];
  for (const key of outward) {
    for (const input of [values, {}]) {
      const email = renderEmailTemplate({
        key,
        brand,
        recipientName: "Maren Castillo",
        projectName: "Castillo wedding",
        values: input,
      });
      for (const part of [email.subject, email.preheader, email.text]) {
        if (CUE.test(part)) hits.push(`${key}: ${part.split("\n").find((line) => CUE.test(line))}`);
      }
    }
  }
  assert.deepEqual(hits, [], "client and crew email speaks as the studio");
});

test("couple and crew help never names Cue", () => {
  const hits = [
    ...EXPLAINERS.filter((guide) => guide.audience !== "studio").map((guide) => [guide.id, JSON.stringify(guide)]),
    ...GLOSSARY.filter((term) => term.audience !== "studio").map((term) => [term.id, JSON.stringify(term)]),
  ]
    .filter(([, text]) => CUE.test(text))
    .map(([id]) => id);
  assert.deepEqual(hits, [], "couple and crew guides speak as the studio");
});
