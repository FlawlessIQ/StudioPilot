import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { logoUrlProblem } from "../features/branding/logo-url";
import { resolveTenantBrand, safeLogoUrl } from "../features/branding/tenant-brand";

/**
 * 2026-09-30: GR Productions' logo was a Dropbox preview page behind
 * Dropbox's sign-in — broken on its inquiry form, emails, proposals, portal
 * and link preview, and nothing had said so.
 */

const gabe = "https://www.dropbox.com/preview/Gabriel%20Rhodes/GR%20Productions%20Logo/GRP%20LOGO%20BLACK.png?role=work";

test("a storage page is named as a page, and the upload offered instead", () => {
  assert.match(logoUrlProblem(gabe) ?? "", /Dropbox page, not the image itself.*Upload the file/);
  for (const [link, service] of [
    ["https://www.dropbox.com/s/abc123/logo.png?dl=0", "Dropbox"],
    ["https://drive.google.com/file/d/1abc/view?usp=sharing", "Google Drive"],
    ["https://photos.app.goo.gl/xyz", "Google Photos"],
    ["https://www.icloud.com/photos/#0abc", "iCloud"],
    ["https://1drv.ms/i/s!abc", "OneDrive"],
    ["https://www.canva.com/design/DAF/view", "Canva"],
  ] as const) {
    assert.match(logoUrlProblem(link) ?? "", new RegExp(`${service} page`), link);
  }
  assert.match(logoUrlProblem("http://example.com/logo.png") ?? "", /https:\/\//);
  assert.match(logoUrlProblem("logo.png") ?? "", /isn't a web address/);
});

test("real image links, and the upload's own, pass", () => {
  for (const link of [
    "",
    "https://firebasestorage.googleapis.com/v0/b/studiohub-prod/o/tenants%2Fx%2Fbranding%2Flogo-1.png?alt=media&token=t",
    "https://grproductions.tv/logo.png",
    "https://www.dropbox.com/scl/fi/abc/logo.png?rlkey=k&raw=1",
  ]) {
    assert.equal(logoUrlProblem(link), null, link);
  }
});

test("a page link never reaches a surface: the studio's initial shows instead", () => {
  assert.equal(safeLogoUrl(gabe), null);
  assert.equal(resolveTenantBrand({ emailBranding: { logoUrl: gabe } }).logoUrl, null);
  const hosted = "https://grproductions.tv/logo.png";
  assert.equal(resolveTenantBrand({ emailBranding: { logoUrl: hosted } }).logoUrl, hosted);
});

test("choosing a file uploads and saves it, with no second step", () => {
  const form = readFileSync("components/settings/email-branding.tsx", "utf8");
  const upload = form.slice(form.indexOf("async function uploadLogo"), form.indexOf("async function save("));
  assert.match(upload, /await persist\(\s*next,/);
  assert.doesNotMatch(form, /Save to apply it/);
  // Save refuses a page link rather than storing it.
  const save = form.slice(form.indexOf("async function save("), form.indexOf("async function persist("));
  assert.match(save, /if \(logoProblem\)/);
});
