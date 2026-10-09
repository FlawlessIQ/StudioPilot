import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { assertProposalAction } from "../functions/src/booking/proposal-domain.ts";
import { allowedProjectTransitions } from "../features/projects/state-machine.ts";
import { todayInbox } from "../features/today/inbox.ts";

/**
 * A couple who wants video on top of their photography — or a different
 * package — must be able to have it until their agreement goes out. Cue told
 * a studio a job holds one package that "cannot be edited once set": the
 * server refused a second package outright, the UI only offered "add
 * alongside" to jobs with no package, and an accepted proposal could not be
 * revised at all.
 */

const source = (path: string) => readFileSync(`${process.cwd()}/${path}`, "utf8");
const crm = source("functions/src/crm/commands.ts");

test("a proposal can be re-priced from its packages at every stage before it's final", () => {
  for (const status of ["draft", "internal_review", "approved", "sent", "viewed", "accepted"]) {
    assert.doesNotThrow(() => assertProposalAction(status, "revise_packages"), status);
  }
  for (const status of ["declined", "expired", "superseded"]) {
    assert.throws(() => assertProposalAction(status, "revise_packages"), status);
  }
});

test("a revised acceptance steps the job back from contract pending to proposal", () => {
  assert.ok(allowedProjectTransitions.CONTRACT_PENDING.includes("PROPOSAL"));
  assert.match(source("functions/src/crm/transitions.ts"), /CONTRACT_PENDING: \["RETAINER_PENDING", "PROPOSAL"/);
});

test("a job with a package can take another, but only replaces one when asked by name", () => {
  const select = crm.slice(crm.indexOf('if (command.type === "selectPackage")'));
  const guard = select.slice(0, select.indexOf("const selectedLines"));
  // The unconditional refusal is gone…
  assert.doesNotMatch(guard, /if \(project\.packageSnapshotId\) \{\s*throw new Error\("PACKAGE_ALREADY_SELECTED"\)/);
  // …replaced by: replace needs confirmReplace, and every change checks the
  // agreement and invoices haven't gone out.
  assert.match(guard, /mode === "replace" && !command\.input\.confirmReplace/);
  assert.match(guard, /assertPackagesEditable/);
  assert.match(crm, /throw new Error\("AGREEMENT_ALREADY_SENT"\)/);
  assert.match(crm, /throw new Error\("INVOICE_ALREADY_RAISED"\)/);
});

test("removing the main package promotes the next, and a job always keeps one", () => {
  const remove = crm.slice(crm.indexOf('if (command.type === "removePackage")'));
  assert.match(remove, /LAST_PACKAGE_ON_JOB/);
  assert.match(remove, /packageSnapshotId: additional\[0\]!/);
});

test("Cue no longer tells a studio a job's package cannot be changed", () => {
  const copilot = source("functions/src/ai/copilot.ts");
  assert.doesNotMatch(copilot, /What cannot be edited is the job's stage, its readiness and its selected package/);
  assert.match(copilot, /A job's PACKAGES can be changed until its agreement has gone out/);
});

test("the proposal page offers the change, through the packages panel", () => {
  const workspace = source("components/proposals/studio-proposal-workspace.tsx");
  assert.match(workspace, /<ProposalPackagesPanel/);
  const panel = source("components/proposals/proposal-packages-panel.tsx");
  assert.match(panel, /"revise_packages"/);
  assert.match(panel, /confirmReplace: mode === "replace"/);
});

test("Cue's package flow adds to a job that already has one, and revises its proposal", () => {
  const flow = source("components/ai/flow-runner.tsx");
  const packageFlow = flow.slice(flow.indexOf("function PackageSelectFlow"), flow.indexOf("function QuestionnaireSelectFlow"));
  assert.match(packageFlow, /mode: adding \? "add" : "replace"/);
  assert.match(packageFlow, /runProposalCommand\("revise_packages"/);
  // It says what the tap will do to an accepted proposal before the tap.
  // (In the studio's word for it: a makeup or hair studio's quote.)
  assert.match(packageFlow, /They've accepted their \$\{offer\}\. Adding a package makes a revised \$\{offer\}/);
  // And refuses, in words, once the agreement is out.
  assert.match(packageFlow, /The agreement has gone out/);
  assert.doesNotMatch(packageFlow, /already has a package selected/);
  const copilot = source("functions/src/ai/copilot.ts");
  assert.match(copilot, /Launch the same flow when the operator asks to ADD a package to a job that already has one/);
});


test("a couple's request to add a package is a Today card that revises their newest proposal", () => {
  const inbox = todayInbox({
    now: "2026-09-29T15:00:00Z",
    projects: [{ id: "p1", name: "Gabe and Dionne", state: "CONTRACT_PENDING", archivedAt: null, eventDate: "2027-08-17" }],
    proposals: [
      { id: "old", projectId: "p1", status: "superseded", version: 1 },
      { id: "current", projectId: "p1", status: "accepted", version: 2 },
    ],
    packageRequests: [
      {
        id: "req1",
        projectId: "p1",
        packageId: "pkg-photo",
        packageName: "Gold Photo Package",
        basePriceCents: 349900,
        currency: "USD",
        note: "We'd love photos too",
        status: "pending",
        createdAt: "2026-09-29T14:00:00Z",
      },
      { id: "req2", projectId: "p1", packageId: "x", packageName: "Done", status: "approved" },
    ],
  });
  const cards = inbox.act.filter((item) => item.id.startsWith("package-request-"));
  assert.equal(cards.length, 1, "only the pending request");
  assert.equal(cards[0]!.title, "Gabe and Dionne want to add Gold Photo Package");
  assert.match(cards[0]!.detail, /\$3,499 · “We'd love photos too” · Adding it makes a revised proposal for them to accept\./);
  assert.ok(cards[0]!.action.kind === "package_request" && cards[0]!.action.proposalId === "current");
});

test("the portal asks, never changes: a request is written for the studio to decide", () => {
  const portal = source("app/api/client/portal/route.ts");
  const request = portal.slice(portal.indexOf("async function requestPackageForClient"), portal.indexOf("async function selectPackageForClient"));
  assert.match(request, /status: "pending"/);
  // It never touches the job's packages or the proposal itself.
  assert.doesNotMatch(request, /packageSnapshotId|additionalPackageSnapshotIds|pricingSnapshot/);
  // Only packages the studio shows couples, and only before the agreement is out.
  assert.match(portal, /where\("publicVisible", "==", true\)/);
  assert.match(portal, /!agreementOut &&\s*!invoiceRaised/);
  const rules = source("firestore.rules");
  assert.match(rules, /match \/packageRequests\/\{requestId\} \{\s*allow read: if canManageProjects\(resource\.data\.tenantId\);\s*allow write: if false;/);
});

test("the same package can't be added to a job twice", () => {
  assert.match(crm, /throw new Error\("PACKAGE_ALREADY_ON_JOB"\)/);
});
