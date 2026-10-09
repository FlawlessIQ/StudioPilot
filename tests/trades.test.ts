import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { plansForTrade, planCards, vendorPlanCards } from "../config/saas-plans";
import { planEntitlements } from "../features/subscriptions/entitlements";
import { projectJourney, type JourneyInput } from "../features/journey/steps";
import { projectStateLabel } from "../features/projects/state-label";
import {
  LIVE_TRADES,
  TRADES,
  tradeMoves,
  tradeOf,
  tradeProfile,
  tradeVocab,
  vendorTypeIsLive,
} from "../features/trades/trades";
import { renderEmailTemplate } from "../functions/src/communications/email-templates";
import { entitlements as functionEntitlements } from "../functions/src/saas/stripe";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("the functions copy of trades matches features/", () => {
  const below = (source: string) => source.slice(source.indexOf("// ── mirrored below ──"));
  assert.equal(below(read("functions/src/trades/trades.ts")), below(read("features/trades/trades.ts")));
});

test("a studio from before trades is a photographer", () => {
  assert.equal(tradeOf(undefined), "photographer");
  assert.equal(tradeOf({}), "photographer");
  assert.equal(tradeOf({ trade: "DJ" }), "dj");
  assert.equal(tradeOf("florist"), "photographer");
  assert.equal(tradeVocab(null).didIt, "Yes, we shot it");
  assert.equal(projectStateLabel("EVENT_COMPLETE"), "Shot");
  assert.equal(projectStateLabel("EVENT_COMPLETE", "dj"), "Played");
  assert.equal(projectStateLabel("EVENT_COMPLETE", "hair"), "Done");
});

test("hair and makeup are separate trades on one beauty core", () => {
  assert.deepEqual([...TRADES], ["photographer", "dj", "makeup", "hair"]);
  assert.equal(tradeProfile("makeup").family, "beauty");
  assert.equal(tradeProfile("hair").family, "beauty");
  assert.notEqual(tradeVocab("makeup").crewStep, tradeVocab("hair").crewStep);
});

const base: JourneyInput = {
  projectId: "p1",
  state: "EVENT_COMPLETE",
  eventDate: "2026-09-01",
  today: "2026-09-10",
  lead: null,
  hasConsultation: true,
  proposalStatus: "accepted",
  contractStatus: "completed",
  retainerInvoiceStatus: "paid",
  finalInvoiceStatus: "paid",
  questionnaireStatus: "submitted",
  questionnaireHasAnswers: true,
  scheduleStatus: "approved",
  scheduleHasUsableItems: true,
  crewAccepted: 1,
  crewRequired: 1,
  crewCascadeActive: false,
  coiStatus: null,
  insuranceRequired: "unknown",
  dayBeforeDraftStatus: null,
  hasDelivery: false,
  albumOrReviewDone: false,
};

test("a DJ's job goes from the day to the review: no gallery, no album", () => {
  const photographer = projectJourney(base);
  const keys = photographer.steps.map((step) => step.key);
  assert.ok(keys.includes("delivery"));
  assert.equal(photographer.current?.key, "delivery");

  const dj = projectJourney({ ...base, trade: "dj" });
  const djKeys = dj.steps.map((step) => step.key);
  assert.ok(!djKeys.includes("delivery"), "nothing to deliver");
  // The DJ's day-before note is part of the night now (simpler vendor
  // journeys): no step of its own, for a DJ or a makeup artist.
  assert.ok(!djKeys.includes("day_before"));
  assert.ok(!projectJourney({ ...base, trade: "makeup" }).steps.some((step) => step.key === "day_before"));
  const review = dj.steps.find((step) => step.key === "album_review");
  assert.equal(review?.title, "Review");
  assert.equal(dj.current?.key, "album_review", "the review is next, straight after the day");
  assert.equal(dj.steps.find((step) => step.key === "crew")?.title, "DJ assigned");
  // The run of show is drafted from the planner: one step, named for the form.
  assert.ok(!djKeys.includes("run_of_show"));
  assert.equal(dj.steps.find((step) => step.key === "schedule_form")?.title, "Music & moments planner");
  assert.equal(dj.steps.find((step) => step.key === "event_day")?.title, "The night");
  assert.equal(dj.steps.find((step) => step.key === "event_day")?.detail, "Played");

  const makeup = projectJourney({ ...base, trade: "makeup" });
  assert.equal(makeup.steps.find((step) => step.key === "crew")?.title, "Artists confirmed");
  assert.equal(makeup.steps.find((step) => step.key === "schedule_form")?.title, "Party list");
  assert.ok(!makeup.steps.some((step) => step.key === "run_of_show"));
});

test("a delivery already recorded stays on any trade's journey", () => {
  const dj = projectJourney({ ...base, trade: "dj", hasDelivery: true });
  assert.ok(dj.steps.some((step) => step.key === "delivery"));
});

test("only a trade with nothing to deliver skips editing and delivery", () => {
  assert.deepEqual(tradeMoves("photographer", "EVENT_COMPLETE"), []);
  assert.deepEqual([...tradeMoves("dj", "EVENT_COMPLETE")], ["REVIEW_REQUESTED", "CLOSED"]);
  assert.deepEqual(tradeMoves("dj", "PLANNING"), []);
  // The server allows the move only for that studio's trade.
  const commands = read("functions/src/crm/commands.ts");
  assert.match(commands, /tradeMoves\(tenantSnapshot\.get\("trade"\), project\.state\)/);
});

test("vendor invites go only to trades with a live journey", () => {
  assert.deepEqual([...LIVE_TRADES], ["photographer"]);
  assert.equal(vendorTypeIsLive("videographer"), true);
  assert.equal(vendorTypeIsLive("dj"), false);
  assert.equal(vendorTypeIsLive("hair_makeup"), false);
  assert.equal(vendorTypeIsLive("florist"), false);
  assert.match(read("functions/src/saas/vendor-invites.ts"), /if \(!vendorTypeIsLive\(vendorType\)\) continue;/);
});

test("DJs, makeup and hair buy the $75 plan; photographers never see it", () => {
  assert.deepEqual(planCards.map((card) => card.key), ["studio", "multi_brand"]);
  const [vendor] = vendorPlanCards;
  assert.equal(vendor.monthlyCents, 7_500);
  assert.equal(vendor.yearlyCents, 75_000);
  for (const trade of TRADES) {
    const keys = plansForTrade(tradeProfile(trade).plans).map((card) => card.key);
    assert.deepEqual(keys, trade === "photographer" ? ["studio", "multi_brand"] : ["vendor"], trade);
  }
  assert.deepEqual(planEntitlements.vendor, functionEntitlements.vendor);
  assert.equal(planEntitlements.vendor.maxInternalUsers, 2);
  assert.equal(planEntitlements.vendor.maxActiveSubcontractors, 10);
  assert.equal(planEntitlements.vendor.aiActionsMonthly, 1000);
  assert.match(read("functions/src/saas/stripe.ts"), /tradeProfile\(tenantForPlan\.get\("trade"\)\)\.plans\.includes\(parsed\.plan\)/);
});

test("a new studio starts with its trade's plan and nothing photographic", () => {
  const onboarding = read("functions/src/saas/onboarding.ts");
  assert.match(onboarding, /trade: z\.enum\(TRADES\)\.default\("photographer"\)/);
  assert.match(onboarding, /trade: trade\.trade,/);
  assert.match(onboarding, /recommendedFor\(trade\.trade\)/);
  assert.match(onboarding, /subscriptionPlan: planKey/);
  // Only the routine messages the trade's journey uses (simpler vendor journeys).
  assert.match(onboarding, /day_before_checklist: \{ enabled: trade\.clientDayBefore,/);
  assert.match(onboarding, /schedule_confirmation: \{ enabled: false,/);
  assert.match(onboarding, /final_invoice_notice: \{ enabled: !trade\.journey\.balanceOnTheDay,/);
  assert.match(onboarding, /for \(const starter of photographer \? starterQuestionnaires\(\) : \[\]\)/);
  // Signup offers live trades only, and a `?trade=` link can preselect another.
  const form = read("features/auth/onboarding-form.tsx");
  assert.match(form, /LIVE_TRADES\.includes\(option\.value\) \|\| option\.value === arrivedWith/);
  assert.match(read("features/auth/register-form.tsx"), /rememberChosenTrade\(search\.get\("trade"\)\)/);
});

const brand = { studioName: "Spin Theory", productName: "StudioCue", accentColor: "#35664a", logoUrl: null, contactEmail: null };

test("a DJ's emails don't talk about photography or post-production", () => {
  const thanks = (trade: string) =>
    renderEmailTemplate({ key: "thank_you", brand, recipientName: "Maya", projectName: "Maya & Sam", values: { trade } }).text;
  assert.match(thanks("photographer"), /post-production/);
  assert.doesNotMatch(thanks("dj"), /post-production/);

  const reminder = (trade: string) =>
    renderEmailTemplate({ key: "event_reminder", brand, recipientName: "Maya", projectName: "Maya & Sam", values: { trade, eventKind: "wedding", eventDate: "2027-06-12", portalUrl: "https://studio-cue.com/client" } }).text;
  assert.match(reminder("photographer"), /photography begin on time/);
  assert.doesNotMatch(reminder("dj"), /photograph/);

  const offer = (trade: string, role: string) =>
    renderEmailTemplate({ key: "crew_invitation", brand, recipientName: "Ali", projectName: "Maya & Sam", values: { trade, role, actionUrl: "https://studio-cue.com/crew" } }).subject;
  assert.match(offer("photographer", "Second photographer"), /Photography assignment/);
  assert.match(offer("photographer", "Videographer"), /Video assignment/);
  assert.match(offer("dj", "DJ"), /DJ assignment/);
  assert.match(offer("makeup", "Assistant artist"), /Makeup assignment/);
  // The worker hands every email the studio's trade.
  assert.match(read("functions/src/operations/jobs.ts"), /trade: firstString\(document\.get\("trade"\)\) \?\? tradeOf\(tenant\?\.get\("trade"\)\)/);
});

test("the Console shows each studio's trade", () => {
  assert.match(read("functions/src/console/summary.ts"), /trade: tradeOf\(tenant\.trade\)/);
  assert.match(read("components/console/pages/studios-page.tsx"), /ChipSelect label="Trade"/);
});
