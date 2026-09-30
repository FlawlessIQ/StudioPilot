import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { keptMeetingSettings } from "../functions/src/booking/consultation-settings-merge.ts";

/**
 * Block day on the studio calendar saved the consultation settings it knew —
 * hours, buffer, blocked dates — and the command defaulted the rest, so
 * blocking a day reset "How you meet" to video only and cleared the
 * in-person address.
 */

const saved = { meetingFormats: ["in_person", "phone"], inPersonLocation: "12 Harbor St, Gloucester" };

test("a save that leaves out meeting formats and the address keeps what was saved", () => {
  // Exactly what the calendar's Block day sends: no formats, no address.
  assert.deepEqual(keptMeetingSettings({}, saved), {
    meetingFormats: ["in_person", "phone"],
    inPersonLocation: "12 Harbor St, Gloucester",
  });
});

test("a save that sends them replaces them, an explicit null address included", () => {
  assert.deepEqual(keptMeetingSettings({ meetingFormats: ["zoom"], inPersonLocation: null }, saved), {
    meetingFormats: ["zoom"],
    inPersonLocation: null,
  });
});

test("with nothing saved yet, a studio meets by video until it chooses", () => {
  assert.deepEqual(keptMeetingSettings({}, null), { meetingFormats: ["zoom"], inPersonLocation: null });
  assert.deepEqual(keptMeetingSettings({}, { meetingFormats: ["bogus"] }), { meetingFormats: ["zoom"], inPersonLocation: null });
});

test("the command no longer defaults what it isn't sent", () => {
  const source = readFileSync("functions/src/booking/commands.ts", "utf8");
  const schema = source.slice(source.indexOf('type: z.literal("setConsultationSettings")'));
  const block = schema.slice(0, schema.indexOf(".refine("));
  assert.doesNotMatch(block, /meetingFormats:[^\n]*\.default\(/);
  assert.doesNotMatch(block, /inPersonLocation:[^\n]*\.default\(/);
  assert.match(source, /\.\.\.keptMeetingSettings\(command\.input, before\)/);
});
