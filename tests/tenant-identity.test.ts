import assert from "node:assert/strict";
import { test } from "node:test";
import {
  IDENTITY_SCOPE,
  normalizeSlug,
  slugChangeConsequence,
  slugProblem,
  SUPPORTED_CURRENCIES,
} from "@/features/tenants/identity";

test("a slug is tidied into something usable in a URL", () => {
  assert.equal(normalizeSlug("  FlawlessIQ Studio "), "flawlessiq-studio");
  assert.equal(normalizeSlug("Alder & Muse"), "alder-muse");
  assert.equal(normalizeSlug("--double--hyphen--"), "double-hyphen");
  assert.equal(normalizeSlug("Ada's Photos"), "ada-s-photos");
});

test("the accepted shape is one the inquiry page can look up", () => {
  // app/inquiry/page.tsx guards on /^[a-z0-9-]{2,80}$/ before querying, so a
  // slug this accepts must satisfy that too.
  const inquiryGuard = /^[a-z0-9-]{2,80}$/;
  for (const slug of ["flawlessiq", "alder-muse", "studio2026"]) {
    assert.equal(slugProblem(slug), null, slug);
    assert.ok(inquiryGuard.test(slug), `${slug} would be rejected by /inquiry`);
  }
});

test("the shapes that would embarrass a studio are refused", () => {
  assert.match(slugProblem("ab") ?? "", /three characters/);
  assert.match(slugProblem("-leading") ?? "", /hyphen/);
  assert.match(slugProblem("trailing-") ?? "", /hyphen/);
  assert.match(slugProblem("Has Capitals") ?? "", /lowercase/);
  assert.match(slugProblem("a".repeat(61)) ?? "", /sixty/);
  // The inquiry page special-cases this one for the demo studio.
  assert.match(slugProblem("demo-studio") ?? "", /reserved/);
});

test("changing the address promises that old links survive", () => {
  const message = slugChangeConsequence("flawlessiq-14313514", "flawlessiq");
  assert.match(message ?? "", /\/inquiry\?studio=flawlessiq/);
  assert.match(message ?? "", /keep working/);
  // Nothing to say when nothing changed.
  assert.equal(slugChangeConsequence("same", "same"), null);
});

test("every identity field says what it affects", () => {
  // A studio that cannot tell whether a change rewrites history will not make
  // the change.
  for (const [field, scope] of Object.entries(IDENTITY_SCOPE)) {
    assert.ok(scope.length > 25, `${field} needs a real sentence`);
  }
  // The three that could plausibly be feared as retroactive say plainly that
  // they are not.
  assert.match(IDENTITY_SCOPE.legalName, /already signed/);
  assert.match(IDENTITY_SCOPE.timezone, /already booked/);
  assert.match(IDENTITY_SCOPE.currency, /Existing prices/);
});

test("nothing is offered that the product does not read", () => {
  // `dateFormat` is written at signup and read nowhere, so offering a control
  // over it would be a setting that does nothing.
  assert.equal("dateFormat" in IDENTITY_SCOPE, false);
});

test("currencies are three-letter codes", () => {
  for (const code of SUPPORTED_CURRENCIES) {
    assert.match(code, /^[A-Z]{3}$/);
  }
});
