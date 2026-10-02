import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  bookingGateNeeds,
  clientRef,
  hasFinalBalance,
  JOB_KIND_LABELS,
  JOB_KINDS,
  jobKindFromLabel,
  jobKindOf,
  journeyProfile,
  vocab,
} from "@/features/job-kinds/job-kinds";
import { templateKeyForKind } from "../functions/src/job-kinds/template-key.ts";

/**
 * Kinds of job (docs/job-types-plan-2026-10-02.md). A studio's family
 * sessions, corporate events and sports days run through the same journey as
 * its weddings; the kind decides the words, the steps, the timings and the
 * starter content. These pin the decisions GR Productions made on 2026-10-02.
 */

const MARKER = "// ── mirrored below ──";
const below = (path: string) => {
  const source = readFileSync(path, "utf8");
  return source.slice(source.indexOf(MARKER));
};

test("the functions copy of the kinds has not drifted", () => {
  assert.equal(
    below("functions/src/job-kinds/job-kinds.ts"),
    below("features/job-kinds/job-kinds.ts"),
    "functions/ decides a job's kind differently from the app",
  );
});

test("a job's kind: stored first, then its type id, then its label — never wedding by default", () => {
  assert.equal(jobKindOf({ eventKind: "sports", eventTypeId: "wedding" }), "sports");
  assert.equal(jobKindOf({ eventKind: "general" }), "other");
  assert.equal(jobKindOf({ eventTypeId: "corporate" }), "corporate");
  assert.equal(jobKindOf({ eventTypeId: "wedding" }), "wedding");
  // The retired eventTypeTemplates ids.
  assert.equal(jobKindOf({ eventTypeId: "school" }), "portraits");
  assert.equal(jobKindOf({ eventTypeId: "business" }), "corporate");
  // A studio's own labels.
  assert.equal(jobKindOf({ eventTypeId: "x", eventType: "Mini sessions" }), "portraits");
  assert.equal(jobKindOf({ eventType: "Cheer" }), "sports");
  assert.equal(jobKindOf({ eventType: "Headshots" }), "corporate");
  assert.equal(jobKindOf({ eventType: "Elopement" }), "wedding");
  // Unknown is "other": a family reading "your wedding" is the failure.
  assert.equal(jobKindOf({ eventType: "Bar mitzvah" }), "other");
  assert.equal(jobKindOf({}), "other");
  assert.equal(jobKindOf(null), "other");
  assert.equal(jobKindFromLabel(""), null);
});

test("Gabe's answers: family books on payment alone, sports on its date", () => {
  const family = journeyProfile("portraits");
  assert.equal(family.agreement, false);
  assert.equal(family.payment, "paid_in_full");
  assert.deepEqual(bookingGateNeeds(family), { agreement: false, payment: true });
  assert.equal(hasFinalBalance(family), false);
  assert.equal(family.finalDetailsLock, false);
  assert.equal(family.exclusiveDay, false);

  const sports = journeyProfile("sports");
  assert.equal(sports.agreement, false);
  assert.equal(sports.payment, "on_the_day");
  assert.deepEqual(bookingGateNeeds(sports), { agreement: false, payment: false });
  assert.equal(hasFinalBalance(sports), false);

  const wedding = journeyProfile("wedding");
  assert.deepEqual(bookingGateNeeds(wedding), { agreement: true, payment: true });
  assert.equal(hasFinalBalance(wedding), true);
  assert.equal(wedding.finalDetailsLock, true);
  assert.equal(wedding.exclusiveDay, true);
});

test("corporate is paid either way: the package decides", () => {
  assert.equal(journeyProfile("corporate").payment, "deposit_and_balance");
  const after = journeyProfile("corporate", { payment: "invoice_after" });
  assert.equal(after.payment, "invoice_after");
  assert.equal(after.agreement, true);
  assert.deepEqual(bookingGateNeeds(after), { agreement: true, payment: false });
  // Nonsense leaves the kind's default.
  assert.equal(journeyProfile("corporate", { payment: "barter" }).payment, "deposit_and_balance");
});

test("a wedding's details form follows the studio's planning timeline", () => {
  assert.equal(journeyProfile("wedding").detailsFormDaysBefore, 180);
  assert.equal(journeyProfile("wedding", { detailsFormDaysBefore: 120 }).detailsFormDaysBefore, 120);
  assert.equal(journeyProfile("portraits").detailsFormDaysBefore, 14);
});

test("every kind has every word, and a family is never 'the couple'", () => {
  for (const kind of JOB_KINDS) {
    const words = vocab(kind);
    for (const [key, value] of Object.entries(words)) {
      if (Array.isArray(value)) assert.ok(value.length > 0, `${kind}.${key}`);
      else assert.ok(String(value).trim().length > 0, `${kind}.${key}`);
    }
    assert.ok(JOB_KIND_LABELS[kind]);
    if (kind !== "wedding") {
      const text = JSON.stringify(words).toLowerCase();
      for (const word of ["wedding", "couple", "bride", "groom", "ceremony", "dress"]) {
        assert.ok(!text.includes(word), `${kind} says "${word}"`);
      }
    }
  }
  assert.equal(clientRef("Emma & James", "portraits"), "Emma & James");
  assert.equal(clientRef("", "portraits"), "the family");
  assert.equal(clientRef(null, "wedding"), "the couple");
});

test("a job's template key: the kind, or a wedding studio's own wedding id", () => {
  assert.equal(templateKeyForKind("portraits", "wedding"), "portraits");
  assert.equal(templateKeyForKind("sports", "cheer"), "sports");
  assert.equal(templateKeyForKind("wedding", "wedding"), "wedding");
  assert.equal(templateKeyForKind("wedding", "weddings"), "weddings");
  // A lowercased label is not a template key.
  assert.equal(templateKeyForKind("wedding", "elopement"), "wedding");
  assert.equal(templateKeyForKind("wedding", ""), "wedding");
});

test("every path that makes a job writes its kind", () => {
  const sources: Array<[string, RegExp]> = [
    ["functions/src/intake/convert.ts", /eventKind: jobKindOf\(/],
    ["functions/src/intake/capture.ts", /eventKind: capturedKind/],
    ["functions/src/crm/commands.ts", /eventKind,\s*\n\s*eventTypeKey: command\.input\.eventTypeKey/],
    ["functions/src/imports/commands.ts", /eventKind,/],
  ];
  for (const [path, pattern] of sources) {
    assert.match(readFileSync(path, "utf8"), pattern, path);
  }
});
