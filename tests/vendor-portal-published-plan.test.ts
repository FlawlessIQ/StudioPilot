import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { clientFormWords } from "@/features/client/form-words";
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
 * And in review: past the day, the same BOOKED job still promised the plan
 * "next"; with no party list open, PLANNING sent her to an empty form page;
 * and a form page holding two forms said "Your questionnaires".
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

test("F16: past the day a vendor's job still BOOKED promises nothing more", () => {
  // Priya Shah's job, as it stands on prod: BOOKED, party list in, plan
  // published, and nothing moves it on by itself once the day has gone.
  const past = { eventDate: "2026-10-01", today: "2026-10-12" };
  for (const trade of ["hair", "makeup", "dj"]) {
    for (const currentSchedule of [published, null]) {
      const label = `${trade} ${currentSchedule ? "published" : "no plan"}`;
      const after = portal(trade, { ...past, currentSchedule });
      assert.deepEqual(
        after.nextClientAction,
        {
          name: "Your day has been and gone",
          description: "Your studio is finishing up on their side — there is nothing you need to do.",
          dueDate: null,
          ownerType: "studio",
          responsibility: "studio",
          href: "/client/project",
          actionLabel: "View project",
        },
        label,
      );
      assert.doesNotMatch(after.nextClientAction.description, /will share/, label);
    }
  }
  // Nor asks for a form about a day that has happened, open or not.
  const open = portal("hair", {
    ...past,
    currentSchedule: null,
    planningForm: { dueDate: "2026-09-20" },
    planningFormIn: false,
    questionnaireStatus: "not_started",
  });
  assert.equal(open.nextClientAction.name, "Your day has been and gone");
  // The journey and the hero agree: the plan is there, nothing is still to come.
  const hair = portal("hair", past);
  assert.equal(planning(hair)?.description, "Thank you — your party list is in. Your getting-ready schedule is ready to read.");
  for (const said of [hair.nextClientAction.description, planning(hair)?.description ?? ""]) {
    assert.doesNotMatch(said, /will share|next\.|built from it/);
  }
  // Before the day, the same job's next step is the plan itself.
  assert.equal(portal("hair", { eventDate: "2026-10-24", today: "2026-10-12" }).nextClientAction.href, "/client/schedule");
});

test("F16: a vendor with no form open is sent to the plan, not to an empty form page", () => {
  const ready = "Your getting-ready schedule is ready";
  // PLANNING with no form at all: "Continue planning your event" sent them
  // to a page that said the party list had not been sent.
  const none = portal("hair", {
    state: "PLANNING",
    availability: { schedule: true },
    questionnaireStatus: null,
    planningFormIn: false,
  });
  assert.equal(none.nextClientAction.name, ready);
  assert.equal(none.nextClientAction.href, "/client/schedule");
  // The status the route reads first can be an unreturned inquiry-page form
  // while the party list is in.
  const inquiryFirst = { questionnaireStatus: "not_started", planningFormIn: true };
  assert.equal(portal("hair", { state: "PLANNING", ...inquiryFirst }).nextClientAction.name, ready);
  assert.equal(portal("hair", { state: "BOOKED", ...inquiryFirst }).nextClientAction.name, ready);
  assert.equal(
    portal("hair", { state: "BOOKED", availability: { questionnaire: true, schedule: true }, questionnaireStatus: null, planningFormIn: false })
      .nextClientAction.name,
    ready,
  );
  // With no plan yet, the party list in is still thanked, never asked for again.
  const waiting = portal("hair", { state: "PLANNING", ...inquiryFirst, currentSchedule: null });
  assert.equal(waiting.nextClientAction.name, "Your details are with the studio");
  assert.equal(
    waiting.nextClientAction.description,
    "Thank you — your party list is in. Your studio will share the getting-ready schedule with you next.",
  );
  assert.equal(waiting.nextClientAction.href, "/client/project");
  // An open party list is still theirs first.
  assert.equal(
    portal("hair", { state: "PLANNING", planningForm: { dueDate: "2027-04-22" }, planningFormIn: false, questionnaireStatus: "not_started" })
      .nextClientAction.name,
    "Fill in your party list",
  );
});

test("F16: a photographer's portal past the day and with no form is exactly as it was", () => {
  const past = { eventDate: "2026-10-01", today: "2026-10-12" };
  const booked = portal("photographer", past);
  assert.deepEqual(booked.nextClientAction, {
    name: "Your date is booked",
    description: "Your studio is preparing the planning details you will need next.",
    dueDate: null,
    ownerType: "studio",
    responsibility: "studio",
    href: "/client/project",
    actionLabel: "View project details",
  });
  assert.deepEqual(booked, portal("photographer", { ...past, currentSchedule: null }));
  for (const extra of [
    { questionnaireStatus: null, planningFormIn: false, availability: { schedule: true } },
    { questionnaireStatus: "not_started", planningFormIn: true },
  ]) {
    const planningState = portal("photographer", { state: "PLANNING", ...extra });
    assert.deepEqual(planningState, portal("photographer", { state: "PLANNING", ...extra, currentSchedule: null }));
    assert.deepEqual(planningState.nextClientAction, {
      name: "Continue planning your event",
      description: "Review the planning information and complete anything your studio has shared.",
      dueDate: null,
      ownerType: "client",
      responsibility: "client",
      href: "/client/questionnaire",
      actionLabel: "Continue planning",
    });
  }
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
  assert.equal(
    form.match(/const words = clientFormWords\(tradeVocab\(workspace\.tenantTrade\)\.detailsForm\);/g)?.length,
    2,
    "the page and the opened form both take the trade's words",
  );
  assert.match(form, /<h1 className="kit-title">\{words\.emptyTitle\}<\/h1>/);
  assert.match(form, /const name = text\(response\.name \?\? response\.templateName, words\.formName\);/);
});

test("F17: the form page's list, back button and errors use the trade's words", () => {
  // A photographer's, exactly as the page has always said them.
  assert.deepEqual(clientFormWords(tradeVocab("photographer").detailsForm), {
    page: "Questionnaire",
    emptyTitle: "Your questionnaire",
    loading: "Opening your questionnaire…",
    upcoming: "Your studio hasn’t sent a questionnaire yet. You’ll get an email when there’s one to fill out.",
    listPage: "Questionnaires",
    listTitle: "Your questionnaires",
    listRow: "Questionnaire",
    backToList: "All questionnaires",
    formName: "Planning questionnaire",
    couldNotOpen: "Your questionnaire couldn’t be opened. Refresh to try again.",
    formLabel: "Questionnaire",
  });
  // A hair client's: their party list by name, and "forms" for a list,
  // which can hold their inquiry page's event form too.
  assert.deepEqual(clientFormWords(tradeVocab("hair").detailsForm), {
    page: "Party list",
    emptyTitle: "Your party list",
    loading: "Opening your party list…",
    upcoming: "Your studio hasn’t sent your party list yet. You’ll get an email when it’s ready to fill out.",
    listPage: "Forms",
    listTitle: "Your forms",
    listRow: "Form",
    backToList: "All forms",
    formName: "Party list",
    couldNotOpen: "This form couldn’t be opened. Refresh to try again.",
    formLabel: null,
  });
  assert.equal(clientFormWords(tradeVocab("makeup").detailsForm).emptyTitle, "Your party list");
  const dj = clientFormWords(tradeVocab("dj").detailsForm);
  assert.equal(dj.emptyTitle, "Your music & moments planner");
  assert.equal(dj.formName, "Music & moments planner");
  for (const trade of ["hair", "makeup", "dj"]) {
    const words = clientFormWords(tradeVocab(trade).detailsForm);
    for (const said of Object.values(words)) {
      if (typeof said === "string") assert.doesNotMatch(said, /questionnaire/i, `${trade}: ${said}`);
    }
  }

  // The page says nothing of its own: every word the client reads about the
  // form comes from there.
  const form = read("components/client/kit/client-questionnaire.tsx");
  const code = form.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  for (const phrase of [
    "Your questionnaire",
    "All questionnaires",
    "Questionnaire ${",
    "Planning questionnaire",
    "questionnaire couldn",
    'label="Questionnaire',
    "context=Questionnaire",
  ]) {
    assert.equal(code.includes(phrase), false, phrase);
  }
  assert.match(code, /<h1 className="kit-title">\{words\.listTitle\}<\/h1>/);
  assert.match(code, /<List label=\{words\.listPage\}>/);
  assert.match(code, /`\$\{words\.listRow\} \$\{index \+ 1\}`/);
  assert.match(code, /\{words\.backToList\}/);
  assert.match(code, /\{openFailed \? words\.couldNotOpen : /);
  // An opened form's landmark and a message's "About:": a photographer's
  // "Questionnaire", a vendor's the form's own name.
  assert.match(code, /const landmark = words\.formLabel \?\? name;/);
  assert.match(code, /context=\$\{encodeURIComponent\(landmark\)\}/);
  assert.equal(code.match(/<Main label=\{landmark\}>/g)?.length, 4);
});
