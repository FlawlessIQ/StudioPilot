import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyClientQuestion,
  composePreparedAnswer,
  prepareAnswerFor,
  type PreparedAnswerFacts,
} from "../features/messaging/prepared-answers";

const facts: PreparedAnswerFacts = {
  studioName: "FlawlessIQ",
  clientFirstName: "John",
  projectName: "Smith Wedding",
  eventDate: "2026-10-14",
  invoice: {
    balanceCents: 56970,
    currency: "USD",
    dueDate: "2026-09-01",
    hostedUrl: "https://connect.intuit.com/t/scs-v1-abc",
  },
  arrivalTime: "1:00 PM",
  gallery: null,
};

test("the question that started this is recognised", () => {
  // Verbatim from the first real client reply, spacing included.
  assert.equal(classifyClientQuestion("How do I pay ?"), "payment");
});

test("payment phrasings people actually use", () => {
  for (const body of [
    "How do I pay?",
    "how can we pay",
    "Where do I pay the retainer?",
    "Can you send me the payment link?",
    "how to pay",
  ]) {
    assert.equal(classifyClientQuestion(body), "payment", body);
  }
});

test("a balance question is not a payment question", () => {
  assert.equal(classifyClientQuestion("How much do I still owe?"), "balance");
  assert.equal(classifyClientQuestion("What's my balance?"), "balance");
});

test("arrival and gallery questions are recognised", () => {
  assert.equal(
    classifyClientQuestion("What time do you arrive on the day?"),
    "arrival_time",
  );
  assert.equal(
    classifyClientQuestion("When will we get the photos?"),
    "gallery_delivery",
  );
});

test("anything asking for a decision is left to a person", () => {
  for (const body of [
    "Can we move the ceremony to 4pm?",
    "Could you add a second photographer?",
    "Is it possible to change the timeline?",
    "We're thinking of a later start — what do you think?",
  ]) {
    assert.equal(classifyClientQuestion(body), null, body);
  }
});

test("a factual question beside a decision is not auto-answered", () => {
  // The dangerous case: answering the payment half and silently dropping the
  // rest reads as though the studio had not read the message.
  assert.equal(
    classifyClientQuestion("How do I pay? Also can we move the ceremony to 4pm?"),
    null,
  );
});

test("two factual questions at once are left to a person", () => {
  assert.equal(
    classifyClientQuestion("How do I pay, and what time do you arrive?"),
    null,
  );
});

test("a long message is a conversation, not a lookup", () => {
  const long = `How do I pay? ${"We have been thinking a lot about the day. ".repeat(20)}`;
  assert.ok(long.length > 600);
  assert.equal(classifyClientQuestion(long), null);
});

test("unrelated messages are not forced into an intent", () => {
  for (const body of ["Thanks so much!", "See you Saturday", "", "   "]) {
    assert.equal(classifyClientQuestion(body), null, JSON.stringify(body));
  }
});

test("the payment answer carries the real figure, date and link", () => {
  const answer = composePreparedAnswer("payment", facts);
  assert.ok(answer);
  assert.match(answer.body, /\$569\.70/);
  assert.match(answer.body, /September 1, 2026/);
  assert.match(answer.body, /connect\.intuit\.com/);
  assert.match(answer.body, /Hi John,/);
  assert.match(answer.body, /FlawlessIQ/);
  // The studio can see what it was built from before sending.
  assert.ok(answer.basedOn.some((line) => line.includes("$569.70")));
});

test("a paid-up client is told that, not sent a link", () => {
  const answer = composePreparedAnswer("payment", {
    ...facts,
    invoice: { ...facts.invoice!, balanceCents: 0 },
  });
  assert.ok(answer);
  assert.match(answer.body, /all paid up/i);
  assert.doesNotMatch(answer.body, /connect\.intuit\.com/);
});

test("a balance with no way to pay it does not answer how to pay", () => {
  const answer = composePreparedAnswer("payment", {
    ...facts,
    invoice: { ...facts.invoice!, hostedUrl: null },
  });
  assert.equal(answer, null);
});

test("no invoice means no payment answer at all", () => {
  assert.equal(composePreparedAnswer("payment", { ...facts, invoice: null }), null);
  assert.equal(composePreparedAnswer("balance", { ...facts, invoice: null }), null);
});

test("a balance answer still states the amount without a link", () => {
  const answer = composePreparedAnswer("balance", {
    ...facts,
    invoice: { ...facts.invoice!, hostedUrl: null },
  });
  assert.ok(answer);
  assert.match(answer.body, /\$569\.70/);
});

test("arrival time is only given when a schedule supplies it", () => {
  assert.ok(composePreparedAnswer("arrival_time", facts));
  assert.equal(
    composePreparedAnswer("arrival_time", { ...facts, arrivalTime: null }),
    null,
  );
});

test("a gallery answer waits until the gallery is actually delivered", () => {
  assert.equal(composePreparedAnswer("gallery_delivery", facts), null);
  assert.equal(
    composePreparedAnswer("gallery_delivery", {
      ...facts,
      gallery: { url: "https://gallery.example/abc", ready: false },
    }),
    null,
  );
  const delivered = composePreparedAnswer("gallery_delivery", {
    ...facts,
    gallery: { url: "https://gallery.example/abc", ready: true },
  });
  assert.ok(delivered);
  assert.match(delivered.body, /gallery\.example/);
});

test("a missing first name degrades to a plain greeting", () => {
  const answer = composePreparedAnswer("payment", {
    ...facts,
    clientFirstName: null,
  });
  assert.ok(answer);
  assert.match(answer.body, /^Hello,/);
});

test("end to end: the real question against the real project shape", () => {
  const answer = prepareAnswerFor("How do I pay ?", {
    ...facts,
    // The production figures at the time: a $1.00 test retainer.
    invoice: {
      balanceCents: 100,
      currency: "USD",
      dueDate: "2026-09-01",
      hostedUrl: "https://connect.intuit.com/t/scs-v1-d0b95",
    },
  });
  assert.ok(answer);
  assert.equal(answer.intent, "payment");
  assert.match(answer.body, /\$1\.00/);
  assert.match(answer.body, /connect\.intuit\.com/);
});

test("an unrecognised question prepares nothing", () => {
  assert.equal(prepareAnswerFor("Can we move the ceremony?", facts), null);
});
