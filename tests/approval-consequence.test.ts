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

test("known copilot command types get a specific, human sentence", () => {
  const cases: Record<string, string> = {
    create_task: "Approving adds this task to the project.",
    set_insurance_required: "Approving flags that the venue requires insurance.",
    create_proposal_draft:
      "Approving creates an unsent proposal draft you can review before sending.",
    assign_questionnaire: "Approving sends the questionnaire to the client.",
  };
  for (const [commandType, sentence] of Object.entries(cases)) {
    assert.equal(
      approvalConsequenceSentence({ ...draft, downstreamCommandType: commandType }, readable),
      sentence,
      `${commandType} should have its own sentence`,
    );
    // None of these is an email dispatch from the copilot's own send path.
    assert.equal(
      dispatchesOnApproval({ ...draft, downstreamCommandType: commandType }),
      false,
    );
  }
});

test("an unmapped command type still gets a safe generic sentence", () => {
  assert.equal(
    approvalConsequenceSentence(
      { ...draft, downstreamCommandType: "some_new_command" },
      readable,
    ),
    "Approving runs some new command.",
  );
});

test("an inquiry reply's create_communication_draft is the email itself, not a command", () => {
  // The server sends inquiry replies on approval (by capability); the draft's
  // downstream only names that path. The sheet said "Approving runs create
  // communication draft" above a reply approving emailed to the couple.
  const reply = { ...draft, downstreamCommandType: "create_communication_draft" };
  assert.equal(dispatchesOnApproval(reply), true);
  assert.match(approvalConsequenceSentence(reply, readable), /^Approving emails this to /);
  // Without a recipient it is still honest: saved, not sent.
  assert.equal(dispatchesOnApproval({ ...reply, recipient: null }), false);
  assert.match(approvalConsequenceSentence({ ...reply, recipient: null }, readable), /saves the draft/);
});
