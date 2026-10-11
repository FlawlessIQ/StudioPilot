import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { checkNote, uncertainItem } from "@/features/ai/check-note";
import { FILE_BEARING } from "@/features/documents/file-ref";
import { projectThread } from "@/features/journey/thread";
import { couplePackageView, snapshotInclusions } from "@/features/packages/job-packages";
import { oneOffCoverageMinutes } from "@/features/packages/one-off";
import { hoursText } from "@/features/packages/unit-label";
import { formatCentsAsNeeded } from "@/lib/format/money";
import { buildClientPortalExperience } from "@/server/client/portal-experience";
import { hoursText as functionsHoursText } from "../functions/src/packages/unit-label";

/**
 * The small wording misses from the production walk of a hair studio (Priya
 * Shah, Jess Styles Bridal, May 22 2027; walked 2026-10-10): plurals, a
 * rounded deposit, the client's next step, the quote's file chip, a page
 * title and a title-cased AI note. The deposit words themselves are pinned in
 * tests/vendor-deposit-words.test.ts. A photographer's read as before.
 */

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("the booking-link note says the client then pays, not straight after", () => {
  const page = read("components/proposals/studio-proposal-workspace.tsx");
  assert.match(page, /`Signing it accepts this \$\{offer\}, and the client then pays the deposit\. To change/);
  assert.doesNotMatch(page, /pays the deposit straight after/);
});

test("hours are singular at one, everywhere a package's hours are summed up", () => {
  assert.equal(hoursText(1), "1 hour");
  assert.equal(hoursText(8), "8 hours");
  assert.equal(hoursText(7.5), "7.5 hours");
  assert.equal(hoursText(1, true), "1 hr");
  assert.equal(hoursText(8, true), "8 hrs");
  assert.equal(hoursText(500 / 60, true), "8.3 hrs");
  for (const value of [1, 2, 7.5]) assert.equal(functionsHoursText(value), hoursText(value));
  // The client's package bullets: "1 hour of coverage", a photographer's as before.
  assert.equal(snapshotInclusions({ includedCoverageMinutes: 60 })[0], "1 hour of coverage");
  assert.equal(snapshotInclusions({ includedCoverageMinutes: 480 })[0], "8 hours of coverage");
  assert.equal(snapshotInclusions({ includedCoverageMinutes: 480 }, "photographer")[0], "8 hours of coverage");
  // A vendor's client reads the trade's word, never "coverage" (trades.ts).
  assert.equal(snapshotInclusions({ includedCoverageMinutes: 60 }, "hair")[0], "1 hour of service");
  assert.equal(snapshotInclusions({ includedCoverageMinutes: 300 }, "dj")[0], "5 hours of service");
  assert.equal(
    couplePackageView({ snapshots: [{ id: "s1", packageName: "Bridal", includedCoverageMinutes: 60 }], proposals: [], trade: "hair" })
      ?.packages[0]?.items[0],
    "1 hour of service",
  );
  assert.equal(
    couplePackageView({ snapshots: [{ id: "s1", packageName: "Gold", includedCoverageMinutes: 480 }], proposals: [] })
      ?.packages[0]?.items[0],
    "8 hours of coverage",
  );
  const kit = read("components/client/kit/client-package.tsx");
  assert.match(kit, /snapshotInclusions\(item, workspace\.tenantTrade\)/);
  assert.match(kit, /proposals: locked \? \[\] : proposals\.value,\s*trade: workspace\.tenantTrade,/);
  // The quote composer, the package list, the booking picker and the one-off form.
  const composer = read("components/proposals/studio-proposal-workspace.tsx");
  assert.match(composer, /\{hoursText\(\s*Math\.round\(number\(studioPackage\.includedCoverageMinutes\) \/ 60\),\s*\)\}/);
  assert.doesNotMatch(composer, /\}\{" "\}\s*hours ·/);
  const list = read("components/studio/live-domain-view.tsx");
  assert.match(list, /hoursText\(minutes \/ 60, true\)/);
  assert.doesNotMatch(list, / hrs`/);
  // The booking picker also skips the hours for a package that states none
  // (an imported vendor list), so it never reads "0 hours".
  assert.match(
    read("components/booking/booking-autopilot-workspace.tsx"),
    /Number\(studioPackage\.includedCoverageMinutes \?\? 0\) > 0 \? `\$\{hoursText\(Math\.round\(Number\(studioPackage\.includedCoverageMinutes\) \/ 60\)\)\} · ` : ""/,
  );
  const oneOffForm = read("components/proposals/one-off-package-form.tsx");
  assert.match(oneOffForm, /for \$\{hoursText\(hours\)\}\./);
  // Its blank hours are what the server saves (oneOffCoverageMinutes): a main
  // package stating none gives none, so the hint never promises eight hours
  // the one-off is saved without.
  assert.match(oneOffForm, /const hours = Math\.round\(\(oneOffCoverageMinutes\(undefined, mainCoverageMinutes\) \/ 60\) \* 10\) \/ 10;/);
  assert.match(oneOffForm, /`Left blank: one \$\{coverageRoleLabel\(firstRole, 1\)\}, no set hours\.`/);
  assert.doesNotMatch(oneOffForm, /: 8;/);
  assert.equal(Math.round((oneOffCoverageMinutes(undefined, 0) / 60) * 10) / 10, 0);
  assert.equal(Math.round((oneOffCoverageMinutes(undefined, undefined) / 60) * 10) / 10, 8);
  assert.equal(Math.round((oneOffCoverageMinutes(undefined, 450) / 60) * 10) / 10, 7.5);
  for (const caller of [
    "components/proposals/proposal-packages-panel.tsx",
    "components/proposals/studio-proposal-workspace.tsx",
    "components/booking/booking-amendment.tsx",
  ]) {
    assert.match(read(caller), /mainCoverageMinutes=\{[^}]*includedCoverageMinutes\}/, caller);
    assert.doesNotMatch(read(caller), /defaultHours=/, caller);
  }
});

test("the package form previews the deposit to the cent, as the quote asks for it", () => {
  assert.equal(formatCentsAsNeeded(11250), "$112.50");
  assert.equal(formatCentsAsNeeded(30000), "$300");
  assert.equal(formatCentsAsNeeded(0), "$0");
  const form = read("components/crm/edit-package-form.tsx");
  assert.match(form, /Clients are asked for \{formatCentsAsNeeded\(retainerPreview\)\}\./);
  assert.doesNotMatch(form, /formatCents\(/);
});

test("a vendor's client is asked for the open planning form by name and date", () => {
  const ask = (trade: string, extra: Record<string, unknown> = {}) =>
    buildClientPortalExperience({
      state: "BOOKED",
      availability: { questionnaire: true },
      checkpoints: [],
      questionnaireStatus: "not_started",
      planningForm: { dueDate: "2027-04-22" },
      trade,
      ...extra,
    }).nextClientAction;
  const hair = ask("hair");
  assert.equal(hair.name, "Fill in your party list");
  assert.equal(hair.description, "Your studio plans the morning from it.");
  assert.equal(hair.dueDate, "2027-04-22");
  assert.equal(hair.href, "/client/questionnaire");
  assert.equal(hair.actionLabel, "Open your party list");
  assert.equal(ask("hair", { state: "PLANNING" }).name, "Fill in your party list");
  assert.equal(ask("dj").name, "Fill in your music & moments planner");
  assert.equal(ask("dj").description, "Your studio plans the night from it.");
  // No open form known: the general step, as before.
  assert.equal(ask("hair", { planningForm: null }).name, "Continue planning your event");
  // Sent back: thanked, never asked again — and a vendor's client is never
  // told a schedule is coming for them to approve.
  const thanked = ask("hair", { questionnaireStatus: "submitted", planningForm: null, state: "PLANNING" });
  assert.equal(thanked.name, "Your details are with the studio");
  assert.equal(thanked.description, "Thank you — your party list is in. Your studio will share the getting-ready schedule with you next.");
  assert.equal(
    ask("dj", { questionnaireStatus: "submitted", planningForm: null, state: "PLANNING" }).description,
    "Thank you — your music & moments planner is in. Your studio will share the run of show & MC script with you next.",
  );
  // The status is read from whichever form the route met first: a sent-back
  // inquiry-page form must not hide the party list still open.
  for (const state of ["BOOKED", "PLANNING"]) {
    const open = ask("hair", { questionnaireStatus: "submitted", state });
    assert.equal(open.name, "Fill in your party list", state);
    assert.equal(open.dueDate, "2027-04-22", state);
  }
  // A photographer's step is exactly as it was.
  const photo = ask("photographer");
  assert.equal(photo.name, "Continue planning your event");
  assert.equal(photo.description, "Review the planning information and complete anything your studio has shared.");
  assert.equal(photo.dueDate, null);
  assert.equal(photo.actionLabel, "Continue planning");
  const photoThanked = ask("photographer", { questionnaireStatus: "submitted", planningForm: null, state: "PLANNING" });
  assert.equal(photoThanked.name, "Your details are with the studio");
  assert.equal(
    photoThanked.description,
    "Thank you — your planning form is in. Your studio will share the event-day schedule for you to approve next.",
  );
  // A photographer's step reads the status alone, as before: an open form
  // beside a sent-back one (the Final schedule assigned at booking) changes
  // nothing — never "Continue planning your event" in place of what they had.
  for (const state of ["BOOKED", "PLANNING"]) {
    const photoOpen = ask("photographer", { questionnaireStatus: "submitted", state });
    assert.deepEqual(photoOpen, ask("photographer", { questionnaireStatus: "submitted", state, planningForm: null }), state);
    assert.notEqual(photoOpen.name, "Continue planning your event", state);
  }
  assert.equal(
    ask("photographer", { questionnaireStatus: "submitted", state: "PLANNING" }).name,
    "Your details are with the studio",
  );
  // The portal route hands it the open form: not the inquiry page's, not one sent back.
  const route = read("app/api/client/portal/route.ts");
  assert.match(route, /document\.get\("source"\) !== "inquiry_page" &&\s*!document\.get\("archivedAt"\) &&\s*!\["withdrawn", "submitted", "locked"\]\.includes/);
  assert.match(route, /inquiryForm,\s*planningForm,\s*planningFormIn,\s*trade: tenantSnapshot\.get\("trade"\)/);
});

test("a vendor's client who has sent the form back is thanked, on the hero and the journey", () => {
  // Priya Shah sent her party list; her portal, still booked, said "Your
  // studio is preparing the planning details you will need next" above
  // "Party list (now) — Tell us who's getting ready" (prod, 2026-10-11).
  const portal = (trade: string, extra: Record<string, unknown> = {}) =>
    buildClientPortalExperience({
      state: "BOOKED",
      availability: { questionnaire: true },
      checkpoints: [],
      questionnaireStatus: "submitted",
      planningForm: null,
      planningFormIn: true,
      trade,
      ...extra,
    });
  const hair = portal("hair");
  assert.equal(hair.nextClientAction.name, "Your details are with the studio");
  assert.equal(
    hair.nextClientAction.description,
    "Thank you — your party list is in. Your studio will share the getting-ready schedule with you next.",
  );
  assert.equal(hair.nextClientAction.href, "/client/project");
  const planning = (trade: string, extra: Record<string, unknown> = {}) =>
    portal(trade, extra).milestones.find((milestone) => milestone.id === "planning");
  assert.equal(planning("hair")?.description, "Thank you — your party list is in. Your morning's schedule is built from it.");
  assert.equal(planning("dj")?.description, "Thank you — your music & moments planner is in. The night's plan is built from it.");
  assert.equal(
    portal("dj").nextClientAction.description,
    "Thank you — your music & moments planner is in. Your studio will share the run of show & MC script with you next.",
  );
  // Only a planning form counts: an inquiry-page form sent back says nothing of a party list.
  assert.equal(portal("hair", { planningFormIn: false }).nextClientAction.name, "Your date is booked");
  assert.equal(planning("hair", { planningFormIn: false })?.description, "Tell us who's getting ready, and when. Your morning's schedule is built from it.");
  // A photographer's portal is exactly as it was.
  for (const state of ["BOOKED", "PLANNING"]) {
    const photo = portal("photographer", { state });
    const before = portal("photographer", { state, planningFormIn: false });
    assert.deepEqual(photo.nextClientAction, before.nextClientAction, state);
    assert.deepEqual(photo.milestones, before.milestones, state);
  }
  const route = read("app/api/client/portal/route.ts");
  assert.match(route, /const planningFormIn =\s*!planningFormDoc &&/);
});

test("the quote's file chip on the job is called a quote", () => {
  const record = { pdfDocumentId: "generated_q1", version: 2 };
  assert.equal(FILE_BEARING.proposals(record)[0]?.label, "Proposal (version 2)");
  assert.equal(FILE_BEARING.proposals(record, "Quote")[0]?.label, "Quote (version 2)");
  assert.equal(FILE_BEARING.proposals({ pdfDocumentId: "generated_q1", version: 1 }, "Quote")[0]?.label, "Quote");
  assert.match(
    read("components/projects/use-project-journey.ts"),
    /files: FILE_BEARING\.proposals\(proposal, tradeVocab\(tenantTrade\)\.proposal\)/,
  );
  assert.equal((read("features/journey/thread.ts").match(/FILE_BEARING\.proposals\(proposal, offer\)/g) ?? []).length, 3);
  assert.match(
    read("components/studio/live-domain-view.tsx"),
    /files: \(record, trade\) => FILE_BEARING\.proposals\(record, tradeVocab\(trade\)\.proposal\)/,
  );
});

test("the job thread's deposit invoice is called what the trade calls it", () => {
  const titles = (trade?: string) =>
    projectThread({
      projectId: "job1",
      projectName: "Priya Shah",
      projectCreatedAt: "2026-10-01T10:00:00.000Z",
      clientName: "Priya Shah",
      invoices: [
        { id: "i1", kind: "retainer", status: "paid", amountCents: 11250, createdAt: "2026-10-10T10:00:00.000Z", paidAt: "2026-10-10T11:00:00.000Z" },
        { id: "i2", kind: "final", status: "sent", amountCents: 26250, createdAt: "2026-10-10T12:00:00.000Z" },
      ],
      trade,
    }).map((entry) => entry.title);
  for (const trade of ["dj", "makeup", "hair"]) {
    const vendor = titles(trade);
    assert.ok(vendor.includes("Deposit invoice"), trade);
    assert.ok(vendor.includes("Deposit paid"), trade);
    assert.ok(vendor.includes("Final balance invoice"), trade);
    assert.ok(!vendor.some((title) => /retainer/i.test(title)), trade);
  }
  for (const photo of [titles(), titles("photographer")]) {
    assert.ok(photo.includes("Retainer invoice"));
    assert.ok(photo.includes("Retainer paid"));
    assert.ok(photo.includes("Final balance invoice"));
  }
});

test("the new schedule page's tab says what its heading says", () => {
  const page = read("app/studio/schedules/new/page.tsx");
  assert.match(page, /export const metadata: Metadata = \{ title: "Plan the day" \};/);
  assert.match(page, /<h1>Plan the day<\/h1>/);
});

test("a draft's check note is in sentence case, in the AI's own words", () => {
  assert.equal(
    checkNote(["exact styling services for each person, timing details for the hair trial"]),
    "Check: Exact styling services for each person, timing details for the hair trial",
  );
  // Names and initialisms keep their case; a field name reads as words.
  assert.equal(uncertainItem("Priya's veil and the DJ's load-in."), "Priya's veil and the DJ's load-in");
  assert.equal(uncertainItem("event_date"), "Event date");
  assert.equal(uncertainItem("venueName"), "Venue name");
  assert.equal(uncertainItem("EVENT_DATE"), "Event date");
  // A one-word name with a capital inside is a name, not a field name.
  for (const name of ["McKenzie", "LaRosa", "DeLuca"]) assert.equal(uncertainItem(name), name);
  assert.equal(checkNote(["McKenzie"]), "Check: McKenzie");
  assert.equal(uncertainItem("  "), "");
  assert.equal(checkNote([]), null);
  assert.equal(checkNote(["", 7]), null);
  assert.equal(checkNote(["a", "b", "c", "d", "e"]), "Check: A; B; C +2");
  const card = read("components/ai/ai-approval-queue.tsx");
  assert.match(card, /const checkText = checkNote\(list\(confidence\.uncertainFields\)\);/);
  assert.doesNotMatch(card, /readable\(text\(entry\)\)/);
});
