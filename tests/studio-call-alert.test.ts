import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { studioCallLabel } from "../functions/src/booking/studio-call-alert.ts";
import { renderEmailTemplate } from "../functions/src/communications/email-templates.ts";

/**
 * Gabe, 2026-10-12: a couple booked a Saturday consultation from their link,
 * and the studio's only sign was a card on Today — "should get email too.
 * Right?" A booking, a move and a cancellation by the client now email the
 * studio as well.
 */

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const brand = { studioName: "GR Productions", productName: "StudioCue", accentColor: "#35664a", logoUrl: null, contactEmail: null };
const render = (values: Record<string, unknown>) =>
  renderEmailTemplate({ key: "studio_call_booked", brand, recipientName: "Gabe", values: { actionUrl: "https://studio-cue.com/studio/projects/p1", ...values } });

test("the call in the studio's own words", () => {
  assert.equal(studioCallLabel(undefined, "photographer"), "consultation");
  assert.equal(studioCallLabel("final_details", "photographer"), "final details call");
  assert.equal(studioCallLabel("trial", "makeup"), "trial");
  assert.equal(studioCallLabel(undefined, "dj"), "vibe call");
});

test("booked, moved and canceled each say what happened and when", () => {
  const booked = render({ change: "booked", who: "Ernie", callLabel: "consultation", whenLabel: "Sat, Oct 17, 11:00 AM", formatLabel: "on Zoom", jobName: "Ernie Spags Wedding" });
  assert.equal(booked.subject, "Ernie booked a consultation: Sat, Oct 17, 11:00 AM");
  assert.match(booked.text, /Ernie booked a consultation \(Ernie Spags Wedding\) for Sat, Oct 17, 11:00 AM, on Zoom\./);
  assert.match(booked.html, /href="https:\/\/studio-cue\.com\/studio\/projects\/p1"/);
  const moved = render({ change: "moved", who: "Ernie", callLabel: "consultation", whenLabel: "Sun, Oct 18, 2:00 PM", previousWhenLabel: "Sat, Oct 17, 11:00 AM" });
  assert.equal(moved.subject, "Ernie moved their consultation to Sun, Oct 18, 2:00 PM");
  assert.match(moved.text, /It was Sat, Oct 17, 11:00 AM/);
  const cancelled = render({ change: "cancelled", who: "Ernie", callLabel: "consultation", whenLabel: "Sat, Oct 17, 11:00 AM", reason: "We found a closer studio" });
  assert.equal(cancelled.subject, "Ernie canceled their consultation (Sat, Oct 17, 11:00 AM)");
  assert.match(cancelled.text, /We found a closer studio/);
});

test("wired: every way a client books, moves or cancels a call queues it, and a lapsed studio still gets it", () => {
  const source = read("functions/src/booking/public-scheduling.ts");
  assert.equal((source.match(/change: "cancelled"/g) ?? []).length, 1, "the couple's cancel");
  assert.match(source, /change: previous \? "moved" : "booked"/, "the couple's inquiry link");
  assert.match(source, /change: "booked",\s*who: text\(contact\?\.get\("firstName"\)\)/, "a studio-sent scheduling link");
  assert.match(read("functions/src/saas/billing-hold.ts"), /"studio_call_booked"/);
});
