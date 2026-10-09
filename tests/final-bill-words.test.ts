import assert from "node:assert/strict";
import test from "node:test";
import { finalBillWords } from "../features/billing/final-bill-words";

test("a final checked first never claims it is going to the couple", () => {
  const words = finalBillWords({ checkedFirst: true, amount: "$5,798.00", recipient: "Conor Lawless" });
  assert.equal(words.confirmLabel, "Make the $5,798.00 bill");
  assert.match(words.body, /Nothing goes to Conor Lawless until you check the tax/);
  assert.match(words.done, /Nothing has gone to Conor Lawless yet/);
  for (const text of [words.body, words.done]) assert.doesNotMatch(text, /by email|can be voided, not unsent/);
});

test("a final that goes straight out says so", () => {
  const words = finalBillWords({ checkedFirst: false, amount: "$1,898.00", recipient: null });
  assert.equal(words.confirmLabel, "Send the $1,898.00 bill");
  assert.match(words.body, /goes to the couple by email/);
});
