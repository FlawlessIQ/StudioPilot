import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { BUSY_TIME_CALENDARS_COPY } from "../features/integrations/schema";
import { inquiryViews } from "../features/inquiries/stages";
import { ROLE_SUMMARY, ASSIGNABLE_ROLES } from "../features/team/role-summaries";
import {
  assignableRolesFor,
  busyTimesLine,
  callWords,
  inquiryStageWord,
  inquiryViewsFor,
  newJobLine,
  roleLabelFor,
  roleSummaryFor,
} from "../components/studio/trade-words";
import { finishedWord, funnelStagesFor, offerAcceptanceWords } from "../components/reporting/report-words";

/**
 * Studio chrome in the studio's own words (group D2: lists, calendar,
 * reports, settings, integrations, team, Cue, search, page titles).
 *
 * A DJ, makeup artist or hair stylist reads no photographer words; a makeup
 * or hair studio, which has no call before its quote, is never told about a
 * consultation; and a photographer reads exactly what it always did.
 */
const VENDORS = ["dj", "makeup", "hair"] as const;
const PHOTO_WORDS = /\b(photos?|photograph\w*|galler(?:y|ies)|shoot\w*|shot lists?|albums?|coverage|deliverables?)\b/i;
const read = (path: string) => readFileSync(`${process.cwd()}/${path}`, "utf8");
const titleCase = (role: string | null) =>
  (role ?? "Member").split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");

test("a photographer's calls and availability read as they always did", () => {
  for (const trade of [undefined, "photographer"]) {
    const calls = callWords(trade);
    assert.equal(calls.sales, "Consultation");
    assert.equal(calls.booked, "consultations");
    assert.equal(calls.bookedLabel, "Consultations");
    assert.equal(calls.availabilityTitle, "Consultation availability");
    assert.equal(calls.availabilitySubtitle, "When clients can book a call");
    assert.equal(calls.scheduleAction, "Schedule consultation");
    assert.equal(calls.lengthLabel, "Consultation length (minutes)");
    assert.equal(busyTimesLine(trade), BUSY_TIME_CALENDARS_COPY);
    assert.equal(newJobLine(trade), "Start a new photography job");
  }
});

test("a DJ's call is a vibe call", () => {
  const calls = callWords("dj");
  assert.equal(calls.sales, "Vibe call");
  assert.equal(calls.booked, "vibe calls");
  assert.equal(calls.availabilityTitle, "Vibe call availability");
  assert.equal(calls.scheduleAction, "Schedule vibe call");
  assert.match(busyTimesLine("dj"), /book a vibe call over/);
  assert.equal(newJobLine("dj"), "Start a new music job");
});

test("a makeup or hair studio is never told about a consultation, and books trials", () => {
  for (const trade of ["makeup", "hair"]) {
    const calls = callWords(trade);
    assert.equal(calls.sales, null);
    assert.equal(calls.booked, "trials and calls");
    assert.equal(calls.availabilityTitle, "Booking availability");
    assert.equal(calls.availabilitySubtitle, "When clients can book a trial or a call");
    for (const words of [...Object.values(calls).filter((value): value is string => typeof value === "string"), busyTimesLine(trade)])
      assert.doesNotMatch(words, /consult/i, `${trade}: ${words}`);
    assert.equal(newJobLine(trade), `Start a new ${trade} job`);
  }
});

test("no vendor reads a photo word in these lines", () => {
  for (const trade of VENDORS) {
    const calls = callWords(trade);
    const lines = [...Object.values(calls).filter((value): value is string => typeof value === "string"), busyTimesLine(trade), newJobLine(trade)];
    for (const line of lines) assert.doesNotMatch(line, PHOTO_WORDS, `${trade}: ${line}`);
  }
});

test("the crew role is named for the trade, and the video seat only for a photographer", () => {
  assert.equal(roleLabelFor("staff_photographer", "photographer", titleCase), "Staff Photographer");
  assert.equal(roleLabelFor("staff_photographer", undefined, titleCase), "Staff Photographer");
  assert.equal(roleLabelFor("staff_photographer", "dj", titleCase), "Staff DJ");
  assert.equal(roleLabelFor("staff_photographer", "makeup", titleCase), "Staff artist");
  assert.equal(roleLabelFor("staff_photographer", "hair", titleCase), "Staff stylist");
  assert.equal(roleLabelFor("studio_admin", "hair", titleCase), "Studio Admin");
  assert.deepEqual(assignableRolesFor(ASSIGNABLE_ROLES, "photographer"), [...ASSIGNABLE_ROLES]);
  for (const trade of VENDORS) {
    assert.ok(!assignableRolesFor(ASSIGNABLE_ROLES, trade).includes("staff_videographer"));
    // Someone already in the seat keeps it on their own row.
    assert.ok(assignableRolesFor(ASSIGNABLE_ROLES, trade, "staff_videographer").includes("staff_videographer"));
  }
  assert.equal(roleSummaryFor("staff_photographer", "photographer", ROLE_SUMMARY), ROLE_SUMMARY.staff_photographer);
  assert.match(roleSummaryFor("staff_photographer", "dj", ROLE_SUMMARY), /the jobs they play/);
  assert.match(roleSummaryFor("staff_photographer", "makeup", ROLE_SUMMARY), /the jobs they work/);
  assert.ok(ROLE_SUMMARY.staff_photographer.includes("the jobs they shoot"), "the replace above still finds its words");
});

test("the Inquiries stages: a quote for makeup and hair, no call tab, a DJ's vibe call", () => {
  assert.deepEqual(inquiryViewsFor(inquiryViews, "photographer"), inquiryViews.map(([value, label]) => [value, label]));
  assert.equal(inquiryStageWord("proposal", "Proposal", "photographer"), "Proposal");
  assert.equal(inquiryStageWord("consult", "Consult", "photographer"), "Consult");
  assert.equal(inquiryStageWord("consult", "Consult", "dj"), "Vibe call");
  for (const trade of ["makeup", "hair"]) {
    const views = inquiryViewsFor(inquiryViews, trade);
    assert.ok(!views.some(([value]) => value === "consult"), trade);
    assert.deepEqual(views.find(([value]) => value === "proposal"), ["proposal", "Quote"]);
    assert.equal(inquiryStageWord("proposal", "Proposal", trade), "Quote");
  }
});

test("reports: the funnel and the offer in the trade's words", () => {
  const stages = [
    { label: "Inquiries", value: 5 },
    { label: "Consultations", value: 4 },
    { label: "Proposals sent", value: 3 },
    { label: "Contracts signed", value: 2 },
    { label: "Booked", value: 1 },
  ];
  assert.deepEqual(funnelStagesFor(stages, "photographer"), stages);
  assert.deepEqual(offerAcceptanceWords("photographer", 3), { label: "Proposal acceptance", sample: "3 delivered proposals measured" });
  assert.equal(finishedWord("photographer"), "delivered");
  assert.deepEqual(
    funnelStagesFor(stages, "dj").map((stage) => stage.label),
    ["Inquiries", "Vibe calls", "Proposals sent", "Contracts signed", "Booked"],
  );
  for (const trade of ["makeup", "hair"]) {
    assert.deepEqual(
      funnelStagesFor(stages, trade).map((stage) => stage.label),
      ["Inquiries", "Quotes sent", "Contracts signed", "Booked"],
    );
    assert.deepEqual(offerAcceptanceWords(trade, 0), { label: "Quote acceptance", sample: "0 quotes sent and measured" });
    assert.equal(finishedWord(trade), "finished");
  }
});

test("studio pages are titled StudioCue, not the photography marketing title", () => {
  const layout = read("app/studio/layout.tsx");
  assert.match(layout, /default: "StudioCue"/);
  assert.match(layout, /template: "%s · StudioCue"/);
  // The marketing site keeps its photographer title on purpose.
  assert.match(read("app/layout.tsx"), /The office manager for photography studios/);
  assert.match(read("app/studio/settings/[section]/page.tsx"), /key === "availability"\) return \{ title: "Availability" \}/);
});

test("the screens read their words from the trade (source)", () => {
  // Calendar and booking intros, Inquiries tabs: server pages hand the trade's sentence to the client.
  assert.match(read("app/studio/calendar/page.tsx"), /<CalendarIntro \/>/);
  assert.doesNotMatch(read("app/studio/calendar/page.tsx"), /dates and consultations/);
  assert.match(read("app/studio/booking/page.tsx"), /description=\{<BookingChecklistIntro \/>\}/);
  assert.match(read("app/studio/leads/page.tsx"), /<InquiryTabs /);
  assert.match(read("components/inquiries/inquiry-pipeline.tsx"), /inquiryStageWord\(/);
  // Settings, integrations, team, search, subscription.
  assert.match(read("components/settings/settings-shell.tsx"), /calls\.availabilityTitle/);
  assert.match(read("components/settings/consultation-availability.tsx"), /\{calls\.availabilityTitle\}/);
  assert.doesNotMatch(read("components/settings/consultation-availability.tsx"), />Consultation availability</);
  assert.match(read("components/integrations/integration-manager.tsx"), /inTradeWords\(definition, trade\)/);
  assert.match(read("components/team/team-management.tsx"), /roleLabelFor\(role, trade, workspaceRoleLabel\)/);
  assert.match(read("components/layout/app-shell.tsx"), /roleLabelFor\(workspace\.role, workspace\.tenantTrade, workspaceRoleLabel\)/);
  assert.match(read("components/layout/global-search.tsx"), /newJobLine\(workspace\.tenantTrade\)/);
  assert.match(read("components/saas/live-subscription.tsx"), /\.proposal\}s,/);
  assert.match(read("components/reporting/live-reports.tsx"), /funnelStagesFor\(jobFunnelStages/);
});

test("Cue's cards: delivery is gated, calls are refused for a trade with none, the offer is the trade's", () => {
  const studio = read("components/ai/actions/studio-actions.tsx");
  // DeliveryCard and the gallery-link fix refuse a trade that delivers nothing.
  assert.match(studio, /if \(!delivers && action\.action !== "close_job"\)/);
  assert.match(studio, /A trade with nothing to deliver never sent a link to fix/);
  assert.match(studio, /label=\{wantShooting \? vocab\.ownerOnAction : "Not me this time"\}/);
  const booking = read("components/ai/actions/booking-actions.tsx");
  // Every call card refuses a trade with no sales call before anything loads.
  assert.equal(booking.match(/if \(!words\.hasCall\)/g)?.length, 4);
  assert.match(booking, /const title = `Draft a \$\{offer\} for \$\{jobName\(job\)\}`/);
  assert.doesNotMatch(booking, /"Send the proposal"/);
  assert.match(read("components/ai/actions/job-actions.tsx"), /trade: workspace\.tenantTrade \}/);
  assert.match(read("components/ai/copilot-workspace.tsx"), /delivers \|\| option\.trigger !== "delivery_note"/);
});
