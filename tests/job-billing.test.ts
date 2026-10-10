import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as features from "../features/billing/job-billing";
import * as functionsCopy from "../functions/src/billing/job-billing";
import { jobBillingFromRecords, quickBooksReadyFrom } from "../features/billing/job-billing-from-records";

/**
 * Who bills a job — QuickBooks or the studio — is decided per job
 * (docs/own-invoicing-plan-2026-10-09.md). These hold the rules, keep the two
 * copies identical, and hold the guard: every path that raises a bill asks
 * the job first, so nothing sends a QuickBooks bill for a job the studio
 * bills itself, and no studio without QuickBooks is offered a button that can
 * only fail.
 */

const read = (path: string) => readFileSync(`${process.cwd()}/${path}`, "utf8");
const shared = (source: string) => source.slice(source.indexOf("// --- shared with"));

test("the features and functions copies match", () => {
  assert.equal(
    shared(read("functions/src/billing/job-billing.ts")),
    shared(read("features/billing/job-billing.ts")),
  );
});

for (const [name, module] of [
  ["features", features],
  ["functions", functionsCopy],
] as const) {
  test(`${name}: with no QuickBooks the studio bills every job, and is never asked`, () => {
    assert.deepEqual(module.jobBilling({ project: {}, quickbooksReady: false }), {
      method: "studio",
      decided: true,
      canChoose: false,
      reason: "only_option",
    });
    // Even a job someone once set to studio, or with nothing at all.
    assert.equal(module.jobBilling({ project: null, quickbooksReady: false }).method, "studio");
  });

  test(`${name}: a job chosen for QuickBooks whose QuickBooks has gone says so`, () => {
    const billing = module.jobBilling({ project: { billing: { method: "quickbooks" } }, quickbooksReady: false });
    assert.equal(billing.method, "studio");
    assert.equal(billing.reason, "quickbooks_disconnected");
    assert.equal(billing.canChoose, false);
  });

  test(`${name}: with QuickBooks, the job's own choice wins either way`, () => {
    for (const method of ["quickbooks", "studio"] as const) {
      assert.deepEqual(
        module.jobBilling({
          project: { billing: { method } },
          quickbooksReady: true,
          hasQuickBooksBills: method === "studio",
          lastChoice: method === "studio" ? "quickbooks" : "studio",
        }),
        { method, decided: true, canChoose: true, reason: "chosen" },
      );
    }
  });

  test(`${name}: an unchosen job with QuickBooks bills stays at QuickBooks`, () => {
    const billing = module.jobBilling({ project: {}, quickbooksReady: true, hasQuickBooksBills: true, lastChoice: "studio" });
    assert.equal(billing.method, "quickbooks");
    assert.equal(billing.reason, "existing_bills");
    assert.equal(billing.decided, true);
  });

  test(`${name}: an unchosen new job follows the last choice, else QuickBooks, and is still to be asked`, () => {
    assert.deepEqual(module.jobBilling({ project: {}, quickbooksReady: true, lastChoice: "studio" }), {
      method: "studio",
      decided: false,
      canChoose: true,
      reason: "suggested",
    });
    // What every job did before the choice existed.
    assert.equal(module.jobBilling({ project: {}, quickbooksReady: true }).method, "quickbooks");
    assert.equal(module.jobBilling({ project: {}, quickbooksReady: true, lastChoice: "nonsense" }).method, "quickbooks");
  });

  test(`${name}: only a standing QuickBooks bill counts as one`, () => {
    assert.equal(module.isQuickBooksBill({ provider: "quickbooks", status: "sent" }), true);
    assert.equal(module.isQuickBooksBill({ provider: "quickbooks", status: "paid" }), true);
    for (const status of ["failed", "superseded", "voided"])
      assert.equal(module.isQuickBooksBill({ provider: "quickbooks", status }), false, status);
    assert.equal(module.isQuickBooksBill({ provider: null, status: "paid" }), false);
    assert.equal(module.isQuickBooksBill({ provider: "stripe", status: "sent" }), false);
  });

  test(`${name}: a malformed choice is no choice`, () => {
    assert.equal(module.chosenJobBillingMethod({ billing: { method: "cash" } }), null);
    assert.equal(module.chosenJobBillingMethod({ billing: "studio" }), null);
    assert.equal(module.chosenJobBillingMethod({ billing: { method: "studio" } }), "studio");
  });
}

test("screens read QuickBooks readiness the way the server does", () => {
  assert.equal(quickBooksReadyFrom([{ provider: "quickbooks", status: "connected", archivedAt: null }]), true);
  assert.equal(quickBooksReadyFrom([{ provider: "quickbooks", status: "error", archivedAt: null }]), false);
  assert.equal(quickBooksReadyFrom([{ provider: "quickbooks", status: "connected", archivedAt: "2026-10-01" }]), false);
  // Stripe isn't offered for client billing.
  assert.equal(quickBooksReadyFrom([{ provider: "stripe", status: "connected", archivedAt: null }]), false);
  assert.equal(quickBooksReadyFrom(null), false);

  const connections = [{ provider: "quickbooks", status: "connected", archivedAt: null }];
  const qbBill = { projectId: "job1", provider: "quickbooks", status: "sent" };
  assert.equal(
    jobBillingFromRecords({ projectId: "job1", project: {}, connections, invoices: [qbBill], billingSettings: { lastJobBillingMethod: "studio" } })
      .reason,
    "existing_bills",
  );
  // Another job's QuickBooks bill doesn't decide this one.
  assert.equal(
    jobBillingFromRecords({ projectId: "job2", project: {}, connections, invoices: [qbBill], billingSettings: { lastJobBillingMethod: "studio" } })
      .method,
    "studio",
  );
});

// --- the guard ----------------------------------------------------------------

test("every server path that raises a bill asks how the job is billed", () => {
  const paths: Array<[string, RegExp]> = [
    // Deposit for a job with no agreement (family, portraits, sports).
    ["functions/src/booking/orchestration.ts", /billing\?\.method === "quickbooks"/],
    // Deposit when the agreement is signed.
    ["functions/src/booking/orchestration.ts", /billing\.method === "quickbooks"/],
    // Whether signing raises a deposit at all, decided at the send.
    ["functions/src/contracts/combined-commands.ts", /jobBillingFor\(db, context\.tenantId, input\.projectId\)\)\.method === "quickbooks"/],
    ["functions/src/contracts/combined-commands.ts", /jobBillingFor\(db, tenantId, projectId\)\)\.method === "quickbooks"/],
    ["functions/src/contracts/commands.ts", /jobBillingFor\(db, context\.tenantId, input\.projectId\)\)\.method === "quickbooks"/],
    // "Create retainer invoice", and a signature recorded by hand.
    ["functions/src/booking/commands.ts", /\.method === "studio"\s*\)\s*throw new Error\(STUDIO_BILLED_JOB\)/],
    ["functions/src/booking/commands.ts", /\.method === "quickbooks";/],
    // "Send the final bill", the 28-day scheduler and a booking change.
    // Phase 3: a self-billed final is drafted as the studio's own invoice, never sent to a provider.
    ["functions/src/booking/send-final-balance.ts", /const studioBilled = billing\.method === "studio";/],
    ["functions/src/operations/invoice-scheduler.ts", /jobBillingFor\(db, tenantId, project\.id/],
    ["functions/src/booking/amendment-apply.ts", /jobBillingFor\(db, core\.tenantId, core\.projectId/],
    // And the shared final-bill core drafts the studio's own invoice for one.
    ["functions/src/booking/final-invoice.ts", /if \(studioBilled\) \{[\s\S]{0,200}writeStudioInvoiceDraft|const written = await writeStudioInvoiceDraft/],
  ];
  for (const [path, pattern] of paths) assert.match(read(path), pattern, path);
  // The invoicing provider is never assumed for a deposit any more: the only
  // requireProviderForTenant left in these files is for signing.
  for (const path of ["functions/src/contracts/combined-commands.ts", "functions/src/contracts/commands.ts"])
    assert.doesNotMatch(read(path), /requireProviderForTenant\([^)]*"invoicing"/, path);
});

test("no screen offers a QuickBooks bill on a job the studio bills itself", () => {
  const screens: Array<[string, RegExp]> = [
    ["components/booking/project-booking-workspace.tsx", /studioBilled \? null : confirmingRetainer === "create"/],
    // Phase 3: a self-billed job's button drafts its own final, never "Send the final bill".
    ["components/booking/final-balance-actions.tsx", /confirming \? null : studioBilled \? \(/],
    ["components/today/today-inbox.tsx", /if \(studioBilled\) \{/],
    ["components/ai/actions/booking-actions.tsx", /billing\?\.method === "studio"/],
  ];
  for (const [path, pattern] of screens) {
    const source = read(path);
    assert.match(source, /useJobBilling\(/, `${path} reads the job's billing`);
    assert.match(source, pattern, path);
  }
});

test("the choice is a booking command, owner/admin, and never a browser write", () => {
  const command = read("functions/src/booking/job-billing-method.ts");
  assert.match(command, /studio_owner", "studio_admin"/);
  assert.match(command, /QUICKBOOKS_NOT_CONNECTED/);
  assert.match(command, /action: "billing\.job_method_set"/);
  assert.match(read("functions/src/booking/commands.ts"), /type: z\.literal\("setJobBillingMethod"\)/);
  assert.match(read("lib/ai/friendly-error.ts"), /BILLING_STUDIO_JOB:/);
});
