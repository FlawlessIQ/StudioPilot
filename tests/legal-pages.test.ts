import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LEGAL_ENTITY, PRIVACY_VERSION, TERMS_VERSION, CORE_SUBPROCESSORS } from "../features/legal/legal";
import * as functionsVersions from "../functions/src/legal/versions";
import { OPERATOR_FOOTER, renderEmailTemplate } from "../functions/src/communications/email-templates";
import { planCards } from "../config/saas-plans";

// The launch build plan §1.11: the legal pages are finished, the versions a
// studio is recorded as accepting are the ones on the page, the operator's
// address is the same everywhere, and pricing sells only what ships.

test("the Terms page is final: no draft wording, and it names the operator and the version", () => {
  const terms = readFileSync("app/terms/page.tsx", "utf8");
  assert.doesNotMatch(terms, /draft for legal review|require final legal review|pilot terms/i);
  assert.doesNotMatch(terms, /Docusign|Twilio/);
  assert.match(terms, /TERMS_VERSION/);
  assert.match(terms, /LEGAL_ENTITY/);
  for (const subject of ["Free trial", "Automatic renewal", "Cancelling", "Refunds", "Limitation of liability", "governed by the laws"]) {
    assert.match(terms, new RegExp(subject, "i"), subject);
  }
});

test("signup records the versions the pages show", () => {
  assert.equal(functionsVersions.TERMS_VERSION, TERMS_VERSION);
  assert.equal(functionsVersions.PRIVACY_VERSION, PRIVACY_VERSION);
  const record = functionsVersions.legalAcceptance("uid1", "2026-10-05T00:00:00.000Z");
  assert.equal(record.termsVersion, TERMS_VERSION);
  assert.match(readFileSync("functions/src/saas/onboarding.ts", "utf8"), /legalAcceptance\(identity\.uid, now\)/);
});

test("the email footer carries the operator's address, the same one the legal pages show", () => {
  assert.ok(OPERATOR_FOOTER.includes(LEGAL_ENTITY.name));
  assert.ok(OPERATOR_FOOTER.includes(LEGAL_ENTITY.addressOneLine));
  const brand = { studioName: "Alder & Muse", productName: "StudioCue", accentColor: "#35664a", logoUrl: null, contactEmail: null };
  const withoutAddress = renderEmailTemplate({ key: "proposal_sent", brand, recipientName: "Ana", projectName: null, values: {} });
  assert.ok(withoutAddress.text.includes(LEGAL_ENTITY.addressOneLine));
  const withAddress = renderEmailTemplate({
    key: "proposal_sent",
    brand: { ...brand, postalAddress: "12 Main St, Hoboken, NJ 07030" },
    recipientName: "Ana",
    projectName: null,
    values: {},
  });
  assert.ok(withAddress.text.includes("12 Main St, Hoboken, NJ 07030"));
  assert.ok(withAddress.html.includes("12 Main St, Hoboken, NJ 07030"));
});

test("the privacy policy and subprocessors page name the services that process data", () => {
  const privacy = readFileSync("app/privacy/page.tsx", "utf8");
  assert.match(privacy, /PRIVACY_VERSION/);
  assert.match(privacy, /do not sell personal information/i);
  assert.match(privacy, /Cookies and browser storage/);
  assert.match(privacy, /\/subprocessors/);
  for (const name of ["Google", "Stripe", "SendGrid", "Cloudflare"]) {
    assert.ok(CORE_SUBPROCESSORS.some((entry) => `${entry.name} ${entry.service}`.includes(name)), name);
  }
  assert.match(readFileSync("app/sitemap.ts", "utf8"), /\/subprocessors/);
});

test("pricing sells only what ships", () => {
  const bullets = planCards.flatMap((plan) => [...plan.features]).join(" | ");
  // Neither exists: entitlement-guard.ts says the public API "does not exist yet".
  assert.doesNotMatch(bullets, /API access|portfolio reporting|Advanced permissions/i);
});
