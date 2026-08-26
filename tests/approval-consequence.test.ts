import assert from "node:assert/strict";
import { test } from "node:test";
import {
  approvalConsequenceSentence,
  dispatchesOnApproval,
} from "@/features/ai/approval-consequence";

const readable = (value: string) =>
  value.replaceAll("_", " ").replace(/^\w/, (l) => l.toUpperCase());

const draft = {
  downstreamCommandType: null,
  recipient: "hana.park@example.com",
  subject: "Thanks for reaching out",
  body: "Hi Hana,",
};

/**
 * The card used to say "Nothing goes to the client until you send it" and then
 * send it. These tests pin the sentence to what the server actually does.
 */

test("a complete reply with a real address is sent by approving, and says so", () => {
  assert.equal(dispatchesOnApproval(draft), true);
  assert.equal(
    approvalConsequenceSentence(draft, readable),
    "Approving emails this to hana.park@example.com straight away.",
  );
});

test("a draft with no recipient is only saved, and says that instead", () => {
  const orphan = { ...draft, recipient: null };
  assert.equal(dispatchesOnApproval(orphan), false);
  assert.equal(
    approvalConsequenceSentence(orphan, readable),
    "Approving saves the draft. Nothing goes to the client until you send it.",
  );
});

test("an empty body is not dispatchable, however good the address", () => {
  assert.equal(dispatchesOnApproval({ ...draft, body: "   " }), false);
  assert.equal(dispatchesOnApproval({ ...draft, subject: "" }), false);
});

test("a malformed address is not treated as sendable", () => {
  for (const recipient of ["hana", "hana@", "@example.com", "hana park@x.com"]) {
    assert.equal(
      dispatchesOnApproval({ ...draft, recipient }),
      false,
      `${recipient} should not count as an address`,
    );
  }
});

test("a draft that runs a command names the command, not the email", () => {
  assert.equal(
    approvalConsequenceSentence(
      { ...draft, downstreamCommandType: "publish_schedule" },
      readable,
    ),
    "Approving runs publish schedule.",
  );
  // A command-backed action must never claim it emails the client.
  assert.equal(
    dispatchesOnApproval({ ...draft, downstreamCommandType: "publish_schedule" }),
    false,
  );
});
