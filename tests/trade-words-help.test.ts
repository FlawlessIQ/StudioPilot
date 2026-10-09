import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { EXPLAINERS, explainer, explainersFor } from "@/features/help/explainers";
import { GLOSSARY, glossaryFor, glossaryTerm } from "@/features/help/glossary";
import { boldLabels, plainText } from "@/features/help/rich-text";
import { helpForRoute } from "@/features/help/routes";
import type { Explainer, HelpAudience, HelpTerm } from "@/features/help/types";
import { helpVideoIds, videoSuitsTrade } from "@/features/help/videos";
import manifest from "@/features/help/video-manifest.json";

/**
 * The help a DJ, a makeup artist or a hair stylist reads — the How-to guides,
 * the glossary behind every ⓘ, the Help page — is in their own words
 * (features/trades/trades.ts), and a photographer's reads exactly as before.
 * A guide about something a trade doesn't have (a gallery) is never offered
 * to it, and neither is a video whose narration says so.
 */

const VENDORS = ["dj", "makeup", "hair"] as const;
const AUDIENCES: HelpAudience[] = ["studio", "couple", "crew"];

const PHOTO_WORDS =
  /\b(photos?|photograph\w*|galler(?:y|ies)|shoots?|shooting|shot lists?|albums?|coverage|deliverables?|second shooters?|sneak peeks?|images?|retouching)\b/i;
/**
 * "Take a photo" is the crew's button for photographing a W-9 with the
 * phone's camera (crew-day), not photography; the guide names the button as
 * the screen does.
 */
const NOT_PHOTOGRAPHY = /\*\*Take a photo\*\*/g;

const guideText = (guide: Explainer) =>
  [guide.title, guide.summary, guide.purpose, ...guide.steps, guide.next ?? "", ...(guide.goodToKnow ?? [])];
const termText = (term: HelpTerm) => [term.term, term.hint];

function walk(dir: string, match: (file: string) => boolean, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, match, out);
    else if (match(full)) out.push(full);
  }
  return out;
}

/** As tests/help-content.test.ts reads it: entities decoded, apostrophes one shape. */
const normalise = (text: string) =>
  text
    .replace(/&amp;/g, "&")
    .replace(/&apos;|&rsquo;|&#39;|’/g, "'")
    .replace(/&ldquo;|&rdquo;|“|”/g, '"')
    .replace(/&mdash;/g, "—");

const PRODUCT_SOURCE = normalise(
  [
    ...walk("components", (file) => /\.tsx?$/.test(file)),
    ...walk("app", (file) => /\.tsx?$/.test(file)),
    ...walk("features", (file) => /\.tsx?$/.test(file) && !file.startsWith(path.join("features", "help"))),
  ]
    .map((file) => readFileSync(file, "utf8"))
    .join("\n"),
);

test("a photographer's help reads exactly as it did", () => {
  assert.deepEqual(explainersFor("photographer"), EXPLAINERS);
  assert.deepEqual(explainersFor(undefined), EXPLAINERS);
  for (const term of GLOSSARY) assert.deepEqual(glossaryTerm(term.id), term);
  // A few lines that only read right for a photographer, pinned.
  assert.equal(explainer("crew-offer")?.title, "Book your second shooter");
  assert.equal(explainer("consultation")?.title, "Book a consultation");
  assert.equal(explainer("proposal")?.title, "Build and send a proposal");
  assert.equal(
    explainer("couple-tour")?.purpose,
    "This is your portal. Everything between booking and your photos happens here, and your photographer sees what you do right away.",
  );
  assert.equal(explainer("final-balance")?.next, "The client gets the invoice by email and pays online. It's due 14 days before the event.");
  assert.equal(
    glossaryTerm("coverage", "photographer")?.hint,
    "Who you send and for how long: photographers, videographers and hours. It fills your contract and can set a per-crew retainer.",
  );
  for (const id of ["delivery", "crew-offer", "setup", "coi"])
    assert.equal(explainer(id, "photographer")?.video, id, `${id} keeps its video`);
});

for (const trade of VENDORS) {
  test(`a ${trade} studio, its clients and its crew read no photographer words`, () => {
    const hits: string[] = [];
    for (const guide of explainersFor(trade))
      for (const text of guideText(guide))
        if (PHOTO_WORDS.test(text.replace(NOT_PHOTOGRAPHY, ""))) hits.push(`${guide.id}: ${text}`);
    for (const audience of AUDIENCES)
      for (const term of glossaryFor(audience, trade))
        for (const text of termText(term)) if (PHOTO_WORDS.test(text)) hits.push(`term ${term.id}: ${text}`);
    assert.deepEqual(hits, []);
  });

  test(`a ${trade} studio is never told about a consultation, and reads its own offer`, () => {
    const words = (trade === "dj" ? /\bconsult\w*/i : /\b(consult\w*|proposals?)\b/i);
    const hits: string[] = [];
    for (const guide of explainersFor(trade))
      for (const text of guideText(guide)) if (words.test(text)) hits.push(`${guide.id}: ${text}`);
    for (const audience of AUDIENCES)
      for (const term of glossaryFor(audience, trade))
        for (const text of termText(term)) if (words.test(text)) hits.push(`term ${term.id}: ${text}`);
    assert.deepEqual(hits, []);
  });

  test(`a ${trade} studio isn't offered the guides for what it doesn't have`, () => {
    for (const id of ["delivery", "reviews", "couple-photos"]) assert.equal(explainer(id, trade), undefined, id);
    assert.equal(helpForRoute("/studio/delivery", "studio", trade).primary.id, "tour");
    assert.equal(helpForRoute("/client/delivery", "couple", trade).primary.id, "couple-tour");
    for (const audience of AUDIENCES) {
      const help = helpForRoute(`/${audience === "couple" ? "client" : audience}`, audience, trade);
      for (const guide of [help.primary, ...help.related]) assert.ok(explainer(guide.id, trade), guide.id);
    }
    // Every guide that applies to everyone is still there, in their words.
    const ids = new Set(explainersFor(trade).map((guide) => guide.id));
    for (const guide of EXPLAINERS)
      if (!["delivery", "reviews", "couple-photos"].includes(guide.id)) assert.ok(ids.has(guide.id), guide.id);
  });

  test(`a ${trade} studio's guides are guides, name real buttons and real words`, () => {
    for (const guide of explainersFor(trade)) {
      const words = guideText(guide).slice(2).map(plainText).join(" ").split(/\s+/).length;
      assert.ok(words >= 80 && words <= 260, `${guide.id}: ${words} words`);
      assert.ok(guide.steps.length >= 3 && guide.steps.length <= 7, `${guide.id}: ${guide.steps.length} steps`);
      assert.ok((guide.goodToKnow ?? []).length <= 3, `${guide.id}: notes`);
      for (const text of guideText(guide))
        for (const label of boldLabels(text))
          assert.ok(PRODUCT_SOURCE.includes(normalise(label)), `${guide.id}: **${label}** is on no screen`);
      for (const id of guide.terms ?? []) assert.ok(glossaryTerm(id, trade), `${guide.id} → ${id}`);
      if (guide.audience !== "studio") assert.doesNotMatch(JSON.stringify(guide), /\bCue\b/, guide.id);
    }
    for (const audience of AUDIENCES)
      for (const term of glossaryFor(audience, trade))
        assert.ok(term.hint.split(/\s+/).length <= 30, `${term.id}: hint too long`);
  });

  test(`a ${trade} studio is shown only videos whose narration is right for it`, () => {
    const transcripts = manifest as Record<string, { transcript?: string }>;
    for (const guide of explainersFor(trade))
      if (guide.video) {
        assert.ok(videoSuitsTrade(guide.video, trade));
        assert.doesNotMatch(transcripts[guide.video]?.transcript ?? "", PHOTO_WORDS, guide.video);
      }
    for (const id of ["crew-offer", "setup", "coi", "job-page"]) assert.equal(explainer(id, trade)?.video, undefined, id);
    // A neutral recording still plays.
    if (helpVideoIds().includes("inquiry-capture")) assert.equal(explainer("inquiry-capture", trade)?.video, "inquiry-capture");
  });
}

test("each trade reads its own words", () => {
  assert.equal(explainer("crew-offer", "dj")?.title, "Book another DJ");
  assert.equal(explainer("crew-offer", "hair")?.title, "Book another stylist");
  assert.equal(explainer("consultation", "dj")?.title, "Book a vibe call");
  assert.equal(explainer("consultation", "makeup")?.title, "Book a makeup trial");
  assert.equal(explainer("consultation", "hair")?.title, "Book a hair trial");
  assert.equal(explainer("proposal", "makeup")?.title, "Build and send a quote");
  assert.equal(explainer("proposal", "dj")?.title, "Build and send a proposal");
  assert.equal(explainer("couple-questionnaire", "dj")?.title, "Fill out your Music & moments planner");
  assert.equal(explainer("couple-questionnaire", "hair")?.title, "Fill out your Party list");
  assert.match(explainer("couple-tour", "makeup")!.purpose, /your makeup artist sees what you do/);
  assert.match(explainer("final-balance", "hair")!.next!, /due the morning of the event/);
  assert.match(explainer("job-page", "dj")!.steps.join(" "), /\*\*Afterwards\*\*/);
  assert.doesNotMatch(explainer("job-page", "dj")!.steps.join(" "), /\*\*Delivery\*\*/);
  // A DJ still books a call before the proposal; a makeup artist doesn't.
  assert.match(explainer("inquiry", "dj")!.steps.join(" "), /pick a vibe call time/);
  assert.doesNotMatch(explainer("inquiry", "makeup")!.steps.join(" "), /pick a/);
  assert.ok(explainer("inquiry", "dj")!.terms!.includes("vibe-call"));
  assert.ok(explainer("proposal", "hair")!.terms!.includes("beauty-quote"));
  assert.ok(!explainer("proposal", "hair")!.terms!.includes("proposal"));
  // The glossary, likewise.
  assert.equal(glossaryTerm("coverage", "dj")?.term, "Service");
  assert.match(glossaryTerm("crew-offer", "makeup")!.hint, /^An invitation to an artist to work a date/);
  assert.match(glossaryTerm("crew-offer", "dj")!.hint, /^An invitation to a DJ to work a date/);
  assert.match(glossaryTerm("studio-roles", "dj")!.hint, /Staff DJ: sees the jobs they play/);
  assert.equal(glossaryTerm("consultation", "dj"), undefined);
  assert.equal(glossaryTerm("proposal", "hair"), undefined);
  assert.ok(glossaryTerm("proposal", "dj"));
});

test("the help screens ask the workspace for the trade", () => {
  const howTo = readFileSync("components/help/how-to.tsx", "utf8");
  assert.match(howTo, /helpForRoute\(pathname, audience, trade\)/);
  // A "Learn more" to a guide the trade doesn't get opens the screen's own.
  assert.match(howTo, /explainer\(openId, trade\) \?\? help\.primary/);
  assert.match(howTo, /<ExplainerView guide=\{guide\} trade=\{trade\} \/>/);
  const library = readFileSync("components/help/guide-library.tsx", "utf8");
  assert.match(library, /explainersFor\(useWorkspace\(\)\.tenantTrade\)/);
  assert.match(library, /explainer\(term\.explainer, trade\)/);
  const center = readFileSync("components/help/help-center.tsx", "utf8");
  assert.match(center, /trade\.has\.family === "photo" \? "a second shooter" : `another \$\{trade\.words\.member\}`/);
  assert.match(center, /concepts\(trade\)/);
});
