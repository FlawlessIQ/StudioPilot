import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { resolveContractDocument } from "@/features/contracts/document";
import { sampleContractSources } from "@/features/contracts/sample";

/**
 * Every studio agreement opens the same way: a mark on the left and the
 * business's address, phone and email beside it. StudioCue held a brand name
 * and nothing else, so a contract printed the name alone and looked like
 * StudioCue's document rather than the studio's own.
 *
 * "So i think everyone can upload a logo. Address goes in header. They upload
 * their agreement." — which is the whole model: we supply the frame and the
 * fields, the studio supplies the words.
 */
const base = sampleContractSources("Hart Light Photography", "2026-09-25");

test("a studio can place its own details anywhere in its wording", () => {
  const resolved = resolveContractDocument({
    template: {
      title: "Booking agreement",
      body: "Jobs outside a 25 mile radius of {{studio.address}} may incur travel. Questions to {{studio.phone}} or {{studio.email}}.",
      customFields: [],
    },
    sources: base,
    overrides: {},
  });
  const text = JSON.stringify(resolved.document.blocks);
  assert.match(text, /2 Green Village Rd/);
  assert.match(text, /201\.320\.4296/);
  assert.match(text, /info@example\.com/);
});

test("an unset detail reads as missing rather than printing a gap", () => {
  const resolved = resolveContractDocument({
    template: { title: "T", body: "Call {{studio.phone}}.", customFields: [] },
    sources: { ...base, studio: { ...base.studio, phone: null } },
    overrides: {},
  });
  assert.match(JSON.stringify(resolved.document.blocks), /\[studio\.phone\]/);
});

const source = (path: string) => readFileSync(`${process.cwd()}/${path}`, "utf8");

test("the letterhead is stored once, with the rest of the branding", () => {
  const branding = source("functions/src/saas/branding.ts");
  for (const field of ["postalAddress", "phone", "websiteUrl"]) {
    assert.ok(branding.includes(`${field}:`), `${field} missing from the command`);
  }
  // And the studio can actually enter them.
  const settings = source("components/settings/email-branding.tsx");
  assert.match(settings, /Business address/);
  assert.match(settings, /update\("postalAddress"/);
});

/**
 * A letterhead that will not fetch must not take a signed contract down with
 * it, and a studio that has set none still gets its name.
 */
test("the contract renders a letterhead, and survives one that fails", () => {
  const pdf = source("cloud-run/pdf/contract.py");
  assert.match(pdf, /def _letterhead\(data, brand, small\):/);
  assert.match(pdf, /logo_url: str = Field\(default="", max_length=2000\)/);
  assert.match(pdf, /studio_address: str = Field\(default="", max_length=240\)/);
  assert.match(pdf, /except Exception:\s*\n\s*pass/);
  // No contact details at all still yields the wordmark.
  assert.match(pdf, /if not contact:\s*\n\s*return mark/);
});

test("the sealed contract carries the letterhead to the renderer", () => {
  const seal = source("functions/src/contracts/seal.ts");
  assert.match(seal, /logo_url: branding\.logoUrl \?\? ""/);
  assert.match(seal, /studio_address: branding\.postalAddress \?\? ""/);
});

test("the functions copy of the contract document still matches features/", () => {
  const body = (path: string) => {
    const text = source(path);
    return text.slice(text.indexOf("export const contractMergeFields = ["));
  };
  assert.equal(
    body("functions/src/contracts/document.ts"),
    body("features/contracts/document.ts"),
  );
});
