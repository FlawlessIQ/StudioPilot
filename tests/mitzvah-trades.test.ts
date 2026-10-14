import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { recommendedFor } from "@/features/questionnaires/recommended-templates";
import { planMitzvahNight } from "@/features/schedules/mitzvah-plan";
import { fillMcScript } from "@/features/schedules/mc-script";
import { djMomentsFor } from "@/features/schedules/night-plan";
import { parsePartyList } from "@/features/schedules/party-list";
import { checklistFor, checklistIsCustom } from "@/features/planning/planning-checklist";
import { mitzvahTermsBlocks } from "@/features/contracts/event-details";
import { resolveContractDocument } from "@/features/contracts/document";
import { sampleContractSources } from "@/features/contracts/sample";
import { journeyProfile, JOB_KINDS } from "@/features/job-kinds/job-kinds";

/**
 * A bar or bat mitzvah for every trade (docs/mitzvah-journey-plan-2026-10-14.md):
 * Phase 4, the DJ's, makeup artist's, hair stylist's and planner's own forms
 * and plans; Phase 5, the agreement's Schedule B.
 */

const WEDDING_WORDS = /\b(weddings?|couples?(?! of\b)|brides?|bridal|grooms?|bridesmaids?|ceremony|veil|marriage|officiant)\b/i;

test("every trade gets its own mitzvah form, and none of them reads like a wedding", () => {
  const own: Record<string, string[]> = {
    photographer: ["mitzvah-details", "mitzvah-final-schedule", "mitzvah-shot-list"],
    dj: ["mitzvah-music-planner"],
    makeup: ["mitzvah-makeup-party-list"],
    hair: ["mitzvah-hair-party-list"],
    planner: ["mitzvah-planner-final-details"],
  };
  for (const [trade, ids] of Object.entries(own)) {
    const forms = recommendedFor(trade, ["mitzvah"]);
    assert.deepEqual(forms.map((form) => form.id), ids, trade);
    for (const form of forms) {
      assert.equal(form.eventTypeId, "mitzvah", form.id);
      const match = WEDDING_WORDS.exec(JSON.stringify(form));
      assert.equal(match, null, `${form.id} says "${match?.[0]}"`);
    }
    // Signup is unchanged: a wedding's forms only.
    assert.ok(recommendedFor(trade).every((form) => form.eventTypeId === "wedding"), trade);
  }
  // The DJ's and the planner's read the party start the day plan anchors on.
  for (const id of ["mitzvah-music-planner", "mitzvah-planner-final-details"]) {
    const form = recommendedFor(id.includes("music") ? "dj" : "planner", ["mitzvah"])[0]!;
    const ids = form.sections.flatMap((section) => section.fields.map((field) => field.id));
    assert.ok(ids.includes("party-start-time") && ids.includes("party-location") && ids.includes("candle-lighting-list"), id);
  }
});

test("a DJ's mitzvah night: the party in order, each line with its song and announcement", () => {
  const answers = {
    "party-start-time": "18:00",
    "grand-entrance-song": "Can't Stop the Feeling",
    "entrance-names": "The Cohen family\nAnd our bar mitzvah, Sam!",
    "hora-songs": "Hava Nagila",
    "chair-lift": "Sam, then Rachel and David",
    blessings: "Grandpa Mel — the challah\nAunt Dana — the wine",
    "toast-order": "Rachel and David",
    "candle-lighting-list": "In memory — Grandpa Saul — 'Over the Rainbow'",
    "montage-file": "Dropbox link from Rachel, 6 minutes",
    "parent-dance-songs": "should never reach a mitzvah line",
  };
  const night = planMitzvahNight({ answers, coverageMinutes: 300 });
  const titles = night.rows.map((row) => row.title);
  assert.ok(!titles.some((title) => /arrive|portrait|service|kids' room/i.test(title)), titles.join(", "));
  assert.deepEqual(titles.slice(0, 6), ["Cocktail hour", "Grand entrance", "Hora", "Blessings over the challah and wine", "Parents' speech and toast", "Dinner"]);
  const { items } = fillMcScript(night.rows.map((row) => ({ title: row.title, mc: null })), answers);
  const mc = (title: string) => items.find((item) => item.title === title)?.mc;
  assert.equal(mc("Hora")?.song, "Hava Nagila");
  assert.equal(mc("Hora")?.announcement, "Sam, then Rachel and David");
  assert.match(String(mc("Blessings over the challah and wine")?.announcement), /Grandpa Mel/);
  // The parents' speech is the toast order, never the parent dances.
  assert.equal(mc("Parents' speech and toast")?.announcement, "Rachel and David");
  assert.equal(mc("Parents' speech and toast")?.song ?? null, null);
  assert.match(String(mc("Candle lighting")?.announcement), /Grandpa Saul/);
  assert.match(String(mc("Montage")?.announcement), /Dropbox/);
  assert.match(String(mc("Grand entrance")?.announcement), /bar mitzvah, Sam/);
  // Its "Add a moment" chips are the party's.
  assert.ok(djMomentsFor("mitzvah").some((moment) => moment.title === "Candle lighting"));
  assert.ok(!djMomentsFor("mitzvah").some((moment) => /bouquet|garter|first dance/i.test(moment.title)));
  assert.ok(djMomentsFor("wedding").some((moment) => moment.title === "First dance"));
});

test("a family's party list seats the mom, the grandmother and the child", () => {
  const people = parsePartyList(
    "Rachel Cohen — mom — makeup — lashes\nLily — the bat mitzvah — light makeup\nGrandma Ruth — grandmother — makeup",
    "makeup",
  );
  assert.deepEqual(people.map((person) => person.role), ["mother", "party", "mother"]);
});

test("a mitzvah planner's checklist: the synagogue, the candles, the montage — no license, no officiant", () => {
  const full = checklistFor(undefined, "full", "mitzvah");
  const keys = full.map((entry) => entry.key);
  for (const key of ["synagogue_date", "candle_lighting", "montage", "tallit_kippot"]) assert.ok(keys.includes(key), key);
  assert.ok(!keys.some((key) => /marriage|officiant/.test(key)));
  assert.ok(new Set(keys).size === keys.length, "keys are unique: the task id is built from them");
  // A studio's own wedding list stays the wedding's.
  const stored = { full: { items: [{ key: "x", title: "Their own", amount: 3, unit: "months" }] } };
  assert.deepEqual(checklistFor(stored, "full", "mitzvah").map((entry) => entry.key), keys);
  assert.deepEqual(checklistFor(stored, "full").map((entry) => entry.key), ["x"]);
  assert.equal(checklistIsCustom(stored, "full", "mitzvah"), false);
  // Its own mitzvah list wins for a mitzvah.
  const own = { "mitzvah:full": { items: [{ key: "y", title: "Mitzvah own", amount: 2, unit: "months" }] } };
  assert.deepEqual(checklistFor(own, "full", "mitzvah").map((entry) => entry.key), ["y"]);
  assert.equal(checklistIsCustom(own, "full", "mitzvah"), true);
  // The sync passes the job's kind.
  assert.match(readFileSync("functions/src/planning/planning-checklist-sync.ts", "utf8"), /checklistFor\(stored, scope, jobKindOf\(data\)\)/);
});

test("Schedule B: the congregation's rules and children, in each trade's words, on a mitzvah only", () => {
  assert.equal(journeyProfile("mitzvah").agreementTerms, "mitzvah");
  for (const kind of JOB_KINDS.filter((kind) => kind !== "mitzvah")) assert.equal(journeyProfile(kind).agreementTerms, null, kind);

  const text = (trade: string) => JSON.stringify(mitzvahTermsBlocks(trade));
  assert.match(text("photographer"), /cameras out of the service/);
  assert.match(text("photographer"), /will not use images of the honoree/);
  assert.match(text("dj"), /music, sound and announcements/);
  assert.match(text("makeup"), /parent or guardian present/);
  assert.match(text("planner"), /does not provide childcare/);

  const sources = sampleContractSources("Harbor Light Studio", "2026-10-14");
  const template = { title: "Agreement", body: "# Agreement\n\nThe fee is {{price.total}}.", customFields: [] };
  const headings = (blocks: ReadonlyArray<{ type: string }>) =>
    blocks.filter((block) => block.type === "heading").map((block) => (block as { content: Array<{ text: string }> }).content[0]!.text);
  const plain = resolveContractDocument({ template, sources, overrides: {} });
  const mitzvah = resolveContractDocument({ template, sources: { ...sources, kindTerms: mitzvahTermsBlocks("photographer") }, overrides: {} });
  assert.ok(!headings(plain.document.blocks).some((heading) => heading.startsWith("Schedule B")));
  assert.equal(headings(mitzvah.document.blocks).at(-1), "Schedule B — Bar and bat mitzvah terms");
  // Last, after Schedule A.
  assert.equal(headings(mitzvah.document.blocks).at(-2)?.startsWith("Schedule A"), true);

  const sourcesCode = readFileSync("functions/src/contracts/sources.ts", "utf8");
  assert.match(sourcesCode, /agreementTerms === "mitzvah"\s*\? \{ kindTerms: mitzvahTermsBlocks\(/);
});
