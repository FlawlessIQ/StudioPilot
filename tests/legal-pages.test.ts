import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { LEGAL_ENTITY, PRIVACY_VERSION, TERMS_VERSION, CORE_SUBPROCESSORS } from "../features/legal/legal";
import { LEGAL_DOCUMENTS, legalDocument } from "../features/legal/registry";
import type { LegalDocument } from "../features/legal/document-types";
import { currentEsignConsent } from "../features/contracts/esign-consent";
import * as functionsVersions from "../functions/src/legal/versions";
import { OPERATOR_FOOTER, renderEmailTemplate } from "../functions/src/communications/email-templates";
import { planCards } from "../config/saas-plans";

// StudioCue's legal documents: complete, final, internally consistent, and
// matching what the product actually does.

function allText(document: LegalDocument): string {
  const parts: string[] = [document.title, document.description, ...document.intro];
  for (const section of document.sections) {
    parts.push(section.title);
    for (const block of section.blocks) {
      if ("p" in block) parts.push(block.p);
      else if ("h3" in block) parts.push(block.h3);
      else if ("note" in block) parts.push(block.note);
      else if ("list" in block) parts.push(...block.list);
      else if ("ordered" in block) parts.push(...block.ordered);
      else parts.push(...block.table.head, ...block.table.rows.flat());
    }
  }
  return parts.join("\n");
}

test("every document reads as final: no draft, pilot or provisional wording", () => {
  for (const document of LEGAL_DOCUMENTS) {
    assert.doesNotMatch(allText(document), /draft for legal|draft terms|terms framework|\bpilot\b|temporar|interim|placeholder|\bTBD\b|lorem|counsel review|legal review/i, document.slug);
  }
});

test("every internal link in the documents goes to a page that exists", () => {
  const routes = new Set(["/pricing", "/legal", ...LEGAL_DOCUMENTS.map((entry) => entry.path)]);
  for (const document of LEGAL_DOCUMENTS) {
    for (const match of allText(document).matchAll(/\]\((\/[^)#?]*)/g)) {
      assert.ok(routes.has(match[1]!), `${document.slug} links to ${match[1]}`);
    }
    const page = document.path === "/legal" ? "app/legal/page.tsx" : `app${document.path}/page.tsx`;
    assert.ok(existsSync(page), `${document.path} has a page`);
  }
});

test("the Terms cover what a subscription agreement must", () => {
  const terms = allText(legalDocument("terms"));
  for (const subject of [
    "Free trial", "Automatic renewal", "How to cancel", "14-day refund", "Price changes", "Grace period", "Read-only access",
    "Data protection", "Electronic signatures", "AI features", "Limitation of liability", "Indemnification",
    "laws of the State of New Jersey", "Morris County", "Waiver of jury trial", "No class actions", "Export period",
  ]) assert.match(terms, new RegExp(subject, "i"), subject);
  assert.ok(terms.includes(LEGAL_ENTITY.name) && terms.includes(LEGAL_ENTITY.addressOneLine));
  assert.doesNotMatch(terms, /Docusign|Twilio SMS/);
});

test("the privacy policy keeps the Google Limited Use and Calendar disclosures verification relied on", () => {
  const privacy = allText(legalDocument("privacy"));
  assert.match(privacy, /adheres to the \[Google API Services User Data Policy\]/);
  assert.match(privacy, /calendar\.freebusy/);
  assert.match(privacy, /calendar\.events\.owned/);
  assert.match(privacy, /do not sell personal information/i);
  assert.match(privacy, /Global Privacy Control/);
  assert.match(privacy, /California/);
});

test("the e-signature page publishes exactly what signers accept", () => {
  const esign = allText(legalDocument("esign"));
  assert.ok(esign.includes(currentEsignConsent.label));
  for (const paragraph of currentEsignConsent.disclosure) {
    const words = paragraph.split(". ").slice(1).join(". ") || paragraph;
    assert.ok(esign.includes(words), paragraph.slice(0, 40));
  }
});

test("the DPA commits to the breach window and the subprocessor notice the Terms promise", () => {
  const dpa = allText(legalDocument("dpa"));
  assert.match(dpa, /within 72 hours/);
  assert.match(dpa, /at least 15 days before/);
  assert.match(dpa, /use Client Data to train/);
  assert.match(allText(legalDocument("subprocessors")), /reCAPTCHA/);
});

test("signup records the versions the pages show", () => {
  assert.equal(functionsVersions.TERMS_VERSION, TERMS_VERSION);
  assert.equal(functionsVersions.PRIVACY_VERSION, PRIVACY_VERSION);
  assert.equal(legalDocument("terms").version, TERMS_VERSION);
  assert.equal(legalDocument("privacy").version, PRIVACY_VERSION);
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
  assert.ok(withAddress.html.includes("12 Main St, Hoboken, NJ 07030"));
});

test("the subprocessor list names the core providers and the sitemap lists every document", () => {
  for (const provider of ["Google", "Stripe", "SendGrid", "Cloudflare"]) {
    assert.ok(CORE_SUBPROCESSORS.some((entry) => `${entry.name} ${entry.service}`.includes(provider)), provider);
  }
  const sitemap = readFileSync("app/sitemap.ts", "utf8");
  for (const document of LEGAL_DOCUMENTS) assert.ok(sitemap.includes(`"${document.path}"`), document.path);
});

test("pricing sells only what ships", () => {
  const bullets = planCards.flatMap((plan) => [...plan.features]).join(" | ");
  assert.doesNotMatch(bullets, /API access|portfolio reporting|Advanced permissions/i);
});
