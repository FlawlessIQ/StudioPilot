import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { resolveContractDocument } from "@/features/contracts/document";
import { sampleContractSources } from "@/features/contracts/sample";

/**
 * "I need the wedding venue form sent to them and on the contract." Asked
 * whether the answers should travel alongside the contract or be printed into
 * it: "They should be on the signed contract document itself."
 *
 * Venue, timings and access are what the studio is agreeing to work around, so
 * they belong inside the agreement rather than attached beside it.
 */
const template = {
  title: "Booking agreement",
  body: "Coverage details as provided by the client:\n\n{{form.answers}}\n",
  customFields: [],
};

const base = sampleContractSources("Hart Light Photography", "2026-09-25");

function resolve(sources: typeof base) {
  return resolveContractDocument({ template, sources, overrides: {} });
}

test("the couple's answers are printed as a list in the document", () => {
  const document = resolve(base);
  const list = document.document.blocks.find((block) => block.type === "list");
  assert.ok(list, "no list block rendered");
  const rendered = (list as { items: { content: { text: string }[] }[] }).items.map(
    (item) => item.content.map((part) => part.text).join(""),
  );
  assert.deepEqual(rendered, [
    "Ceremony start: 3:00 PM",
    "Getting ready address: The Lodge, 14 Mill Lane",
  ]);
});

test("the question is emphasised and the answer is not", () => {
  const document = resolve(base);
  const list = document.document.blocks.find((block) => block.type === "list") as {
    items: { content: { text: string; bold?: true }[] }[];
  };
  const [question, answer] = list.items[0]!.content;
  assert.equal(question!.bold, true);
  assert.equal(answer!.bold, undefined);
});

/**
 * An unfilled field renders as a visible placeholder, like every other missing
 * merge field — not as an empty heading the studio might not notice.
 */
test("nothing submitted reads as missing, not as blank", () => {
  const document = resolve({ ...base, formAnswers: [] });
  assert.ok(!document.document.blocks.some((block) => block.type === "list"));
  const text = JSON.stringify(document.document.blocks);
  assert.match(text, /\[form\.answers\]/);
});

test("a blank question or answer is dropped rather than printed half", () => {
  const document = resolve({
    ...sampleContractSources,
    formAnswers: [
      { question: "Ceremony start", answer: "3:00 PM" },
      { question: "  ", answer: "orphaned" },
      { question: "Unanswered", answer: "" },
    ],
  });
  const list = document.document.blocks.find((block) => block.type === "list") as {
    items: { content: { text: string }[] }[];
  };
  assert.equal(list.items.length, 1);
});

const source = (path: string) => readFileSync(`${process.cwd()}/${path}`, "utf8");

/**
 * A half-filled draft would put answers the couple has not stood behind into a
 * document they are about to sign.
 */
test("only a submitted response reaches the contract", () => {
  const sources = source("functions/src/contracts/sources.ts");
  assert.match(sources, /text\(document\.get\("status"\)\) === "submitted"/);
  assert.match(sources, /where\("tenantId", "==", project\.get\("tenantId"\)\)/);
  assert.match(sources, /formAnswers,/);
});

test("the functions copy of the contract document matches features/", () => {
  const body = (path: string) => {
    const text = source(path);
    return text.slice(text.indexOf("export const contractMergeFields = ["));
  };
  assert.equal(
    body("functions/src/contracts/document.ts"),
    body("features/contracts/document.ts"),
  );
});
