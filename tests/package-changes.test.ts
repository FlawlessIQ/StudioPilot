import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { assertProposalAction } from "../functions/src/booking/proposal-domain.ts";
import { allowedProjectTransitions } from "../features/projects/state-machine.ts";

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
  assert.match(crm, /CONTRACT_PENDING: \["RETAINER_PENDING", "PROPOSAL"/);
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
