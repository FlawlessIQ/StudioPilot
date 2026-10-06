import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { venueFromAnswers } from "@/features/contracts/event-details";
import { renderEmailTemplate } from "../functions/src/communications/email-templates.ts";

/**
 * GR Productions, 2026-10-06: Tiffany accepted a proposal and never got an
 * agreement. Her event details form named the ceremony and reception, the
 * job's venue was blank, so the agreement's Venue field was unresolved and
 * auto-send held the contract — and nobody was told.
 */

const read = (path: string) => readFileSync(path, "utf8");

/** Tiffany's submitted answers, as the contract loader reads them. */
const tiffany = [
  { question: "Event date", answer: "2027-08-28" },
  { question: "Bride's name", answer: "Tiffany O'Donnell" },
  { question: "Bridal prep location", answer: "Bloom, Morristown" },
  { question: "Bridal prep start time", answer: "TBD" },
  { question: "Groom prep location", answer: "Hyatt Morristown" },
  { question: "Ceremony location", answer: "Christ the King" },
  { question: "Ceremony start time", answer: "TBD" },
  { question: "Reception location", answer: "Brooklake Country Club" },
  { question: "Reception start time", answer: "TBD" },
  { question: "Number of invited guests", answer: "250" },
];

test("the venue comes from the couple's ceremony and reception answers", () => {
  assert.equal(venueFromAnswers(tiffany), "Christ the King and Brooklake Country Club");
});

test("one place for both, or only one given, reads as that place", () => {
  assert.equal(
    venueFromAnswers([
      { question: "Ceremony location", answer: "Harbor View Estate" },
      { question: "Reception location", answer: "harbor view estate" },
    ]),
    "Harbor View Estate",
  );
  assert.equal(venueFromAnswers([{ question: "Reception address", answer: "The Grove" }]), "The Grove");
});

test("a question asking for the venue itself wins", () => {
  assert.equal(
    venueFromAnswers([
      { question: "Ceremony location", answer: "St Mary's" },
      { question: "Venue", answer: "Wildflower Barn" },
    ]),
    "Wildflower Barn",
  );
  assert.equal(venueFromAnswers([{ question: "Event location", answer: "Pier 9" }]), "Pier 9");
});

test("not a venue: TBD, times, getting ready, rules about the venue, who runs the ceremony", () => {
  assert.equal(
    venueFromAnswers([
      { question: "Ceremony location", answer: "TBD" },
      { question: "Ceremony start time", answer: "3:00 PM" },
      { question: "Bridal prep location", answer: "Bloom" },
      { question: "Any photography restrictions at the venue?", answer: "No flash" },
      { question: "Ceremony officiant", answer: "Father Brian" },
    ]),
    null,
  );
  assert.equal(venueFromAnswers([]), null);
});

test("the agreement's Venue reads the form when the job has none", () => {
  const sources = read("functions/src/contracts/sources.ts");
  assert.match(
    sources,
    /venue: text\(event\.venue\) \|\| text\(project\.get\("venueName"\)\) \|\| venueFromAnswers\(formAnswers\)/,
  );
});

test("every held agreement tells the studio by email, once per proposal", () => {
  const commands = read("functions/src/contracts/commands.ts");
  const prepare = commands.slice(commands.indexOf("export async function prepareOnAcceptance"));
  assert.match(prepare, /return held\("prepared", "review"\)/);
  assert.match(prepare, /return held\("prepared_needs_fields", "needs_fields"\)/);
  assert.match(prepare, /return held\("prepared_auto_send_signer_inactive", "signer_inactive"\)/);
  assert.match(prepare, /emailJobs\/\$\{emailId\}`\)\.create\(/);
  assert.match(prepare, /studio_contract_waiting_\$\{input\.proposalId\}/);
  // Studio mail is still delivered while a studio's billing has lapsed.
  assert.match(read("functions/src/saas/billing-hold.ts"), /"studio_contract_waiting"/);
});

test("the email names what's missing and links to the agreement", () => {
  const rendered = renderEmailTemplate({
    key: "studio_contract_waiting",
    brand: { studioName: "GR Productions", productName: "StudioCue", accentColor: "#35664a", logoUrl: null, contactEmail: "hello@example.com" } as never,
    values: {
      clientName: "Tiffany O'Donnell",
      reason: "needs_fields",
      missingFields: ["Venue"],
      actionUrl: "https://studio-cue.com/studio/contracts?project=p1",
    },
    projectName: "Tiffany O'Donnell Wedding",
  } as never) as { subject: string; html: string; text: string };
  assert.match(rendered.subject, /agreement is waiting on you/);
  assert.match(rendered.text, /missing: Venue/);
  assert.match(rendered.text, /hasn't received anything yet/);
  assert.match(rendered.html, /studio\/contracts\?project=p1/);

  const review = renderEmailTemplate({
    key: "studio_contract_waiting",
    brand: { studioName: "GR Productions", productName: "StudioCue", accentColor: "#35664a", logoUrl: null, contactEmail: "hello@example.com" } as never,
    values: { clientName: "Avery Lane", reason: "review", missingFields: [] },
    projectName: "Avery & Sam",
  } as never) as { subject: string; text: string };
  assert.match(review.subject, /accepted — the agreement is ready to send/);
  assert.doesNotMatch(review.text, /missing/);
});
