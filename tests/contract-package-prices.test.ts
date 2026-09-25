import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { resolveContractDocument } from "@/features/contracts/document";
import { sampleContractSources } from "@/features/contracts/sample";

/**
 * A studio selling photography and video sells two things, and its contract
 * says so: "Still Package Totals: $4,999   Video Package Total: $2,999
 * Retainer: $1,800". `price.total` is one number and cannot express that — it
 * was the last line of the reference studio's own agreement StudioCue could
 * not reproduce.
 */
const base = sampleContractSources("Hart Light Photography", "2026-09-25");

const resolve = (body: string, sources = base) =>
  resolveContractDocument({
    template: { title: "Booking agreement", body, customFields: [] },
    sources,
    overrides: {},
  });

test("each package is listed with its own total", () => {
  const list = resolve("{{price.packages}}").document.blocks.find(
    (block) => block.type === "list",
  ) as { items: { content: { text: string }[] }[] };
  assert.ok(list, "no list block rendered");
  assert.deepEqual(
    list.items.map((item) => item.content.map((part) => part.text).join("")),
    ["Signature Collection: $4,999.00", "Gold Cinematic Package: $2,999.00"],
  );
});

test("written mid-sentence it reads as one line", () => {
  const text = JSON.stringify(resolve("Totals — {{price.packages}}.").document.blocks);
  assert.match(text, /Signature Collection: \$4,999\.00; Gold Cinematic Package: \$2,999\.00/);
});

test("a single-package job still reads correctly", () => {
  const one = {
    ...base,
    packages: [{ name: "Signature Collection", totalCents: 499900 }],
  };
  const list = resolve("{{price.packages}}", one).document.blocks.find(
    (block) => block.type === "list",
  ) as { items: { content: { text: string }[] }[] };
  assert.equal(list.items.length, 1);
});

test("no packages reads as missing, not as an empty list", () => {
  const none = { ...base, packages: [] };
  const document = resolve("{{price.packages}}", none).document;
  assert.ok(!document.blocks.some((block) => block.type === "list"));
  assert.match(JSON.stringify(document.blocks), /\[price\.packages\]/);
});

test("the package name is emphasised and the money is not", () => {
  const list = resolve("{{price.packages}}").document.blocks.find(
    (block) => block.type === "list",
  ) as { items: { content: { text: string; bold?: true }[] }[] };
  const [name, money] = list.items[0]!.content;
  assert.equal(name!.bold, true);
  assert.equal(money!.bold, undefined);
});

const source = (path: string) => readFileSync(`${process.cwd()}/${path}`, "utf8");

/**
 * The pricing snapshot holds one combined total, so the per-package figures
 * have to come from the snapshots themselves — tenant-checked, primary first.
 */
test("the figures come from the snapshots, in the order sold", () => {
  const sources = source("functions/src/contracts/sources.ts");
  assert.match(sources, /additionalPackageSnapshotIds/);
  assert.match(sources, /document\.get\("tenantId"\) === input\.tenantId/);
  assert.match(sources, /packages,/);
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
