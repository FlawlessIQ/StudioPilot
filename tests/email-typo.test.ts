import assert from "node:assert/strict";
import { test } from "node:test";
import { suggestEmailFix } from "@/features/leads/email-typo";

test("Albert's gamil.com, and the other usual slips, get a suggestion", () => {
  assert.equal(suggestEmailFix("albertgersh20@gamil.com"), "albertgersh20@gmail.com");
  assert.equal(suggestEmailFix(" Albert@GMIAL.com "), "Albert@gmail.com");
  assert.equal(suggestEmailFix("a@gmail.con"), "a@gmail.com");
  assert.equal(suggestEmailFix("a@gmail.co"), "a@gmail.com");
  assert.equal(suggestEmailFix("a@yaho.com"), "a@yahoo.com");
  assert.equal(suggestEmailFix("a@hotmial.com"), "a@hotmail.com");
  assert.equal(suggestEmailFix("a@iclod.com"), "a@icloud.com");
  assert.equal(suggestEmailFix("a@outlok.com"), "a@outlook.com");
});

test("a right address, or a domain that is simply not a common one, is left alone", () => {
  for (const email of [
    "albertgersh20@gmail.com",
    "gabe_rhodes@grproductions.tv",
    "couple@flawlessiq.com",
    "someone@gmx.com",
    "someone@mail.com",
    "a@me.com",
    "a@ucla.edu",
    "not-an-email",
    "a@gmail",
    "",
  ]) {
    assert.equal(suggestEmailFix(email), null, email);
  }
});

test("a real provider next door to a popular one is never corrected into it", () => {
  for (const email of ["a@mail.com", "a@gmx.com", "a@aim.com", "a@hey.com", "a@proton.me"]) {
    assert.equal(suggestEmailFix(email), null, email);
  }
});
