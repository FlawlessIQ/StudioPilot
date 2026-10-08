import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { EDITABLE_EMAILS, NOT_EDITABLE } from "@/features/communications/email-catalog";
import {
  CLIENT_EMAIL_TYPES,
  CREW_EMAIL_TYPES,
  emailTemplateKeys,
  renderEmailTemplate,
} from "../functions/src/communications/email-templates.ts";
import { previewEmail } from "../functions/src/communications/template-preview.ts";

/**
 * GR, 2026-10-08: "Where do I customize emails? I see where but it doesn't let
 * me adjust." The editor showed one placeholder for every email, saved drafts
 * that did nothing until a separate Activate, and a saved body dropped every
 * date, time and amount the email carried.
 */

const read = (path: string) => readFileSync(path, "utf8");
const brand = { studioName: "GR Productions", productName: "StudioCue", accentColor: "#35664a", logoUrl: null, contactEmail: null };

test("every email a client or crew member gets is listed, or excluded with a reason", () => {
  const listed = new Set(EDITABLE_EMAILS.map((entry) => entry.key));
  for (const key of listed) assert.ok((emailTemplateKeys as readonly string[]).includes(key), `${key} is not a server template`);
  const missing = [...CLIENT_EMAIL_TYPES, ...CREW_EMAIL_TYPES].filter((key) => !listed.has(key) && !(key in NOT_EDITABLE));
  assert.deepEqual(missing, []);
  assert.equal(listed.size, EDITABLE_EMAILS.length, "no email listed twice");
});

test("the studio's words go above ours by default, and the details stay", () => {
  const values = {
    timezone: "America/New_York",
    role: "Second photographer",
    arrivalAt: "2027-06-12T16:00:00.000Z",
    callDate: "2027-06-12",
    locationName: "Hollow Oak Barn",
    runOfShowShared: true,
    scheduleUrl: "https://studio-cue.com/crew/schedule?assignment=a1",
  };
  const rendered = renderEmailTemplate({
    key: "crew_reminder",
    brand,
    recipientName: "Jordan Lee",
    projectName: "Avery & Sam",
    values,
    template: {
      mode: "add",
      subject: "",
      preheader: "",
      eyebrow: "",
      heading: "",
      paragraphs: ["Bring the 70-200 and two spare batteries."],
      actionLabel: null,
      note: null,
    },
  });
  const text = rendered.text;
  assert.ok(text.indexOf("Hi Jordan,") < text.indexOf("Bring the 70-200"), "under the greeting");
  assert.ok(text.indexOf("Bring the 70-200") < text.indexOf("Call time:"), "above ours");
  assert.match(text, /Role: Second photographer/);
  assert.match(text, /Where: Hollow Oak Barn/);
  // Blank fields keep ours.
  assert.match(rendered.subject, /Reminder: your GR Productions job/);
  assert.match(rendered.html, /Open your day sheet/);
});

test("replacing ours is the studio's whole message — and a blank subject still keeps ours", () => {
  const rendered = renderEmailTemplate({
    key: "event_reminder",
    brand,
    recipientName: "Avery Stone",
    projectName: "Avery & Sam",
    values: { timezone: "America/New_York", eventDate: "2026-10-10", portalUrl: "https://studio-cue.com/client" },
    template: {
      mode: "replace",
      subject: "",
      preheader: "",
      eyebrow: "",
      heading: "Almost time, {{recipientName}}!",
      paragraphs: ["We can't wait for Saturday."],
      actionLabel: null,
      note: null,
    },
  });
  assert.match(rendered.text, /We can't wait for Saturday\./);
  assert.match(rendered.text, /Almost time, Avery Stone!/);
  assert.doesNotMatch(rendered.text, /on October 10, 2026/);
  assert.ok(rendered.subject.length > 0);
});

test("the preview is the real email, branded, with StudioCue's own wording to edit against", () => {
  const preview = previewEmail({ brandName: "GR Productions", timezone: "America/New_York" }, "crew_monthly_roundup", null);
  assert.equal(preview.subject, "Your upcoming jobs with GR Productions");
  assert.match(preview.html, /Avery &amp; Sam|Avery & Sam/);
  assert.ok(preview.defaults.paragraphs.length > 0);
  assert.doesNotMatch(preview.html, /A thoughtful next step/);
});

test("one tap saves and uses it; back to ours is one tap too", () => {
  const editor = read("components/communications/email-template-designer.tsx");
  assert.match(editor, /input: \{ \.\.\.contentOf\(key, email\.label, fields\), activate: true \}/);
  assert.match(editor, /type: "resetTemplate"/);
  assert.match(editor, /type: "previewTemplate"/);
  assert.doesNotMatch(editor, /A thoughtful next step/);
  assert.doesNotMatch(editor, /Activate/);
  const commands = read("functions/src/communications/commands.ts");
  assert.match(commands, /activeTemplateId: activate \? templateId :/);
  assert.match(commands, /mode: z\.enum\(\["add", "replace"\]\)\.default\("add"\)/);
  // A saved version keeps its mode when it is read back to send.
  assert.match(read("functions/src/operations/jobs.ts"), /mode: template\.mode === "add" \? "add" : "replace",/);
});
