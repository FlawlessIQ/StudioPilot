import assert from "node:assert/strict";
import test from "node:test";
import { chatDayLabel, chatSubject, chatThread } from "../features/messaging/client-chat";

/**
 * The couple's messages are a chat, but the studio's inbox still files each
 * one under a subject the portal requires (1–120 characters). The couple is
 * never asked for one.
 */

test("a question started from a page is named for that page", () => {
  assert.equal(chatSubject({ body: "Is it signed?", context: "Contract signing", replyToSubject: "Hello" }), "Contract signing question");
});

test("a reply carries the studio's subject, once", () => {
  assert.equal(chatSubject({ body: "Yes!", context: null, replyToSubject: "Your planning timeline" }), "Re: Your planning timeline");
  assert.equal(chatSubject({ body: "Yes!", context: null, replyToSubject: "RE: Timeline" }), "RE: Timeline");
});

test("anything else takes its first line, shortened", () => {
  assert.equal(chatSubject({ body: "Hi there\nsecond line", context: null, replyToSubject: null }), "Hi there");
  const long = chatSubject({ body: "a".repeat(200), context: null, replyToSubject: null });
  assert.equal(long.length, 60);
  assert.ok(long.endsWith("…"));
  assert.equal(chatSubject({ body: "   ", context: null, replyToSubject: null }), "Message from the portal");
});

test("every subject fits the portal's 120 characters", () => {
  const subject = chatSubject({ body: "x", context: "c".repeat(200), replyToSubject: null });
  assert.ok(subject.length <= 120 && subject.length >= 1);
});

test("the thread is in sending order and marks where each day starts", () => {
  const thread = chatThread([
    { id: "b", createdAt: "2026-08-12T16:20:00" },
    { id: "c", createdAt: "2026-08-14T15:00:00" },
    { id: "a", createdAt: "2026-08-12T14:00:00" },
  ]);
  assert.deepEqual(thread.map((entry) => [entry.message.id, entry.newDay]), [["a", true], ["b", false], ["c", true]]);
});

test("a day is named Today, Yesterday, or its date", () => {
  const now = new Date(2026, 8, 29, 12);
  assert.equal(chatDayLabel(new Date(2026, 8, 29, 8).toISOString(), now), "Today");
  assert.equal(chatDayLabel(new Date(2026, 8, 28, 23).toISOString(), now), "Yesterday");
  assert.equal(chatDayLabel("not a date", now), "Earlier");
});
