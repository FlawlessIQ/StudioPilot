import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  EMBED_GUIDES,
  EMBED_MESSAGE_TYPE,
  buttonSnippet,
  embedSnippet,
  embedUrl,
  inquiryUrl,
} from "../features/intake/website-embed";

/**
 * H10 (2026-09-30): the inquiry form on a studio's own website. Gabe asked
 * for "a html code we can cut and paste" after every forwarding route failed
 * him.
 */

const origin = "https://studio-cue.com/";
const slug = "gr-productions-4d7765f6";

test("the form's addresses are the studio's slug on our origin", () => {
  assert.equal(inquiryUrl(origin, slug), "https://studio-cue.com/inquiry?studio=gr-productions-4d7765f6");
  assert.equal(embedUrl(origin, slug), "https://studio-cue.com/inquiry?studio=gr-productions-4d7765f6&embed=1");
});

test("the embed code frames the form and only listens to it", () => {
  const code = embedSnippet({ origin, slug, studioName: 'GR "Productions" & Co' });
  assert.match(code, /<iframe id="studiocue-inquiry-gr-productions-4d7765f6"/);
  assert.match(code, /src="https:\/\/studio-cue\.com\/inquiry\?studio=gr-productions-4d7765f6&amp;embed=1"/);
  // The studio's name can't break out of the attribute.
  assert.match(code, /title="Inquire with GR &quot;Productions&quot; &amp; Co"/);
  // The page resizes only on messages from our origin, of our type, from this frame.
  assert.match(code, /event\.origin !== "https:\/\/studio-cue\.com"/);
  assert.ok(code.includes(`event.data.type !== "${EMBED_MESSAGE_TYPE}"`));
  assert.match(code, /event\.source !== frame\.contentWindow/);
});

test("the button opens the form in a new tab, readable on the studio's colour", () => {
  const dark = buttonSnippet({ origin, slug, color: "#1f3d33" });
  assert.match(dark, /href="https:\/\/studio-cue\.com\/inquiry\?studio=gr-productions-4d7765f6"/);
  assert.match(dark, /target="_blank" rel="noopener"/);
  assert.match(dark, /color:#ffffff/);
  assert.match(buttonSnippet({ origin, slug, color: "#f4e04d" }), /color:#1a1a1a/, "dark text on a light colour");
  assert.match(buttonSnippet({ origin, slug, color: "not-a-colour" }), /background:#1f3d33/, "a bad colour falls back");
  assert.match(buttonSnippet({ origin, slug, label: "<b>x</b>" }), /&lt;b&gt;x&lt;\/b&gt;/);
});

test("every builder has steps, names its buttons, and Wix pastes an address", () => {
  for (const guide of EMBED_GUIDES) {
    assert.ok(guide.steps.length >= 3, guide.label);
    assert.ok(guide.steps.every((step) => /\*\*[^*]+\*\*/.test(step)), `${guide.label} names its buttons`);
  }
  assert.equal(EMBED_GUIDES.find((guide) => guide.key === "wix")?.paste, "url");
});

test("the embedded form reports its height and drops its studio bar", () => {
  const form = readFileSync("components/crm/lead-intake-form.tsx", "utf8");
  assert.match(form, /useEmbedFrame\(embedded, frameRef/);
  assert.match(form, /embedded \? null : <AppBar/);
  const page = readFileSync("app/inquiry/page.tsx", "utf8");
  assert.match(page, /embedded=\{embed === "1"\}/);
  // The link preview is the studio's, never the site-wide StudioCue card.
  assert.match(page, /openGraph: \{ type: "website", siteName: tenant\.name/);
});
