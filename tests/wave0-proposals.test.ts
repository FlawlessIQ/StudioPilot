import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  COMBINED_AGREEMENT_RELEASED_STATUSES,
  combinedAgreementLive,
  draftFormDirty,
  packageChangeAlreadyApplied,
  proposalAlreadyRevised,
  proposalHasLapsed,
  proposalWithCouple,
  type DraftForm,
} from "@/features/proposals/workspace-guards";
import {
  currentCoupleProposal,
  planClientProposalDecision,
} from "@/server/client/proposal-decision";
import { agreementChangedSincePrepared } from "@/features/contracts/agreement-version";
import { friendlyError } from "@/lib/ai/friendly-error";
import { expiryOnSend } from "../functions/src/booking/proposal-expiry";
import {
  assertProposalAction,
  packageChangeNeedsApprover,
} from "../functions/src/booking/proposal-domain";

/**
 * Wave 0 — the proposal and contract bugs a studio at the proposal stage
 * (GR Productions, 2026-09-30) could hit: edits lost on approve, an expired
 * proposal with no way back, a package change that stranded a sent proposal,
 * buttons the server refuses, a draft shown to the couple as current, and an
 * old agreement sent after the studio changed it.
 */

const read = (path: string) => readFileSync(path, "utf8");
const workspaceSource = read("components/proposals/studio-proposal-workspace.tsx");

// ---- 1. Approve saves the draft first -------------------------------------

const loaded: DraftForm = {
  notes: "Thank you",
  termsSummary: "Terms that are long enough",
  expiresOn: "2026-10-14",
  retainerDueDate: "2026-10-20",
  balanceDueDate: "2027-05-29",
  draftRetainer: null,
};

test("an untouched draft form is not dirty, so approve goes straight through", () => {
  assert.equal(draftFormDirty(loaded, { ...loaded }), false);
});

test("any edit the record doesn't hold makes the form dirty", () => {
  assert.equal(draftFormDirty(loaded, { ...loaded, draftRetainer: "10" }), true);
  assert.equal(draftFormDirty(loaded, { ...loaded, notes: "Thanks!" }), true);
  assert.equal(draftFormDirty(loaded, { ...loaded, termsSummary: "Changed terms here" }), true);
  assert.equal(draftFormDirty(loaded, { ...loaded, expiresOn: "2026-11-01" }), true);
  assert.equal(draftFormDirty(loaded, { ...loaded, retainerDueDate: "" }), true);
  assert.equal(draftFormDirty(loaded, { ...loaded, balanceDueDate: "2027-06-01" }), true);
});

test("approving saves a dirty draft first and stops when the save fails", () => {
  const body = workspaceSource.slice(workspaceSource.indexOf("async function submitDraft"));
  const save = body.indexOf('if (dirty && !(await run("update_draft"))) return;');
  const submit = body.indexOf('run("submit_for_approval")');
  assert.ok(save > 0, "submitDraft saves when dirty and returns on failure");
  assert.ok(submit > save, "submit runs only after the save");
  assert.match(workspaceSource, /onClick=\{\(\) => void submitDraft\(canApprove\)\}/);
  assert.doesNotMatch(workspaceSource, /submitAndApprove/);
});

// ---- 2. An expired proposal can be extended and resent --------------------

const now = Date.parse("2026-09-30T12:00:00.000Z");

test("a sent proposal past its date has lapsed; other statuses never do", () => {
  assert.equal(proposalHasLapsed("sent", "2026-09-29T23:59:59.000Z", now), true);
  assert.equal(proposalHasLapsed("viewed", "2026-09-30T12:00:00.000Z", now), true);
  assert.equal(proposalHasLapsed("viewed", "2026-10-07T12:00:00.000Z", now), false);
  // The decision refuses an unreadable expiry, so it reads as lapsed.
  assert.equal(proposalHasLapsed("sent", "", now), true);
  for (const status of ["draft", "approved", "accepted", "declined", "withdrawn"]) {
    assert.equal(proposalHasLapsed(status, "2020-01-01T00:00:00.000Z", now), false, status);
  }
});

test("resending an expired proposal re-opens it for at least a week; a longer window is kept", () => {
  const sentAt = new Date(now);
  const extended = expiryOnSend("2026-09-20T23:59:59.000Z", sentAt);
  assert.equal(extended, "2026-10-07T12:00:00.000Z");
  // And the couple's decision now accepts it.
  const plan = planClientProposalDecision({
    decision: "accepted",
    now: sentAt.toISOString(),
    project: { state: "PROPOSAL", packageSnapshotId: "snap-1" },
    proposal: { status: "viewed", expiresAt: extended, packageSnapshotId: "snap-1" },
  });
  assert.equal(plan.proposalStatus, "accepted");
  assert.equal(expiryOnSend("2026-12-01T23:59:59.000Z", sentAt), "2026-12-01T23:59:59.000Z");
});

test("the resend command moves the expiry and audits where it moved from", () => {
  const source = read("functions/src/booking/proposals.ts");
  const resend = source.slice(source.indexOf("A resend re-opens the offer"));
  assert.match(resend, /expiryOnSend\(priorExpiresAt, new Date\(timestamp\)\)/);
  assert.match(resend, /\.\.\.\(expiryExtended \? \{ expiresAt \} : \{\}\)/);
  assert.match(resend, /expiryExtended,/);
  // `before` carries the old date into the audit event beside `after: output`.
  assert.match(source, /expiresAt: proposal\.get\("expiresAt"\) \?\? null,/);
});

test("the studio page says Expired and offers Extend and resend", () => {
  assert.match(workspaceSource, /lapsed \? "Expired" : "Valid through"/);
  assert.match(workspaceSource, /lapsed \? "Extend and resend" : "Resend branded email"/);
  assert.match(workspaceSource, /statusLabel\(lapsed \? "expired" : status\)/);
});

// ---- 3. A package change always re-prices the proposal --------------------

test("a package change that already landed still goes on to revise", () => {
  assert.equal(packageChangeAlreadyApplied(new Error("PACKAGE_ALREADY_ON_JOB")), true);
  assert.equal(packageChangeAlreadyApplied(new Error("PACKAGE_NOT_ON_JOB")), true);
  assert.equal(packageChangeAlreadyApplied(new Error("AGREEMENT_ALREADY_SENT")), false);
  assert.equal(
    proposalAlreadyRevised(new Error("PROPOSAL_ACTION_NOT_ALLOWED:revise_packages:superseded")),
    true,
  );
  assert.equal(
    proposalAlreadyRevised(new Error("PROPOSAL_ACTION_NOT_ALLOWED:revise_packages:withdrawn")),
    false,
  );
  // The string the server actually throws for a superseded proposal.
  assert.throws(
    () => assertProposalAction("superseded", "revise_packages"),
    (caught: unknown) => proposalAlreadyRevised(caught),
  );
});

test("a coordinator cannot change packages while a proposal priced from them exists", () => {
  for (const status of ["draft", "internal_review", "approved", "sent", "viewed", "accepted"]) {
    assert.equal(packageChangeNeedsApprover("studio_coordinator", [status]), true, status);
    assert.equal(packageChangeNeedsApprover("studio_owner", [status]), false, status);
    assert.equal(packageChangeNeedsApprover("studio_admin", [status]), false, status);
  }
  assert.equal(packageChangeNeedsApprover("studio_coordinator", []), false);
  assert.equal(
    packageChangeNeedsApprover("studio_coordinator", ["superseded", "declined", "withdrawn", "discarded"]),
    false,
  );
  const crm = read("functions/src/crm/commands.ts");
  // selectPackage, removePackage, setJobAddOns — and setPackageDiscount (wave 1).
  assert.equal((crm.match(/role: String\(membershipData\.role\),/g) ?? []).length, 4);
  assert.match(crm, /throw new Error\("PACKAGE_CHANGE_NEEDS_APPROVER"\)/);
  assert.notEqual(
    friendlyError(new Error("PACKAGE_CHANGE_NEEDS_APPROVER"), "fallback"),
    "fallback",
  );
});

test("the couple can't accept a proposal missing a package the job now holds", () => {
  const base = {
    decision: "accepted" as const,
    now: "2026-09-30T12:00:00.000Z",
    project: {
      state: "PROPOSAL",
      packageSnapshotId: "photo",
      additionalPackageSnapshotIds: ["video"],
    },
    proposal: {
      status: "viewed",
      expiresAt: "2026-10-30T12:00:00.000Z",
      packageSnapshotId: "photo",
      additionalPackageSnapshotIds: [] as string[],
    },
  };
  assert.throws(() => planClientProposalDecision(base), /PACKAGE_SNAPSHOT_CONFLICT/);
  const matched = planClientProposalDecision({
    ...base,
    proposal: { ...base.proposal, additionalPackageSnapshotIds: ["video"] },
  });
  assert.equal(matched.proposalStatus, "accepted");
  // An extra re-priced on the second package is a different snapshot id.
  assert.throws(
    () =>
      planClientProposalDecision({
        ...base,
        proposal: { ...base.proposal, additionalPackageSnapshotIds: ["video-old"] },
      }),
    /PACKAGE_SNAPSHOT_CONFLICT/,
  );
  for (const path of ["app/api/client/portal/route.ts", "server/contracts/combined-signing.ts"]) {
    assert.equal(
      (read(path).match(/additionalPackageSnapshotIds: (stringIds|idList)\(/g) ?? []).length,
      2,
      path,
    );
  }
});

test("Today's Add revises even when the package was already on the job", () => {
  const today = read("components/today/today-inbox.tsx");
  const add = today.slice(today.indexOf("function PackageRequestActions"));
  assert.doesNotMatch(add.slice(0, 2500), /alreadyAdded/);
  assert.match(add, /if \(action\.proposalId\) \{/);
  assert.match(add, /packageChangeAlreadyApplied\(caught\)/);
});

test("the Packages panel revises after a change that already landed, and is owner/admin only", () => {
  const panel = read("components/proposals/proposal-packages-panel.tsx");
  const change = panel.slice(panel.indexOf("async function change"));
  assert.ok(
    change.indexOf("packageChangeAlreadyApplied(caught)") <
      change.indexOf('runProposalCommand("revise_packages"'),
  );
  assert.match(panel, /workspace\.role !== "studio_owner" && workspace\.role !== "studio_admin"\) return null/);
});

test("the composer routes package changes for a sent job to that proposal", () => {
  const sent = proposalWithCouple([
    { id: "v1", status: "superseded", version: 1 },
    { id: "v2", status: "viewed", version: 2 },
    { id: "v3", status: "draft", version: 3 },
  ]);
  assert.equal(sent?.id, "v2");
  assert.equal(proposalWithCouple([{ id: "d", status: "draft", version: 1 }]), null);
  assert.match(workspaceSource, /selected\.openProposalId \|\| selected\.withCoupleProposalId \|\| packagePickerFor \? null/);
  assert.match(workspaceSource, /href=\{`\/studio\/proposals\/\$\{selected\.withCoupleProposalId\}`\}/);
});

// ---- 4. No Discard/Withdraw/Resend the server will refuse ------------------

test("a booking agreement holds the proposal in every status the server refuses", () => {
  const contracts = (status: string) => [{ id: "c1", status }];
  for (const status of ["queued", "sent", "delivered", "viewed", "partially_signed", "completed"]) {
    assert.equal(combinedAgreementLive("c1", contracts(status)), true, status);
  }
  for (const status of COMBINED_AGREEMENT_RELEASED_STATUSES) {
    assert.equal(combinedAgreementLive("c1", contracts(status)), false, status);
  }
  assert.equal(combinedAgreementLive("c1", null), true, "not loaded yet: stay guarded");
  assert.equal(combinedAgreementLive("c1", []), false, "missing document: the server allows it");
  assert.equal(combinedAgreementLive(null, contracts("sent")), false);
  // The same released list the server checks.
  assert.match(
    read("functions/src/booking/proposals.ts"),
    /!\["voided", "failed", "superseded"\]\.includes\(stringValue\(combined\.get\("status"\)\)\)/,
  );
});

test("undo and the owner-only actions are hidden while the agreement is live, and from coordinators", () => {
  assert.match(
    workspaceSource,
    /canApprove && !agreementLive && \["draft", "internal_review", "approved", "sent", "viewed"\]\.includes\(status\) \? \(\s*<div className="proposal-undo">/,
  );
  assert.match(workspaceSource, /canApprove && !agreementLive && \["approved", "sent", "viewed"\]\.includes\(status\)/);
  assert.match(workspaceSource, /proposal\.pdfState === "failed" && canApprove/);
  assert.match(workspaceSource, /\) : !canApprove \? \(/);
  assert.doesNotMatch(workspaceSource, /function combinedAgreementLive/);
});

// ---- 5. The couple's page never shows a draft as current -------------------

test("the couple's current proposal is the newest one they were given", () => {
  const fields = (proposal: { status: string; version: number }) => proposal;
  const proposals = [
    { status: "superseded", version: 1 },
    { status: "viewed", version: 2 },
    { status: "draft", version: 3 },
    { status: "internal_review", version: 4 },
    { status: "approved", version: 5 },
    { status: "discarded", version: 6 },
  ];
  assert.equal(currentCoupleProposal(proposals, fields)?.version, 2);
  assert.equal(currentCoupleProposal([{ status: "draft", version: 1 }], fields), undefined);
  assert.equal(
    currentCoupleProposal([...proposals, { status: "withdrawn", version: 7 }], fields)?.status,
    "withdrawn",
  );
  const portal = read("app/api/client/portal/route.ts");
  assert.match(portal, /collectionName === "proposals" \? scoped\.orderBy\("version", "desc"\) : scoped/);
  assert.match(portal, /const currentProposal = currentCoupleProposal\(/);
});

// ---- 6. A changed agreement is never sent in its old wording ---------------

test("a draft pinned to an older agreement version is stale", () => {
  assert.equal(agreementChangedSincePrepared("v1", "v2"), true);
  assert.equal(agreementChangedSincePrepared("v2", "v2"), false);
  assert.equal(agreementChangedSincePrepared("v1", null), false, "no current agreement is not a change");
  assert.equal(agreementChangedSincePrepared(undefined, "v2"), false);
});

test("the send refuses a stale draft, and the contract step says update it", () => {
  const commands = read("functions/src/contracts/commands.ts");
  const send = commands.slice(commands.indexOf("export async function sendContract"));
  const guard = send.indexOf('throw new Error("AGREEMENT_CHANGED_SINCE_PREPARED")');
  assert.ok(guard > 0 && guard < send.indexOf("const recheck = await resolveDraft"));
  assert.notEqual(
    friendlyError(new Error("AGREEMENT_CHANGED_SINCE_PREPARED"), "fallback"),
    "fallback",
  );
  const step = read("components/contracts/native-contract-step.tsx");
  assert.match(step, /Your agreement changed since this was prepared — update it\./);
  assert.match(step, /disabled=\{busy !== null \|\| missing\.length > 0 \|\| agreementStale\}/);
  assert.match(step, /\{fillable\.length \|\| agreementStale \? \(/);
});
