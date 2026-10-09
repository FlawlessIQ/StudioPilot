import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { renderEmailTemplate } from "../functions/src/communications/email-templates";
import { resolveAddOnLines, snapshotAddOnLines } from "../functions/src/packages/add-on-lines";

/**
 * What the end-to-end UAT's emulator round (wave 1, 2026-10-09) found, each
 * held here: scripts/uat/vendor-journeys-walk.mts walks the journeys that
 * found them.
 */

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const brand = { studioName: "Glow by Ana", productName: "StudioCue", accentColor: "#35664a", logoUrl: null, contactEmail: null };

test("an extra chosen as the package is locked keeps what it is priced per", () => {
  // selectPackage built the snapshot line without it, so the quote read "5 × $120".
  assert.match(read("functions/src/crm/commands.ts"), /taxable: addOn\.taxable,\s*\/\/ "5 people × \$120" on the quote \(packages\/unit-label\.ts\)\.\s*unitLabel: normalizeUnitLabel\(addOn\.unitLabel\),/);
});

test("a booking change keeps the unit on every extra: agreed, from the library, or read back", () => {
  const agreed = snapshotAddOnLines({ addOns: [{ addOnId: "a1", name: "Bridesmaid hair", quantity: 4, unitPriceCents: 9500, taxable: false, unitLabel: "person" }] });
  assert.equal(agreed[0]!.unitLabel, "person");
  const changed = resolveAddOnLines([{ addOnId: "a1", quantity: 6 }, { addOnId: "lib", quantity: 2 }, { addOnId: null, name: "Travel", unitPriceCents: 5000, quantity: 1 }], {
    agreed,
    suggested: [],
    library: new Map([["lib", { id: "lib", name: "Touch-up stay", unitPriceCents: 8000, taxable: true, unitLabel: "Hour" }]]),
    newCustomId: () => "custom_1",
  });
  assert.deepEqual(changed.map((line) => [line.name, line.quantity, line.unitLabel]), [
    ["Bridesmaid hair", 6, "person"],
    ["Touch-up stay", 2, "hour"],
    ["Travel", 1, null],
  ]);
});

test("a crew offer names the studio's own trade in the sentence, and a role id reads as its label", () => {
  const offer = (trade: string | undefined, role: string) =>
    renderEmailTemplate({ key: "crew_invitation", brand, recipientName: "Leah", values: { trade, role, actionUrl: "https://studio-cue.com/auth/crew-invite?token=x" } });
  const makeup = offer("makeup", "makeup_artist");
  assert.match(makeup.text, /We'd like you to review a makeup assignment/);
  assert.match(makeup.text, /Role: Makeup artist/);
  assert.equal(makeup.subject, "Makeup artist — Makeup assignment from Glow by Ana");
  assert.doesNotMatch(makeup.text.replace(/https?:\/\/\S+/g, ""), /photo/i);
  assert.match(offer("dj", "DJ").text, /a DJ assignment/);
  assert.match(offer("hair", "Second stylist").text, /a hair assignment/);
  // A photographer's and a videographer's read as they did.
  assert.match(offer(undefined, "Second photographer").text, /a photography assignment/);
  assert.match(offer("photographer", "Lead videographer").text, /a video assignment/);
});

test("the final details email speaks each trade's day and call", () => {
  const values = (trade: string | undefined) => ({ trade, eventKind: "wedding", finalCallUrl: "https://studio-cue.com/schedule/consultation?token=x", portalUrl: "https://studio-cue.com/client?final-details=1" });
  const render = (trade: string | undefined) => renderEmailTemplate({ key: "final_details_request", brand, recipientName: "Maya", values: values(trade) });
  const words = (text: string) => text.replace(/https?:\/\/\S+/g, "");
  const dj = render("dj");
  assert.match(dj.text, /your night/);
  assert.match(dj.text, /Music & moments planner/);
  assert.match(dj.text, /Book your final planning call/);
  assert.doesNotMatch(words(dj.text), /photo|ceremony and reception/i);
  for (const trade of ["makeup", "hair"]) {
    const beauty = render(trade);
    assert.match(beauty.text, /your morning/);
    assert.match(beauty.text, /people can be added but not taken off/);
    assert.doesNotMatch(words(beauty.text), /photo/i);
  }
  // A photographer's wedding keeps its words.
  const photo = render(undefined);
  assert.match(photo.text, /the ceremony and reception, any photo stops, and the timeline/);
  assert.match(photo.text, /Book your final details call/);
});

test("the vendor journeys walk is in the UAT harness", () => {
  const walk = read("scripts/uat/vendor-journeys-walk.mts");
  for (const journey of ["J3 makeup", "J4 hair", "J2 DJ", "J9 new studio"]) assert.match(walk, new RegExp(`journey = "${journey}"`), journey);
});
