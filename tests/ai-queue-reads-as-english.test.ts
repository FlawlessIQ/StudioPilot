import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * The review queue is where a studio decides whether to approve AI work, so it
 * has to read like a decision, not like a row from the database.
 *
 * Found on the package-recommendation card while shooting the demo film: beside
 * "Package Name · The Signature Collection" it printed "Package Id ·
 * pkg-signature" and "Base Price Cents · 650000" — a database key and an
 * unformatted integer, in front of the person being asked to say yes.
 *
 * Same family as the earlier finding that this queue showed raw field paths.
 * The rule is the class, not the two keys: a `*Cents` value is money, and a
 * `*Id` is a machine reference the preview has no business showing. The
 * *editor* still offers every field, because changing which package is
 * recommended means changing its id.
 */
const source = readFileSync(
  `${process.cwd()}/components/ai/structured-content-fields.tsx`,
  "utf8",
);

test("money is formatted as money, not as an integer of cents", () => {
  assert.match(source, /const isCents = \(key: string\) => \/Cents\$\/\.test\(key\)/);
  assert.match(
    source,
    /isCents\(key\) && typeof item === "number"\s*\n?\s*\? formatCents\(item\)/,
    "a *Cents value in the preview must go through formatCents",
  );
  // The one place division by 100 is allowed (lib/format/money.ts), not here.
  assert.doesNotMatch(source, /\/\s*100/);
});

test("machine references are hidden from the preview", () => {
  assert.match(source, /const isMachineReference = \(key: string\) => \/\(\^\|\[a-z\]\)Id\$\//);
  assert.match(source, /!isMachineReference\(key\)/);
});

test("but the editor still offers every field", () => {
  // Hiding an id from the editor would make the recommended package
  // unchangeable, which is the one edit this card exists to allow.
  const editor = source.slice(source.indexOf("StructuredContentEditor"));
  assert.doesNotMatch(
    editor.slice(0, 2000),
    /isMachineReference/,
    "the editor must not hide machine references",
  );
});

test("a money field is labelled by what it is, not by its storage unit", () => {
  assert.match(source, /amountCents: "Amount"/);
  assert.match(source, /basePriceCents: "Price"/);
  assert.doesNotMatch(source, /"Amount \(cents\)"/);
});
