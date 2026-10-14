import assert from "node:assert/strict";
import { test } from "node:test";
import { renderEmailTemplate } from "../functions/src/communications/email-templates.ts";
import { renderLifecycleDraft } from "../functions/src/communications/lifecycle-core.ts";
import { clientAutomationEmailTypes } from "../functions/src/imports/existing-booking.ts";
import { inquiryLinkLine } from "../functions/src/intake/inquiry-link.ts";
import { editableEmailsFor } from "@/features/communications/email-catalog";
import { TRADES } from "@/features/trades/trades";

/**
 * A mitzvah family never reads a wedding's words (docs/mitzvah-journey-plan-2026-10-14.md, Phase 2).
 *
 * The parents are the client and their child is the honoree. Every email a
 * studio of any trade sends a client, rendered for a bar mitzvah, must say
 * nothing of a couple, a bride or groom, a ceremony, a dress or a wedding —
 * and the words that name the event name Sam's bar mitzvah.
 */
// "a couple of minutes" is not a couple.
const WEDDING_WORDS = /\b(weddings?|couples?(?! of\b)|brides?|bridal|grooms?|ceremony|dress|fianc[eé]e?)\b/i;

const brand = { studioName: "Harbor Light Studio", productName: "StudioCue", accentColor: "#35664a", logoUrl: null, contactEmail: null };
const values = {
  eventKind: "mitzvah",
  mitzvahType: "bar",
  honoreeName: "Sam",
  coupleName: "Rachel Cohen",
  eventDate: "2027-05-15",
  venueName: "Temple Beth El",
  actionUrl: "https://studio-cue.com/client",
  portalUrl: "https://studio-cue.com/client",
  shareUrl: "https://studio-cue.com/share/x",
  dueDate: "2027-04-15",
};

const clientKeys = [
  ...new Set([
    ...clientAutomationEmailTypes,
    ...TRADES.flatMap((trade) => editableEmailsFor(trade).map((entry) => entry.key)),
  ]),
].sort();

test("no client email for a mitzvah says wedding, couple, bride, ceremony or dress", () => {
  assert.ok(clientKeys.length > 10, "the client email list came back short");
  const found: string[] = [];
  for (const trade of TRADES) {
    for (const key of clientKeys) {
      let email: ReturnType<typeof renderEmailTemplate>;
      try {
        email = renderEmailTemplate({ key, brand, recipientName: "Rachel", projectName: "Cohen Bar Mitzvah", values: { ...values, trade } });
      } catch {
        continue; // A template that needs values this sample lacks is checked by its own test.
      }
      const text = `${email.subject}\n${email.preheader}\n${email.body}`;
      const match = WEDDING_WORDS.exec(text);
      if (match) found.push(`${trade} ${key}: "${match[0]}" in …${text.slice(Math.max(0, match.index - 40), match.index + 30).replace(/\s+/g, " ")}…`);
    }
  }
  assert.deepEqual(found, [], "a mitzvah family read a wedding's words");
});

test("the day-before and month-out notes name the bar mitzvah, never the dress", () => {
  const facts = {
    studioName: "Harbor Light Studio",
    projectName: "Cohen Bar Mitzvah",
    eventDate: "May 15, 2027",
    venueName: "Temple Beth El",
    packageTotalCents: 500000,
    retainerPaidCents: 150000,
    balanceDueCents: 350000,
    packageNames: ["Portraits and party"],
    paymentsOnRecord: true,
    scheduleUrl: null,
    eventKind: "mitzvah",
    honoreeName: "Sam",
    mitzvahType: "bar",
    trade: "photographer",
    recipientEmail: "rachel@example.com",
    recipientName: "Rachel",
  };
  for (const trigger of ["schedule_confirmation", "final_invoice_notice", "day_before_checklist"] as const) {
    const draft = renderLifecycleDraft(trigger, facts);
    const text = `${draft.subject}\n${draft.body}\n${draft.highlights.join("\n")}`;
    assert.doesNotMatch(text, WEDDING_WORDS, trigger);
  }
  const dayBefore = renderLifecycleDraft("day_before_checklist", facts);
  assert.match(dayBefore.body, /candle-lighting list/i);
  assert.ok(dayBefore.highlights.includes("For Sam's bar mitzvah"));
});

test("the inquiry link asks about Sam's bar mitzvah", () => {
  const line = inquiryLinkLine("https://studio-cue.com/i/x", false, "mitzvah", "photographer", { mitzvahType: "bar", honoreeName: "Sam" });
  assert.match(line, /Sam's bar mitzvah/);
  // Without a name or a type, it's their celebration.
  assert.match(inquiryLinkLine("https://studio-cue.com/i/x", false, "mitzvah", "photographer", {}), /your celebration/);
  // A wedding reads as it always has.
  assert.match(inquiryLinkLine("https://studio-cue.com/i/x", false, "wedding", "photographer"), /your day/);
});
