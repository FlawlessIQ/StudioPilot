import assert from "node:assert/strict";
import test from "node:test";
import {
  setupComplete,
  setupGaps,
  type SetupSignals,
  type SetupState,
} from "@/features/today/setup-gaps";
import { todayInbox } from "@/features/today/inbox";

const nothingConfigured: SetupState = {
  hasActivePackage: false,
  hasAgreementTemplate: false,
  hasQuestionnaireTemplate: false,
  hasConsultationAvailability: false,
};

const quiet: SetupSignals = {
  projectsNeedingPackage: [],
  projectsNeedingAgreement: [],
  projectsNeedingForm: [],
  openInquiries: 0,
};

test("a brand-new studio has gaps, but none of them are blocking", () => {
  const gaps = setupGaps(nothingConfigured, quiet);
  assert.equal(gaps.length, 4);
  assert.ok(gaps.every((gap) => !gap.blocking));
  // It is invited to import, not scolded.
  assert.match(
    gaps[0]?.detail ?? "",
    /Paste your price list and StudioCue drafts them/,
  );
});

test("a gap becomes blocking the moment a real job waits on it", () => {
  const gaps = setupGaps(nothingConfigured, {
    ...quiet,
    projectsNeedingPackage: ["Chen Wedding"],
  });
  const packages = gaps.find((gap) => gap.key === "packages");
  assert.equal(packages?.blocking, true);
  assert.equal(packages?.blockedProjectName, "Chen Wedding");
  assert.match(packages?.detail ?? "", /Chen Wedding can't get a proposal/);
  // Only that one is blocking; the others stay quiet.
  assert.equal(gaps.filter((gap) => gap.blocking).length, 1);
});

test("configured pieces produce no gap at all", () => {
  const gaps = setupGaps(
    {
      hasActivePackage: true,
      hasAgreementTemplate: true,
      hasQuestionnaireTemplate: false,
      hasConsultationAvailability: true,
    },
    quiet,
  );
  assert.deepEqual(
    gaps.map((gap) => gap.key),
    ["questionnaire"],
  );
});

test("setup is complete only when every piece exists", () => {
  assert.equal(setupComplete(nothingConfigured), false);
  assert.equal(
    setupComplete({
      hasActivePackage: true,
      hasAgreementTemplate: true,
      hasQuestionnaireTemplate: true,
      hasConsultationAvailability: true,
    }),
    true,
  );
});

test("only blocking gaps reach Today, and they rank with exceptions", () => {
  const gaps = setupGaps(nothingConfigured, {
    ...quiet,
    projectsNeedingPackage: ["Chen Wedding"],
  });
  const inbox = todayInbox({
    now: "2026-08-20T12:00:00.000Z",
    setupGaps: gaps,
    journeys: [
      {
        projectId: "p1",
        projectName: "Chen Wedding",
        eventDate: "2027-10-09",
        state: "PROPOSAL",
        stepTitle: "Proposal",
        stepDetail: "Ready to send",
        owner: "studio",
        actionLabel: "Prepare proposal",
        actionHref: "/studio/proposals/new?project=p1",
        updatedAt: null,
      },
    ],
  });
  // Three non-blocking gaps stayed out of the queue entirely.
  const setupItems = inbox.act.filter((item) => item.id.startsWith("setup-"));
  assert.deepEqual(
    setupItems.map((item) => item.id),
    ["setup-packages"],
  );
  // Work has stopped, so it leads the lane.
  assert.equal(inbox.act[0]?.id, "setup-packages");
});

test("how inquiries reach StudioCue is the first setup question, and never blocks", () => {
  // It sat under setup as an uncounted "forward by hand" strip, so a studio
  // could be "set up" with nothing coming in (onboarding assessment 2026-09-26).
  const gaps = setupGaps({ ...nothingConfigured, hasInquiryCapture: false }, { ...quiet, openInquiries: 3 });
  assert.equal(gaps.length, 5);
  assert.equal(gaps[0]?.key, "inquiries");
  assert.equal(gaps[0]?.blocking, false, "no job waits on it; it belongs in setup, not Today's act lane");
  assert.equal(gaps[0]?.href, "/studio/settings/inquiry-capture");
});

test("setup isn't finished until inquiries reach StudioCue", () => {
  const everythingElse: SetupState = {
    hasActivePackage: true,
    hasAgreementTemplate: true,
    hasQuestionnaireTemplate: true,
    hasConsultationAvailability: true,
  };
  assert.equal(setupComplete({ ...everythingElse, hasInquiryCapture: false }), false);
  assert.equal(setupComplete({ ...everythingElse, hasInquiryCapture: true }), true);
  // A caller that doesn't read capture keeps the answer it had.
  assert.equal(setupComplete(everythingElse), true);
  assert.equal(setupGaps(everythingElse, quiet).length, 0);
});

import { readFileSync } from "node:fs";
import { SETUP_ORDER, nextSetupStep } from "@/features/today/setup-gaps";

const source = (path: string) => readFileSync(`${process.cwd()}/${path}`, "utf8");

test("setup asks in one order, and Today's 'Next' follows it", () => {
  assert.deepEqual(SETUP_ORDER, ["inquiries", "availability", "packages", "agreement", "questionnaire"]);
  const gaps = setupGaps({ ...nothingConfigured, hasInquiryCapture: true }, quiet);
  // Inquiries answered: next is hours, not whatever the engine listed first.
  assert.equal(nextSetupStep(gaps), "availability");
  assert.equal(nextSetupStep([]), null);
  const conversation = source("components/setup/setup-conversation.tsx");
  assert.match(conversation, /SETUP_ORDER\.map/);
  assert.match(source("components/today/use-today-inbox.ts"), /next: nextSetupStep\(setup\.gaps\)/);
});

test("setup v2 answers what it can in place, and sends the rest to the right door", () => {
  const conversation = source("components/setup/setup-conversation.tsx");
  // Hours in one tap, the same Mon–Fri 9–5 the settings page pre-fills.
  assert.match(conversation, /type: "setConsultationSettings"/);
  assert.match(conversation, /Use Mon–Fri, 9–5/);
  // Google Calendar beside the hours, coming back to setup.
  assert.match(conversation, /startProviderConnect\("google_calendar", workspace\.tenantId, "\/studio\/setup"\)/);
  // Prices and forms open the import already set to that kind.
  assert.match(conversation, /\/studio\/import\?kind=Package/);
  assert.match(conversation, /\/studio\/import\?kind=Questionnaire/);
  // Help's checklist is setup's, not a third list.
  const checklist = source("components/dashboard/setup-checklist.tsx");
  assert.match(checklist, /useSetupState\(\)/);
  assert.match(checklist, /SETUP_ORDER\.map/);
});

test("connecting a calendar can return to setup, and only ever to a studio page", () => {
  const oauth = source("functions/src/integrations/oauth.ts");
  // Accepted on the way in only as a /studio/ path…
  assert.match(oauth, /returnTo: z\s*\.string\(\)\s*\.max\(200\)\s*\.regex\(\/\^\\\/studio\\\//);
  // …and checked again where the redirect happens, falling back to Integrations.
  assert.match(oauth, /: "\/studio\/integrations";/);
  const rule = /^\/studio\/[A-Za-z0-9/_-]*$/;
  assert.ok(rule.test("/studio/setup"));
  for (const hostile of ["https://evil.example", "//evil.example", "/studio/../../x?y", "/studio/setup?next=//evil"])
    assert.equal(rule.test(hostile), false, hostile);
});

test("setup polish: the places that said the wrong thing now say the right one", () => {
  // A brand-new studio isn't told "Nothing is waiting on you" under "Let's get you set up".
  assert.match(source("components/today/today-inbox.tsx"), /waiting === 0 && !\(setup\.brandNew && !setup\.complete\)/);
  // "Finish setting up" on a finished studio reads as a wrong nag.
  assert.match(source("components/settings/settings-shell.tsx"), /title: "Review setup"/);
  // Studio details has no logo; Email branding does.
  const sections = source("features/settings/sections.ts");
  assert.match(sections, /"Names, timezone, and your inquiry link"/);
  assert.match(sections, /"Logo, colours and sender name on client emails"/);
  // Who email comes from, and where replies go, said as they are.
  const branding = source("components/settings/email-branding.tsx");
  assert.match(branding, /NEXT_PUBLIC_EMAIL_FROM_ADDRESS/);
  assert.match(branding, /replies come back into Messages/);
  assert.doesNotMatch(branding, /Replies go to \{branding\.replyTo/);
  assert.match(source("apphosting.yaml"), /NEXT_PUBLIC_EMAIL_FROM_ADDRESS\s+value: studio@studio-cue\.com/);
  // A contract import is offered, and explained, only for what it will do.
  assert.match(source("components/ai/template-import-studio.tsx"), /kinds\.filter\(\(kind\) => kind !== "Contract"\)/);
  assert.match(source("components/ai/studio-import-review-workspace.tsx"), /it won&apos;t be used on bookings/);
  // Imported forms are for the job type they name.
  assert.match(source("functions/src/studio-import/review.ts"), /eventTypeId: questionnaireEventType\(/);
});
