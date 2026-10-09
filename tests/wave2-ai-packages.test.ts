import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  DEFAULT_PROPOSAL_TERMS,
  proposalTermsForPackages,
} from "@/features/booking/autopilot";
import { proposalTermsForPackages as functionsTermsForPackages } from "../functions/src/proposals/default-terms";
import { finalBalanceFacts, packageNameList } from "@/features/messaging/final-balance-facts";
import { finalBalanceFacts as functionsFinalBalanceFacts } from "../functions/src/communications/final-balance-facts";
import { renderLifecycleDraft } from "@/features/messaging/render";
import { renderLifecycleDraft as functionsRenderLifecycleDraft } from "../functions/src/communications/lifecycle-core";
import { jobValueCents } from "@/features/packages/job-packages";
import { bookedValueCents } from "@/features/today/inbox";
import { jobPackageFacts } from "../functions/src/packages/job-package-facts";

/**
 * A job can carry several packages — GR Productions sells photo and video
 * together — and the AI and the dashboards knew the first one only: the
 * final-balance email quoted the photo package, Cue answered "what's
 * included" from it, proposal terms were the photo terms, and the booked
 * value left the video out.
 */

const source = (path: string) => readFileSync(`${process.cwd()}/${path}`, "utf8");

const photo = {
  id: "s-photo",
  packageName: "Gold Photo Package",
  terms: "Photo terms: images delivered within eight weeks.",
  totalCents: 600000,
  retainerCents: 150000,
  includedCoverage: [{ role: "photographer", count: 2 }],
  includedPhotographers: 2,
  includedCoverageMinutes: 480,
  description: "Two photographers for eight hours. A 40-page album.",
};
const video = {
  id: "s-video",
  packageName: "Silver Cinematic Package",
  terms: "Video terms: the film is delivered within twelve weeks.",
  totalCents: 400000,
  retainerCents: 100000,
  includedCoverage: [{ role: "videographer", count: 1 }],
  includedPhotographers: 0,
  includedCoverageMinutes: 600,
  description: "One videographer for ten hours. A highlight film.",
};
const project = {
  id: "p1",
  state: "BOOKED",
  packageSnapshotId: "s-photo",
  additionalPackageSnapshotIds: ["s-video"],
};
const accepted = {
  id: "prop-2",
  projectId: "p1",
  status: "accepted",
  version: 2,
  pricingSnapshot: { totalCents: 950000 },
  paymentSchedule: [
    { label: "Retainer", amountCents: 200000 },
    { label: "Final balance", amountCents: 750000 },
  ],
  packageDetails: [
    { snapshotId: "s-photo", packageName: "Gold Photo Package", items: ["Two photographers", "Album"] },
    { snapshotId: "s-video", packageName: "Silver Cinematic Package", items: ["One videographer", "Highlight film"] },
  ],
};

test("proposal terms join every package's own terms under its name", () => {
  const terms = proposalTermsForPackages([photo, video]);
  assert.equal(
    terms,
    `Gold Photo Package: ${photo.terms}\n\nSilver Cinematic Package: ${video.terms}`,
  );
  // One package keeps its terms exactly as written, as before.
  assert.equal(proposalTermsForPackages([photo]), photo.terms);
  // A package with none is skipped, not given the other's terms.
  assert.equal(
    proposalTermsForPackages([{ ...photo, terms: "" }, video]),
    `Silver Cinematic Package: ${video.terms}`,
  );
  // None written anywhere: the default wording.
  assert.equal(proposalTermsForPackages([{ ...photo, terms: "" }, { ...video, terms: " " }]), DEFAULT_PROPOSAL_TERMS);
  assert.equal(proposalTermsForPackages([]), DEFAULT_PROPOSAL_TERMS);
  // A catalogue record names itself `name`, not `packageName`.
  assert.match(proposalTermsForPackages([{ name: "Gold", terms: photo.terms }, { name: "Film", terms: video.terms }]), /^Gold: /);
  assert.ok(proposalTermsForPackages([photo, { ...video, terms: "x".repeat(7000) }]).length <= 6000);
});

test("the functions copy of the joined terms behaves the same", () => {
  for (const packages of [[photo, video], [photo], [{ ...photo, terms: "" }, video], [], [{ name: "A", terms: "ten chars!!" }]])
    assert.equal(functionsTermsForPackages(packages), proposalTermsForPackages(packages));
});

test("the final-balance figures are the agreed total less every payment on record", () => {
  const facts = finalBalanceFacts({
    proposals: [{ ...accepted, version: 1, status: "superseded", pricingSnapshot: { totalCents: 600000 } }, accepted],
    snapshots: [photo, video],
    invoices: [
      { kind: "retainer", status: "paid", amountCents: 200000, balanceCents: 0 },
      // A failed bill is no payment.
      { kind: "final", status: "failed", amountCents: 750000, balanceCents: 0 },
    ],
  });
  assert.deepEqual(facts, {
    packageNames: ["Gold Photo Package", "Silver Cinematic Package"],
    totalCents: 950000,
    paidCents: 200000,
    balanceCents: 750000,
    paymentsOnRecord: true,
  });
  // No accepted proposal: every package added up, and nothing verified paid.
  const before = finalBalanceFacts({ proposals: [], snapshots: [photo, video], invoices: [] });
  assert.equal(before.totalCents, 1000000);
  assert.equal(before.paymentsOnRecord, false);
  assert.equal(before.balanceCents, 1000000);
  // A snapshot with no total leaves the sum unknown rather than short.
  assert.equal(finalBalanceFacts({ proposals: [], snapshots: [photo, { packageName: "X" }], invoices: [] }).totalCents, null);
});

test("the functions copy of the final-balance figures matches features/", () => {
  const body = (path: string) => source(path).slice(source(path).indexOf("type Row = "));
  assert.equal(
    body("functions/src/communications/final-balance-facts.ts"),
    body("features/messaging/final-balance-facts.ts"),
  );
  const input = { proposals: [accepted], snapshots: [photo, video], invoices: [{ status: "paid", amountCents: 200000, balanceCents: 0 }] };
  assert.deepEqual(functionsFinalBalanceFacts(input), finalBalanceFacts(input));
});

test("the month-out balance notice names every package and the combined figures", () => {
  const balance = finalBalanceFacts({
    proposals: [accepted],
    snapshots: [photo, video],
    invoices: [{ kind: "retainer", status: "paid", amountCents: 200000, balanceCents: 0 }],
  });
  const facts = {
    studioName: "GR Productions",
    clientFirstName: "Cindy",
    projectName: "Cindy & Josh Wedding",
    eventDate: "2026-10-11",
    venueName: null,
    packageTotalCents: balance.totalCents,
    retainerPaidCents: balance.paidCents,
    balanceDueCents: balance.balanceCents,
    packageNames: balance.packageNames,
    paymentsOnRecord: balance.paymentsOnRecord,
    scheduleUrl: null,
    recipientEmail: "cindy@example.com",
    recipientName: "Cindy Alvarado",
  };
  for (const render of [renderLifecycleDraft, functionsRenderLifecycleDraft]) {
    const draft = render("final_invoice_notice", facts);
    assert.match(draft.body, /Gold Photo Package and Silver Cinematic Package/);
    assert.match(draft.body, /\$9,500\.00/);
    assert.match(draft.body, /\$2,000\.00 paid so far/);
    assert.match(draft.body, /\$7,500\.00/);
    assert.doesNotMatch(draft.body, /\$6,000\.00/, "never the photo package's total");
    assert.deepEqual(draft.missingInformation, []);
    // Unverified payments are flagged for the studio, which also keeps the
    // trust dial from auto-sending it.
    assert.ok(render("final_invoice_notice", { ...facts, paymentsOnRecord: false }).missingInformation.some((line) => /No payment is recorded/.test(line)));
  }
  assert.equal(packageNameList(["A", "B", "C"]), "A, B and C");
});

test("the scheduler and the drafter take the balance from every package and payment", () => {
  const scheduler = source("functions/src/communications/lifecycle-scheduler.ts");
  assert.match(scheduler, /finalBalanceFacts\(/);
  assert.match(scheduler, /loadJobPackageSnapshots\(/);
  assert.doesNotMatch(scheduler, /packageSnapshots\/\$\{snapshotId\}/);
  const drafter = source("functions/src/ai/message-draft.ts");
  assert.match(drafter, /finalBalanceFacts\(/);
  assert.match(drafter, /context\.jobPackages = jobFacts/);
  assert.doesNotMatch(drafter, /context\.package = /);
  assert.match(drafter, /name every package in `jobPackages\.packages`/);
});

test("the AI is told about every package, its terms, and the agreed total", () => {
  const facts = jobPackageFacts({
    snapshots: [photo, video].map(({ id, ...data }) => ({ id, data })),
    acceptedProposal: accepted,
  });
  assert.ok(facts);
  assert.deepEqual(facts.packageNames, ["Gold Photo Package", "Silver Cinematic Package"]);
  assert.equal(facts.combinedCoverage, "2 photographers and 1 videographer");
  assert.equal(facts.totalCents, 950000);
  assert.equal(facts.totalSource, "accepted_proposal");
  assert.equal(facts.retainerCents, 200000);
  assert.deepEqual(facts.packages[1]!.inclusions, ["One videographer", "Highlight film"]);
  assert.equal(facts.packages[1]!.terms, video.terms);
  assert.equal(facts.packages[1]!.coverage, "1 videographer");
  // Before acceptance: the packages added up, bullets from each description.
  const before = jobPackageFacts({ snapshots: [photo, video].map(({ id, ...data }) => ({ id, data })) });
  assert.equal(before?.totalCents, 1000000);
  assert.equal(before?.totalSource, "package_snapshots");
  assert.equal(before?.retainerCents, 250000);
  assert.deepEqual(before?.packages[0]!.inclusions, ["Two photographers for eight hours", "A 40-page album"]);
  assert.equal(jobPackageFacts({ snapshots: [] }), null);
});

test("Cue's project detail and proposal drafting carry every package", () => {
  const copilot = source("functions/src/ai/copilot.ts");
  assert.match(copilot, /packages: jobPackages\?\.packages \?\? \[\]/);
  assert.match(copilot, /packagesTotalCents: jobPackages\?\.packagesTotalCents \?\? null/);
  assert.match(copilot, /never from `selectedPackage` alone when `packages` has more than one/);
  // Proposal copy: every package, the combined crew, and a fallback naming all.
  assert.match(copilot, /packages: jobSnapshots\.map\(\(\{ data \}\) => \(\{/);
  assert.match(copilot, /combinedCoverage: describeCoverage\(\s*combineCoverage\(jobSnapshots/);
  assert.doesNotMatch(copilot, /facts\.packageSnapshot\./);
  assert.match(copilot, /const terms = proposalTermsForPackages\(facts\.packages\);/);
  assert.match(copilot, /Prepare an unsent proposal draft from \$\{packageNames\.join\(" \+ "\)\}/);
});

test("every place that seeds proposal terms uses every package", () => {
  const composer = source("components/proposals/studio-proposal-workspace.tsx");
  assert.equal((composer.match(/setTermsSummary\(proposalTermsForJob\(jobSnapshotsOf\(/g) ?? []).length, 3);
  assert.doesNotMatch(composer, /proposalTermsFor\(/);
  const card = source("components/ai/actions/booking-actions.tsx");
  assert.match(card, /termsSummary: proposalTermsForPackages\(onTheJob, trade\)/);
  assert.match(card, /From \$\{packageNames\.length \? packageNames\.join\(" \+ "\)/);
  const brief = source("components/booking/booking-autopilot-workspace.tsx");
  assert.match(brief, /termsSummary: proposalTerms,/);
  // Every package's terms, then the default in the studio's trade (2026-10-09).
  assert.match(brief, /const packageTerms = proposalTermsForPackages\(proposalPackages\);/);
  assert.match(brief, /const proposalTerms = defaultTermsInTradeWords\(packageTerms, workspace\.tenantTrade\);/);
});

test("a job is worth its accepted total, else every package on it", () => {
  const snapshots = [photo, video, { id: "s-old", totalCents: 999900 }];
  assert.equal(jobValueCents({ project, snapshots, proposals: [accepted] }), 950000);
  // Before acceptance: both packages, never a replaced snapshot.
  assert.equal(jobValueCents({ project, snapshots, proposals: [] }), 1000000);
  assert.equal(jobValueCents({ project: { id: "p9" }, snapshots, proposals: [] }), null);
  assert.equal(
    bookedValueCents({
      projects: [project, { id: "p2", state: "PROPOSAL", packageSnapshotId: "s-photo" }],
      packageSnapshots: snapshots,
      proposals: [accepted],
    }),
    950000,
  );
  assert.equal(bookedValueCents({ projects: [project], packageSnapshots: snapshots }), 1000000);
  const jobs = source("components/live/tenant-records.tsx");
  assert.match(jobs, /valueCents: jobValueCents\(\{/);
  assert.match(source("components/today/use-today-inbox.ts"), /proposals: proposals\.records,\n\s*\}\),\n\s*handled/);
});
