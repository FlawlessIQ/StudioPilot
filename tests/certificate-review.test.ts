import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  calendarDate,
  describeDiscrepancy,
  fieldLabel,
  limitDollars,
  sameCalendarDate,
  stillDisagrees,
} from "@/features/insurance/certificate-review";

/**
 * What a studio owner was shown before approving a legal document:
 *   eventDate: expected 2027-05-15, extracted 15 May 2027       (the same day)
 *   requiredLimits.generalLiability: expected 200000000, extracted   ($2m, in cents)
 */
test("a date written two ways is one date", () => {
  assert.equal(calendarDate("15 May 2027"), "2027-05-27".slice(0, 5) + "05-15");
  assert.equal(calendarDate("May 15, 2027"), "2027-05-15");
  assert.equal(calendarDate("2027-05-15"), "2027-05-15");
  assert.equal(calendarDate("05/15/2027"), "2027-05-15");
  assert.ok(sameCalendarDate("2027-05-15", "15 May 2027"));
  assert.ok(sameCalendarDate("2027-05-15", "May 15, 2027"));
  // A different day is still a different day.
  assert.ok(!sameCalendarDate("2027-05-15", "16 May 2027"));
  // And an unreadable date never quietly passes.
  assert.ok(!sameCalendarDate("2027-05-15", "sometime in May"));
  assert.equal(calendarDate("sometime in May"), null);
});

test("cents and dollars are weighed as dollars", () => {
  assert.equal(limitDollars(200000000, true), 2_000_000);
  assert.equal(limitDollars("$1,000,000"), 1_000_000);
  assert.equal(limitDollars("2000000"), 2_000_000);
  // Never inferred from size: a certificate's $1,000,000 is a million dollars.
  assert.equal(limitDollars(1_000_000), 1_000_000);
  assert.equal(limitDollars(""), null);
});

test("a shortfall says what the certificate carries", () => {
  const said = describeDiscrepancy({
    field: "requiredLimits.generalLiability",
    expected: "200000000",
    extracted: "1000000",
    severity: "blocking",
  });
  assert.equal(said.label, "General liability limit");
  assert.equal(
    said.detail,
    "The certificate carries $1,000,000. The venue requires $2,000,000.",
  );
});

test("a missing limit says so rather than showing an empty field", () => {
  const said = describeDiscrepancy({
    field: "requiredLimits.generalLiability",
    expected: "200000000",
    extracted: "",
    severity: "blocking",
  });
  assert.equal(
    said.detail,
    "The certificate doesn't state one. The venue requires $2,000,000.",
  );
});

test("the wrong holder reads like a sentence", () => {
  const said = describeDiscrepancy({
    field: "certificateHolder",
    expected: "Oak Hill Barn LLC",
    extracted: "Oakhill Barn Events Inc.",
    severity: "blocking",
  });
  assert.equal(said.label, "Certificate holder");
  assert.equal(
    said.detail,
    'The certificate says "Oakhill Barn Events Inc.". The venue asked for "Oak Hill Barn LLC".',
  );
});

test("field names a studio never chose still read as English", () => {
  assert.equal(fieldLabel("waiverOfSubrogation"), "Waiver of subrogation");
  assert.equal(fieldLabel("requiredLimits.umbrellaCover"), "Umbrella cover");
});

test("the extractor compares like with like", () => {
  const worker = readFileSync(`${process.cwd()}/functions/src/operations/ai-pdf.ts`, "utf8");
  assert.match(worker, /sameCalendarDate\(requirement\.get\("eventDate"\),extraction\.eventDate\)/);
  assert.match(worker, /limitDollars\(expected,true\)/);
  assert.match(worker, /limitDollars\(actualLimits\[key\]\)/);
});

test("features/ and functions/ read certificates identically", () => {
  assert.equal(
    readFileSync("functions/src/operations/certificate-review.ts", "utf8"),
    readFileSync("features/insurance/certificate-review.ts", "utf8")
      .replace(
        "Duplicated at functions/src/operations/certificate-review.ts, which the",
        "Duplicated from features/insurance/certificate-review.ts, used by the",
      )
      // The only other difference is how each side spells the same import.
      .replace('from "../format/calendar-date"', 'from "./calendar-date.js"'),
  );
});

/**
 * Discrepancies are frozen onto the request when the certificate is read, so
 * fixing the comparison does nothing for the ones already on file. Reading them
 * back through the same rules retires the ones that were never real.
 */
test("a stored date mismatch that was never real is retired", () => {
  assert.equal(
    stillDisagrees({
      field: "eventDate",
      expected: "2027-05-15",
      extracted: "15 May 2027",
      severity: "blocking",
    }),
    false,
  );
  assert.equal(
    stillDisagrees({
      field: "eventDate",
      expected: "2027-05-15",
      extracted: "16 May 2027",
      severity: "blocking",
    }),
    true,
  );
});

test("a stored limit shortfall stands, and a met limit does not", () => {
  const limit = (extracted: string) =>
    stillDisagrees({
      field: "requiredLimits.generalLiability",
      expected: "200000000",
      extracted,
      severity: "blocking",
    });
  assert.equal(limit("1000000"), true);
  assert.equal(limit("2000000"), false);
  assert.equal(limit("3000000"), false);
  assert.equal(limit(""), true);
});

test("everything else is left standing", () => {
  assert.equal(
    stillDisagrees({
      field: "certificateHolder",
      expected: "Oak Hill Barn LLC",
      extracted: "Oakhill Barn Events Inc.",
      severity: "blocking",
    }),
    true,
  );
});
