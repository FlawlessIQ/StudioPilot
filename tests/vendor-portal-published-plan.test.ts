import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { clientAreaItems } from "@/features/client/portal-navigation";
import { tradeProfile, tradeVocab } from "@/features/trades/trades";
import type { ClientNavigation } from "@/server/client/portal-experience";
import { buildClientPortalExperience, planSharedToRead } from "@/server/client/portal-experience";

/**
 * Priya Shah, hair client of Jess Styles Bridal (prod, 2026-10-12): her party
 * list was in and the studio had published her getting-ready schedule the day
 * before (version 1, approvalState "none"), with the job still BOOKED.
 *
 * F16: her portal still said "Your studio will share the getting-ready
 * schedule with you next", on the hero and on the journey.
 * F17: her Plan tab listed "Planning form" and "Event-day schedule".
 *
 * A photographer's portal reads exactly as it did.
 */

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const published = { status: "published", version: 1, approvalState: "none" };

const portal = (trade: string, extra: Record<string, unknown> = {}) =>
  buildClientPortalExperience({
    state: "BOOKED",
    availability: { questionnaire: true, schedule: true },
    checkpoints: [],
    questionnaireStatus: "submitted",
    planningForm: null,
    planningFormIn: true,
    currentSchedule: published,
    trade,
    ...extra,
  });

const planning = (experience: ReturnType<typeof portal>) =>
  experience.milestones.find((milestone) => milestone.id === "planning");

test("F16: a vendor's published plan is their next step, by its own name", () => {
  const hair = portal("hair");
  assert.deepEqual(hair.nextClientAction, {
    name: "Your getting-ready schedule is ready",
    description: "See the plan for your morning. There is nothing for you to approve.",
    dueDate: null,
    ownerType: "client",
    responsibility: "client",
    href: "/client/schedule",
    actionLabel: "Open your getting-ready schedule",
  });
  assert.equal(portal("makeup").nextClientAction.name, "Your getting-ready schedule is ready");
  const dj = portal("dj").nextClientAction;
  assert.equal(dj.name, "Your run of show & MC script is ready");
  assert.equal(dj.description, "See the plan for your night. There is nothing for you to approve.");
  assert.equal(dj.actionLabel, "Open your run of show & MC script");
  assert.equal(dj.href, "/client/schedule");

  // The questionnaireDone branch (PLANNING), and booked with no form at all.
  assert.equal(portal("hair", { state: "PLANNING", planningFormIn: false }).nextClientAction.name, "Your getting-ready schedule is ready");
  assert.equal(
    portal("hair", { planningFormIn: false, questionnaireStatus: null, availability: { schedule: true } }).nextClientAction.name,
    "Your getting-ready schedule is ready",
  );
  // A vendor plan published before plans stopped asking still says
  // "client_pending": read, never approved.
  const legacy = portal("hair", { currentSchedule: { status: "published", version: 2, approvalState: "client_pending" } });
  assert.equal(legacy.nextClientAction.name, "Your getting-ready schedule is ready");
});

test("F16: the journey says the plan is ready once it is published", () => {
  assert.equal(planning(portal("hair"))?.description, "Thank you — your party list is in. Your getting-ready schedule is ready to read.");
  assert.equal(
    planning(portal("dj"))?.description,
    "Thank you — your music & moments planner is in. Your run of show & MC script is ready to read.",
  );
  assert.equal(planning(portal("hair", { planningFormIn: false }))?.description, "Your getting-ready schedule is ready to read.");
  // The milestone's place on the journey is the job's state, as before.
  assert.equal(planning(portal("hair"))?.status, "current");
  assert.equal(planning(portal("hair"))?.label, "Party list");
});

test("F16: until a version the client can open is published, the studio still has it", () => {
  for (const currentSchedule of [
    null,
    { status: "draft", version: 2, approvalState: "" },
    { status: "internal_review", version: 2, approvalState: "" },
    { status: "superseded", version: 1, approvalState: "none" },
  ]) {
    const hair = portal("hair", { currentSchedule });
    const label = String(currentSchedule?.status);
    assert.equal(hair.nextClientAction.name, "Your details are with the studio", label);
    assert.equal(
      hair.nextClientAction.description,
      "Thank you — your party list is in. Your studio will share the getting-ready schedule with you next.",
      label,
    );
    assert.equal(planning(hair)?.description, "Thank you — your party list is in. Your morning's schedule is built from it.", label);
    assert.equal(planSharedToRead("hair", currentSchedule), false, label);
  }
  assert.equal(planSharedToRead("hair", published), true);
  assert.equal(planSharedToRead("dj", { status: "approved" }), true);
  assert.equal(planSharedToRead("photographer", published), false);
  assert.equal(tradeProfile("photographer").journey.scheduleApproval, true);

  // The route hands over the newest version the client can see, never a draft.
  const route = read("app/api/client/portal/route.ts");
  assert.match(
    route,
    /const scheduleClientVisible = \(status: unknown\) =>\s*\["client_review", "approved", "published", "changes_requested"\]\.includes\(String\(status\)\);/,
  );
  assert.match(
    route,
    /const currentScheduleDoc = availabilitySnapshots\[scheduleIndex\]\.docs\s*\.filter\(\(document\) => scheduleClientVisible\(document\.get\("status"\)\)\)\s*\.sort\(/,
  );
  assert.match(route, /currentSchedule,\s*questionnaireStatus,/);
});

test("F16: what is still theirs to do comes before a plan to read", () => {
  // An open party list.
  const open = portal("hair", { planningForm: { dueDate: "2027-04-22" }, planningFormIn: false, questionnaireStatus: "not_started" });
  assert.equal(open.nextClientAction.name, "Fill in your party list");
  // A balance they can pay, and one past its date.
  const balance = { amountLabel: "$262.50", dueDate: "2027-04-24", dueDateLabel: "April 24, 2027", overdue: false };
  assert.equal(portal("hair", { outstandingBalance: balance }).nextClientAction.name, "Pay your balance");
  assert.equal(
    portal("hair", { outstandingBalance: { ...balance, overdue: true } }).nextClientAction.name,
    "Settle your outstanding balance",
  );
  // Past the day, there is no plan to go and read.
  const after = portal("hair", { state: "PLANNING", eventDate: "2026-10-01", today: "2026-10-12" });
  assert.equal(after.nextClientAction.name, "Your day has been and gone");
});

test("F16: a photographer's portal is exactly as it was", () => {
  for (const state of ["BOOKED", "PLANNING"]) {
    for (const extra of [{}, { planningFormIn: false }, { planningFormIn: false, questionnaireStatus: null }]) {
      const withPlan = portal("photographer", { state, ...extra });
      const without = portal("photographer", { state, ...extra, currentSchedule: null });
      assert.deepEqual(withPlan, without, state);
      assert.equal(
        planning(withPlan)?.description,
        "Complete details and approve the event plan.",
        state,
      );
    }
  }
  const thanked = portal("photographer", { state: "PLANNING" }).nextClientAction;
  assert.equal(thanked.name, "Your details are with the studio");
  assert.equal(
    thanked.description,
    "Thank you — your planning form is in. Your studio will share the event-day schedule for you to approve next.",
  );
  // Theirs to approve: the approval step, as before.
  const approve = portal("photographer", { currentSchedule: { status: "published", version: 3, approvalState: "client_pending" } });
  assert.equal(approve.nextClientAction.name, "Approve your event-day schedule");
  assert.equal(
    approve.nextClientAction.description,
    "Version 3 of your timeline is ready for you to check. Approve it, or tell your studio what to change.",
  );
  assert.equal(approve.nextClientAction.actionLabel, "Review the schedule");
});

test("F17: the Plan tab names the form and the plan in the trade's words", () => {
  const nav: ClientNavigation = {
    proposal: true,
    package: true,
    contract: true,
    payments: true,
    questionnaire: true,
    schedule: true,
    files: false,
    delivery: false,
    reviews: false,
  };
  const labels = (trade: string) =>
    Object.fromEntries(
      clientAreaItems(nav, tradeVocab(trade).proposal, tradeProfile(trade).delivery, tradeVocab(trade)).map((item) => [
        item.href,
        item.label,
      ]),
    );
  for (const trade of ["hair", "makeup"]) {
    assert.equal(labels(trade)["/client/questionnaire"], "Party list", trade);
    assert.equal(labels(trade)["/client/schedule"], "Getting-ready schedule", trade);
  }
  assert.equal(labels("dj")["/client/questionnaire"], "Music & moments planner");
  assert.equal(labels("dj")["/client/schedule"], "Run of show & MC script");
  // A photographer's, with or without the trade's words, as it always was.
  assert.deepEqual(
    clientAreaItems(nav, "Proposal", true, tradeVocab("photographer")),
    clientAreaItems(nav),
  );
  assert.equal(labels("photographer")["/client/questionnaire"], "Planning form");
  assert.equal(labels("photographer")["/client/schedule"], "Event-day schedule");

  // The Plan tab hands the trade's words over.
  assert.match(
    read("components/client/kit/client-plan.tsx"),
    /clientAreaItems\(\s*project\?\.navigation,\s*tradeVocab\(workspace\.tenantTrade\)\.proposal,\s*tradeProfile\(workspace\.tenantTrade\)\.delivery,\s*\/\/[^\n]*\n\s*tradeVocab\(workspace\.tenantTrade\),\s*\)/,
  );
  // Both pages carry the same words: the plan's title, and the form's.
  const schedule = read("components/client/kit/client-schedule.tsx");
  assert.match(schedule, /const title = readOnlyTrade && tradeWords\.planOfDay \? tradeWords\.planOfDay : "Your timeline";/);
  const form = read("components/client/kit/client-questionnaire.tsx");
  assert.match(form, /const formWord = tradeVocab\(workspace\.tenantTrade\)\.detailsForm\?\.toLowerCase\(\) \?\? null;/);
  assert.match(form, /\{formWord \? `Your \$\{formWord\}` : "Your questionnaire"\}/);
  assert.match(form, /tradeVocab\(workspace\.tenantTrade\)\.detailsForm \?\? "Planning questionnaire"/);
});
