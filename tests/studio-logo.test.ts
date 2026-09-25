import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { LOGO_MAX_BYTES, checkLogoFile } from "@/lib/branding/logo-upload";

/**
 * Branding was a "Logo URL" field, which assumes the studio hosts images
 * somewhere and can paste a link to one. Most cannot, so most had no logo — and
 * it reached emails only: the proposal PDF printed the studio name as plain
 * text and the client portal showed nothing.
 */
test("a logo is checked before it is uploaded, not after it fails", () => {
  assert.deepEqual(checkLogoFile({ type: "image/png", size: 40_000 }), { ok: true });
  assert.deepEqual(checkLogoFile({ type: "image/svg+xml", size: 4_000 }), { ok: true });

  const wrongType = checkLogoFile({ type: "application/pdf", size: 1_000 });
  assert.equal(wrongType.ok, false);
  assert.match((wrongType as { reason: string }).reason, /PNG, JPEG, WebP or SVG/);

  const tooBig = checkLogoFile({ type: "image/png", size: LOGO_MAX_BYTES + 1 });
  assert.equal(tooBig.ok, false);
  assert.match((tooBig as { reason: string }).reason, /2 MB/);
});

const source = (path: string) => readFileSync(`${process.cwd()}/${path}`, "utf8");

/**
 * Overwriting one fixed object would leave every already-sent email and every
 * generated PDF pointing at the new image, so changing the logo would silently
 * rewrite history.
 */
test("each upload is its own object, so old documents keep their mark", () => {
  const upload = source("lib/branding/logo-upload.ts");
  assert.match(upload, /branding\/logo-\$\{Date\.now\(\)\}/);
});

test("the storage rule lets the world read a logo and only the studio write one", () => {
  const rules = source("storage.rules");
  const block = rules.slice(
    rules.indexOf("match /tenants/{tenantId}/branding/{fileName}"),
    rules.indexOf("match /tenants/{tenantId}/cueAttachments"),
  );
  // The PDF renderer and the portal both fetch it without a session.
  assert.match(block, /allow read: if true;/);
  assert.match(block, /membership\(tenantId\)\.role in \["studio_owner", "studio_admin"\]/);
  // A logo, not a gallery.
  assert.match(block, /request\.resource\.size < 2 \* 1024 \* 1024/);
  assert.match(block, /image\/png\|image\/jpeg\|image\/webp/);
});

test("the proposal carries the logo, and survives one that will not load", () => {
  const pdf = source("cloud-run/pdf/main.py");
  assert.match(pdf, /logo_url: str = Field\(default="", max_length=2000\)/);
  assert.match(pdf, /def _brand_cell\(data, styles\):/);
  // A logo that will not fetch must not take the proposal down with it.
  assert.match(pdf, /except Exception:\s*\n\s*return name_cell/);
  // And the header uses it.
  assert.match(pdf, /_brand_cell\(data, styles\)/);

  const builder = source("functions/src/operations/ai-pdf.ts");
  assert.match(builder, /logo_url:/);
});
