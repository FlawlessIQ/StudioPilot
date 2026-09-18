import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * A proposal letter should sound like someone read the inquiry.
 *
 * Harper wrote that both sets of grandparents were travelling and it might be
 * the last time everyone was together, and asked for two photographers so the
 * ceremony was never left. "Draft from the consultation" produced "We are
 * excited about the possibility of capturing your special day", because the
 * only client context it received was a consultation AI review — and a couple
 * who books through the scheduler has no review yet, so it was empty.
 */
const copilot = readFileSync(`${process.cwd()}/functions/src/ai/copilot.ts`, "utf8");

const draftHandler = copilot.slice(
  copilot.indexOf('kind === "proposal_drafting"'),
  copilot.indexOf('kind === "list_threads"'),
);

test("the drafting request reads the inquiry the couple wrote", () => {
  assert.match(draftHandler, /\.collection\("leads"\)/);
  assert.match(draftHandler, /\.where\("projectId", "==", draftRequest\.projectId\)/);
  assert.match(draftHandler, /inquiry: \{\s*\n\s*message: lead\?\.message \?\? null,/);
  assert.match(draftHandler, /summary: lead\?\.aiSummary \?\? null,/);
});

test("the model is told to name something they actually said", () => {
  const instruction = copilot.slice(
    copilot.indexOf("Write proposal copy for a photography studio"),
    copilot.indexOf("Return JSON only.", copilot.indexOf("Write proposal copy")),
  );
  assert.match(instruction, /Name at least one specific thing THEY said/);
  assert.match(instruction, /inquiry\.message/);
  // And never the internal job name, which is how "your Harper Lane wedding"
  // reached a client-facing letter.
  assert.match(instruction, /never the studio’s internal job name/);
});

test("the leads lookup has an index to run on", () => {
  const indexes = JSON.parse(
    readFileSync(`${process.cwd()}/firestore.indexes.json`, "utf8"),
  ) as { indexes: Array<{ collectionGroup: string; fields: Array<{ fieldPath: string }> }> };
  assert.ok(
    indexes.indexes.some(
      (index) =>
        index.collectionGroup === "leads" &&
        index.fields.map((field) => field.fieldPath).join(",") === "tenantId,projectId",
    ),
  );
});
