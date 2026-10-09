import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { sampleContractSources } from "../features/contracts/sample";
import { journeyProfile } from "../features/job-kinds/job-kinds";
import { projectJourney, type JourneyInput } from "../features/journey/steps";
import { renderLifecycleDraft } from "../features/messaging/render";
import { renderLifecycleDraft as renderServerLifecycleDraft } from "../functions/src/communications/lifecycle-core";

/**
 * The four gaps fixed before the end-to-end UAT (2026-10-09): a family
 * session told to hang up the dress, a DJ's agreement previewed with a
 * photographer's package, a beauty studio's package form asking for
 * "Deliverables", and DJ, makeup and hair crew printing grey on the PDF.
 */

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const facts = {
  studioName: "FlawlessIQ",
  clientFirstName: "Linh",
  projectName: "The Nguyen family session",
  eventDate: "2026-10-25",
  venueName: "Riverside Park",
  packageTotalCents: null,
  retainerPaidCents: null,
  balanceDueCents: null,
  scheduleUrl: null,
  recipientEmail: null,
  recipientName: null,
};

test("a family session's day-before checklist is about outfits, not the dress — from both drafters", () => {
  for (const render of [renderLifecycleDraft, renderServerLifecycleDraft]) {
    const family = render("day_before_checklist", { ...facts, eventKind: "portraits" });
    assert.match(family.body, /Outfits laid out/);
    assert.doesNotMatch(family.body, /dress|rings|wedding/i);
    const team = render("day_before_checklist", { ...facts, eventKind: "sports" });
    assert.match(team.body, /Uniforms and kit ready/);
    // A wedding, and a job from before kinds, keep the wedding's list.
    for (const eventKind of ["wedding", undefined]) {
      assert.match(render("day_before_checklist", { ...facts, eventKind }).body, /Dress on its special hanger/, String(eventKind));
    }
  }
});

test("the journey's day-before step follows the job's kind", () => {
  const input: JourneyInput = {
    projectId: "p1",
    state: "READY",
    eventDate: "2026-10-25",
    today: "2026-10-24",
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
    crewAccepted: 0,
    crewRequired: 0,
    crewCascadeActive: false,
    coiStatus: null,
    insuranceRequired: "not_required",
    dayBeforeDraftStatus: null,
    hasDelivery: false,
    albumOrReviewDone: false,
  };
  const detail = (profile?: JourneyInput["profile"]) =>
    projectJourney({ ...input, profile }).steps.find((step) => step.key === "day_before")?.detail;
  assert.equal(detail(journeyProfile("portraits")), "Outfits laid out, colors that sit well together");
  assert.equal(detail(journeyProfile("sports")), "Uniforms and kit ready");
  assert.equal(detail(journeyProfile("wedding")), "Dress, shoes, flowers, rings, invitations ready");
  assert.equal(detail(undefined), "Dress, shoes, flowers, rings, invitations ready");
});

test("a DJ's agreement previews with a DJ's package, load-in and power", () => {
  const dj = sampleContractSources("Spin Theory DJs", "2026-10-09", "dj");
  assert.equal(dj.package.coverage, "1 DJ, 6 hours");
  assert.ok(dj.package.deliverables.includes("MC"));
  assert.ok(dj.eventDetails?.rows.some((row) => row.label === "Load-in and power"));
  assert.doesNotMatch(JSON.stringify(dj), /photograph|gallery|album/i);
  // A photographer's preview is the one it always was.
  assert.equal(sampleContractSources("Studio", "2026-10-09").package.coverage, "2 photographers, 8 hours");
  assert.equal(sampleContractSources("Studio", "2026-10-09", "photographer").package.coverage, "2 photographers, 8 hours");
});

test("the package form speaks each trade's words and starts from its own defaults", () => {
  const form = read("components/crm/create-package-form.tsx");
  assert.match(form, /\{photoStudio \? "Coverage hours" : djStudio \? "Hours of music" : "Hours on site"\}/);
  assert.match(form, /\{photoStudio \? "Deliverables \(comma separated\)" : "What's included \(comma separated\)"\}/);
  assert.match(form, /makeup: \{ hours: 2, included: "Bridal makeup, Lashes, Touch-up kit" \}/);
  assert.match(form, /hair: \{ hours: 2, included: "Bridal hair, Veil placement" \}/);
  // A photographer's form keeps its gallery defaults.
  assert.match(form, /deliverables: roles\[0\] === "dj" \? "Reception sound, Dance floor lighting, MC" : "Online gallery, High-resolution downloads"/);
});

test("DJ, makeup and hair crew have their own chip colors on the run-of-show PDF", () => {
  const pdf = read("cloud-run/pdf/run_of_show.py");
  for (const letter of ["P", "V", "D", "M", "H"])
    for (const number of [1, 2])
      assert.match(pdf, new RegExp(`\\("${letter}", ${number}\\): \\("#[0-9A-F]{6}", "#[0-9A-F]{6}"\\)`), `${letter}${number}`);
  // The letters the PDF colors are the letters crew-labels.ts hands out.
  assert.match(read("features/schedules/crew-labels.ts"), /photographer: "P", videographer: "V", dj: "D", makeup_artist: "M", hair_stylist: "H"/);
});
