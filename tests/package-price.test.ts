import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { pricePackage, type PackageDiscount, type RetainerRule } from "@/features/pricing/package-price";
import { clipForPdf } from "../functions/src/operations/ai-pdf";

/**
 * One price for a package (H2 slice 1, docs/proposal-agreement-and-addons-plan-2026-09-28.md).
 * The studio's selection, the couple's selection and the snapshot factory each
 * had their own copy; they now share this one.
 */

const MARKER = "// ── mirrored below ──";
const body = (path: string) => {
  const source = readFileSync(path, "utf8");
  return source.slice(source.indexOf(MARKER));
};

test("the functions copy is the same function", () => {
  assert.equal(body("functions/src/pricing/package-price.ts"), body("features/pricing/package-price.ts"));
});

/** The formula every copy used before, with every add-on taxed. */
function legacy(input: {
  base: number;
  addOns: number[];
  discount: PackageDiscount;
  taxBp: number;
  retainer: RetainerRule;
  crew: number;
}) {
  const pct = (amount: number, bp: number) => Math.round((amount * bp) / 10000);
  const pre = input.base + input.addOns.reduce((sum, value) => sum + value, 0);
  const requested =
    input.discount.type === "none" ? 0 : input.discount.type === "fixed" ? input.discount.amountCents : pct(pre, input.discount.basisPoints);
  const discount = Math.min(requested, pre);
  const subtotal = pre - discount;
  const tax = pct(subtotal, input.taxBp);
  const total = subtotal + tax;
  const retainer =
    input.retainer.type === "fixed"
      ? Math.min(input.retainer.amountCents, total)
      : input.retainer.type === "per_crew_member"
        ? Math.min(input.retainer.amountPerCrewCents * input.crew, total)
        : pct(total, input.retainer.basisPoints);
  return { discount, subtotal, tax, total, retainer };
}

test("a package with every add-on taxed prices exactly as it always did", () => {
  const discounts: PackageDiscount[] = [
    { type: "none" },
    { type: "fixed", amountCents: 50_000 },
    { type: "percentage", basisPoints: 1250 },
    { type: "fixed", amountCents: 99_999_999 },
  ];
  const retainers: RetainerRule[] = [
    { type: "fixed", amountCents: 100_000 },
    { type: "percentage", basisPoints: 3000 },
    { type: "per_crew_member", amountPerCrewCents: 100_000 },
  ];
  for (const base of [0, 1, 450_000, 612_345]) {
    for (const addOns of [[], [25_000], [12_345, 67_891]]) {
      for (const discount of discounts) {
        for (const retainer of retainers) {
          for (const taxBp of [0, 625, 887]) {
            const expected = legacy({ base, addOns, discount, taxBp, retainer, crew: 2 });
            const priced = pricePackage({
              basePriceCents: base,
              addOns: addOns.map((unitPriceCents) => ({ unitPriceCents, quantity: 1, taxable: true })),
              discount,
              taxRateBasisPoints: taxBp,
              retainerRule: retainer,
              billedCrew: 2,
            });
            assert.deepEqual(
              {
                discount: priced.discountCents,
                subtotal: priced.subtotalCents,
                tax: priced.taxCents,
                total: priced.totalCents,
                retainer: priced.retainerCents,
              },
              expected,
              JSON.stringify({ base, addOns, discount, retainer, taxBp }),
            );
          }
        }
      }
    }
  }
});

test("an add-on marked not taxable is not taxed (M5)", () => {
  const priced = pricePackage({
    basePriceCents: 400_000,
    addOns: [
      { unitPriceCents: 50_000, quantity: 2, taxable: false }, // e.g. travel, not taxable
      { unitPriceCents: 30_000, quantity: 1, taxable: true },
    ],
    discount: { type: "none" },
    taxRateBasisPoints: 1000,
    retainerRule: { type: "fixed", amountCents: 0 },
    billedCrew: 1,
  });
  assert.equal(priced.subtotalCents, 530_000);
  assert.equal(priced.taxableCents, 430_000);
  assert.equal(priced.taxCents, 43_000);
  assert.equal(priced.totalCents, 573_000);
});

test("a discount comes off taxed and untaxed work in proportion", () => {
  const priced = pricePackage({
    basePriceCents: 300_000,
    addOns: [{ unitPriceCents: 100_000, quantity: 1, taxable: false }],
    discount: { type: "fixed", amountCents: 40_000 },
    taxRateBasisPoints: 1000,
    retainerRule: { type: "percentage", basisPoints: 5000 },
    billedCrew: 1,
  });
  // 360,000 after the discount; three quarters of it was taxable.
  assert.equal(priced.subtotalCents, 360_000);
  assert.equal(priced.taxableCents, 270_000);
  assert.equal(priced.taxCents, 27_000);
  assert.equal(priced.totalCents, 387_000);
  assert.equal(priced.retainerCents, 193_500);
});

test("the three places a package is priced all use the one function", () => {
  for (const path of [
    "features/packages/create-snapshot.ts",
    "functions/src/crm/commands.ts",
    "app/api/client/portal/route.ts",
  ]) {
    const source = readFileSync(path, "utf8");
    assert.match(source, /pricePackage\(\{/, `${path} prices through pricePackage`);
    assert.doesNotMatch(source, /\(subtotalCents \* [a-zA-Z.]*taxRateBasisPoints/, `${path} has its own tax sum`);
  }
});

test("a proposal's schedule follows every package, and keeps a hand-set retainer (M4)", () => {
  const source = readFileSync("functions/src/booking/proposals.ts", "utf8");
  // create_draft: the schedule is built from the combined pricing.
  assert.match(source, /paymentSchedule: paymentSchedule\(\s*combinedPricing,/);
  // revise_packages: the override is carried through.
  assert.match(source, /typeof priorSchedule\[1\]\?\.dueDate === "string" \? String\(priorSchedule\[1\]\.dueDate\) : null,\s*retainerOverrideCents,/);
  assert.match(source, /retainerOverrideCents:\s*typeof command\.input\.retainerOverrideCents === "number"/);
  // Lines say what they are.
  assert.match(source, /kind: "package" as const/);
  assert.match(source, /kind: "add_on" as const/);
});

test("the final invoice and the portal balance bill what was agreed (M2/M3)", () => {
  const scheduler = readFileSync("functions/src/operations/invoice-scheduler.ts", "utf8");
  assert.match(scheduler, /\.where\("status", "==", "accepted"\)/);
  assert.match(scheduler, /retainerFromSchedule\(\s*accepted\?\.get\("paymentSchedule"\)/);
  const portal = readFileSync("app/api/client/portal/route.ts", "utf8");
  assert.match(portal, /Math\.max\(0, totalCents - Number\(retainer\?\.amountCents \?\? 0\)\)/);
});

test("the proposal PDF fits the renderer and shows one retainer (M7)", () => {
  assert.equal(clipForPdf("short", 10), "short");
  const clipped = clipForPdf("x".repeat(5000), 3000);
  assert.equal(clipped.length, 3000);
  assert.ok(clipped.endsWith("…"));
  const pdf = readFileSync("functions/src/operations/ai-pdf.ts", "utf8");
  assert.match(pdf, /retainer:money\(retainerFromSchedule\(paymentSchedule/);
  assert.doesNotMatch(pdf, /retainer:money\(pricing\.retainerCents/);
});
