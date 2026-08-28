import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { retainerFromSchedule } from "@/features/booking/agreed-retainer";
import {
  balanceFromTotals,
  finalBalanceFromSchedule,
} from "@/features/booking/agreed-final-balance";
import { createPackageSnapshot } from "@/features/packages/create-snapshot";
import type {
  PackageSelection,
  StudioPackage,
} from "@/features/packages/schema";

/**
 * What the couple owes, added up.
 *
 * Every figure in this product is integer cents, and three separate readings
 * decide what a couple is billed: the package snapshot's total, the retainer
 * taken off the accepted proposal's payment schedule, and the final balance
 * taken off the same schedule. Each has its own unit tests. Nothing asserted
 * that they *agree* — that retainer plus balance is the total the couple
 * accepted, and never a penny more or less.
 *
 * A studio can override the retainer in the composer, which deliberately
 * leaves the immutable snapshot alone and moves the split instead. That is
 * exactly the operation where a rounding or clamping mistake bills somebody a
 * number nobody agreed to.
 */

/** The schedule the server builds, mirrored from functions/src/booking/proposals.ts. */
const serverSchedule = (totalCents: number, overrideCents?: number | null) => {
  const retainerCents =
    typeof overrideCents === "number"
      ? Math.min(overrideCents, totalCents)
      : Math.round(totalCents * 0.3);
  return [
    { label: "Retainer", amountCents: retainerCents, dueDate: null },
    {
      label: "Final balance",
      amountCents: Math.max(0, totalCents - retainerCents),
      dueDate: null,
    },
  ];
};

const TOTALS = [0, 1, 99, 100, 333, 1_000, 189_900, 650_000, 1_234_567, 9_999_999];
const OVERRIDES = [undefined, null, 0, 1, 100, 50_000, 650_000, 10_000_000];

test("retainer plus final balance is exactly the agreed total", () => {
  for (const total of TOTALS) {
    for (const override of OVERRIDES) {
      const schedule = serverSchedule(total, override);
      const retainer = retainerFromSchedule(schedule, -1);
      const balance = finalBalanceFromSchedule(schedule, -1);
      assert.equal(
        retainer + balance,
        total,
        `total ${total} with override ${override} split into ${retainer} + ${balance}`,
      );
    }
  }
});

test("no figure is ever negative or fractional", () => {
  for (const total of TOTALS) {
    for (const override of OVERRIDES) {
      const schedule = serverSchedule(total, override);
      for (const amount of [
        retainerFromSchedule(schedule, -1),
        finalBalanceFromSchedule(schedule, -1),
      ]) {
        assert.ok(Number.isInteger(amount), `${amount} is not integer cents`);
        assert.ok(amount >= 0, `${amount} is negative`);
      }
    }
  }
});

test("a retainer override larger than the total cannot make the balance negative", () => {
  // The clamp lives in the server's schedule builder; this is the reading side
  // refusing to invent a refund if it ever gets past.
  assert.equal(balanceFromTotals(189_900, 500_000), 0);
  assert.equal(balanceFromTotals(0, 100), 0);
  assert.equal(balanceFromTotals(650_000, 220_680), 429_320);
});

test("a zero retainer and a paid-in-full retainer are both honoured", () => {
  // Both are real choices a studio makes, and neither may fall back to the
  // package's own figure — that is how a $1 retainer became $569.70.
  const nothingUpFront = serverSchedule(189_900, 0);
  assert.equal(retainerFromSchedule(nothingUpFront, 56_970), 0);
  assert.equal(finalBalanceFromSchedule(nothingUpFront, 0), 189_900);

  const allUpFront = serverSchedule(189_900, 189_900);
  assert.equal(retainerFromSchedule(allUpFront, 56_970), 189_900);
  assert.equal(finalBalanceFromSchedule(allUpFront, 999), 0);
});

test("a missing or nonsensical figure falls back, a real zero does not", () => {
  assert.equal(retainerFromSchedule([{ label: "Retainer" }], 56_970), 56_970);
  assert.equal(
    retainerFromSchedule([{ label: "Retainer", amountCents: -5 }], 56_970),
    56_970,
  );
  assert.equal(
    retainerFromSchedule([{ label: "Retainer", amountCents: 12.5 }], 56_970),
    56_970,
  );
  assert.equal(
    retainerFromSchedule([{ label: "Retainer", amountCents: 0 }], 56_970),
    0,
  );
  assert.equal(finalBalanceFromSchedule("not a schedule", 4_200), 4_200);
});

/**
 * A snapshot's parts add up to its whole.
 *
 * `package-snapshot.test.ts` pins one fixture's figures exactly, which catches
 * a change in the arithmetic. It does not assert the *relationship* holds for
 * other shapes, and every one of these numbers is a separate rounded
 * computation: a percentage discount, a tax rate in basis points, and a
 * retainer rule that may be a percentage, a fixed amount, or per crew member.
 */
const basePackage = (
  overrides: Partial<StudioPackage> = {},
): StudioPackage => ({
  id: "package-1",
  tenantId: "tenant-a",
  name: "Signature Wedding",
  description: "Eight hours of documentary wedding coverage.",
  eventTypeId: "wedding",
  eventTypeLabel: "Wedding",
  basePriceCents: 600_000,
  currency: "USD",
  retainerRule: { type: "percentage", basisPoints: 3000 },
  includedCoverageMinutes: 480,
  includedPhotographers: 2,
  includedDeliverables: ["Online gallery"],
  includedTravelArea: "Within 50 miles",
  addOns: [
    {
      id: "album",
      name: "Heirloom album",
      description: "Ten-spread album",
      unitPriceCents: 100_000,
      taxable: true,
      active: true,
    },
  ],
  taxRateBasisPoints: 887,
  terms: "Subject to the completed studio agreement.",
  active: true,
  publicVisible: true,
  displayOrder: 1,
  internalNotes: null,
  version: 4,
  createdAt: "2026-08-28T00:00:00.000Z",
  updatedAt: "2026-08-28T00:00:00.000Z",
  createdBy: "owner",
  updatedBy: "owner",
  archivedAt: null,
  ...overrides,
});

test("a snapshot's components always add up to its total", () => {
  const cases: Array<[Partial<StudioPackage>, PackageSelection["discount"]]> = [
    [{}, { type: "none" }],
    [{}, { type: "fixed", amountCents: 50_000 }],
    [{}, { type: "percentage", basisPoints: 1_250 }],
    [{ basePriceCents: 1 }, { type: "none" }],
    [{ basePriceCents: 333 }, { type: "percentage", basisPoints: 3_333 }],
    [{ taxRateBasisPoints: 0 }, { type: "fixed", amountCents: 1 }],
    [{ taxRateBasisPoints: 10_000 }, { type: "none" }],
    [
      { retainerRule: { type: "fixed", amountCents: 1 } },
      { type: "none" },
    ],
    [
      { retainerRule: { type: "per_crew_member", amountPerCrewCents: 999_999 } },
      { type: "none" },
    ],
    // A discount larger than the price is clamped, not turned into a credit.
    [{}, { type: "fixed", amountCents: 99_999_999 }],
    [{}, { type: "percentage", basisPoints: 20_000 }],
  ];
  for (const [overrides, discount] of cases) {
    const studioPackage = basePackage(overrides);
    const snapshot = createPackageSnapshot({
      id: "snapshot-1",
      tenantId: "tenant-a",
      projectId: "project-1",
      selectedBy: "owner",
      selectedAt: "2026-08-28T00:00:00.000Z",
      package: studioPackage,
      selection: {
        packageId: "package-1",
        selectedAddOns: [{ addOnId: "album", quantity: 1 }],
        discount,
      },
    });
    const label = JSON.stringify({ overrides, discount });
    const addOnTotal = snapshot.addOns.reduce(
      (sum, addOn) => sum + addOn.lineTotalCents,
      0,
    );
    assert.equal(
      snapshot.subtotalCents,
      snapshot.basePriceCents + addOnTotal - snapshot.discountCents,
      `subtotal does not reconcile for ${label}`,
    );
    assert.equal(
      snapshot.totalCents,
      snapshot.subtotalCents + snapshot.taxCents,
      `total is not subtotal plus tax for ${label}`,
    );
    for (const [name, amount] of Object.entries({
      basePriceCents: snapshot.basePriceCents,
      discountCents: snapshot.discountCents,
      subtotalCents: snapshot.subtotalCents,
      taxCents: snapshot.taxCents,
      totalCents: snapshot.totalCents,
      retainerCents: snapshot.retainerCents,
    })) {
      assert.ok(Number.isInteger(amount), `${name} is not integer for ${label}`);
      assert.ok(amount >= 0, `${name} is negative for ${label}`);
    }
    assert.ok(
      snapshot.retainerCents <= snapshot.totalCents,
      `retainer exceeds the total for ${label}`,
    );
  }
});

/**
 * The browser never supplies a payment schedule.
 *
 * Conservation above holds because the schedule is built once, server-side, in
 * `paymentSchedule()`. If a command ever started accepting one from the client,
 * a studio could send a couple two figures that do not add up to what they
 * accepted, and every test above would still pass.
 */
test("no command endpoint accepts a payment schedule from the browser", () => {
  for (const file of [
    "functions/src/booking/commands.ts",
    "functions/src/crm/commands.ts",
  ]) {
    const source = readFileSync(`${process.cwd()}/${file}`, "utf8");
    const inputSchemas = source.slice(0, source.indexOf("onRequest("));
    assert.doesNotMatch(
      inputSchemas,
      /paymentSchedule:\s*z\./,
      `${file} takes a payment schedule as command input`,
    );
  }
});
