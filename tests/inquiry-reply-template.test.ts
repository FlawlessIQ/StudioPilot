import assert from "node:assert/strict";
import { test } from "node:test";
import { applyReplyTemplate, eventDateLabel, fillReplyText } from "../functions/src/communications/inquiry-reply-template";
import { inlineHtml, inlineText, renderEmailTemplate } from "../functions/src/communications/email-templates";
import { linkMarkup } from "../features/communications/link-markup";
import { EDITABLE_EMAILS } from "../features/communications/email-catalog";

const facts = { recipientName: "Maya Brooks", studioName: "GR Productions", eventType: "wedding", eventDate: "2027-06-12", venue: "Hollow Oak Barn" };
const cue = { subject: "Thank you for your wedding inquiry", body: "Dear Maya,\n\nCue's own words about your day.\n\nWarmly," };

test("a saved reply replaces Cue's, with the inquiry's details filled in", () => {
  const out = applyReplyTemplate(
    { version: 3, subject: "Your {{eventType}} with {{studioName}}", mode: "replace", paragraphs: ["Thank you for reaching out about {{eventDate}} at {{venue}}.", "Talk soon,\nGabe"] },
    cue,
    facts,
  );
  assert.equal(out.subject, "Your wedding with GR Productions");
  assert.equal(out.body, "Hi Maya,\n\nThank you for reaching out about Saturday, June 12, 2027 at Hollow Oak Barn.\n\nTalk soon,\nGabe");
  assert.equal(out.templateVersion, 3);
});

test("their own greeting is kept, and 'add' puts their words above Cue's", () => {
  const own = applyReplyTemplate({ version: 1, subject: "", mode: "replace", paragraphs: ["Hey {{clientFirstName}}!", "So glad you wrote."] }, cue, facts);
  assert.equal(own.body, "Hey Maya!\n\nSo glad you wrote.");
  assert.equal(own.subject, cue.subject);
  const added = applyReplyTemplate({ version: 2, subject: "", mode: "add", paragraphs: ["We'd love to hear more."] }, cue, facts);
  assert.equal(added.body, "Dear Maya,\n\nWe'd love to hear more.\n\nCue's own words about your day.\n\nWarmly,");
  assert.deepEqual(applyReplyTemplate(null, cue, facts), { ...cue, templateVersion: null });
});

test("a field with nothing to fill leaves clean text", () => {
  assert.equal(fillReplyText("See you at {{venue}}, {{clientFirstName}}.", { ...facts, venue: "" }), "See you at, Maya.");
  assert.equal(eventDateLabel("not a date"), "");
});

test("links in a studio's words become links, and nothing else does", () => {
  assert.equal(
    inlineHtml("See [our packages](https://gr.com/pricing) & more"),
    'See <a href="https://gr.com/pricing" style="color:#35664a;text-decoration:underline;">our packages</a> &amp; more',
  );
  assert.match(inlineHtml("Visit https://gr.com/faq."), /<a href="https:\/\/gr\.com\/faq"[^>]*>https:\/\/gr\.com\/faq<\/a>\.$/);
  assert.equal(inlineHtml("[click](javascript:alert(1))"), "[click](javascript:alert(1))");
  assert.equal(inlineHtml('<b>"x"</b>'), "&lt;b&gt;&quot;x&quot;&lt;/b&gt;");
  assert.equal(inlineText("See [our packages](https://gr.com/pricing) or [email us](mailto:hi@gr.com)"), "See our packages (https://gr.com/pricing) or email us (hi@gr.com)");
});

test("a rendered email carries the link, in HTML and in plain text", () => {
  const email = renderEmailTemplate({
    key: "manual_message",
    brand: { studioName: "GR Productions", productName: "StudioCue", accentColor: "#35664a", logoUrl: null, contactEmail: null },
    recipientName: "Maya Brooks",
    projectName: null,
    values: { customSubject: "Hi", customBody: "Here are [our packages](https://gr.com/pricing)." },
  } as Parameters<typeof renderEmailTemplate>[0]);
  assert.match(email.html, /<a href="https:\/\/gr\.com\/pricing"[^>]*>our packages<\/a>/);
  assert.match(email.text, /our packages \(https:\/\/gr\.com\/pricing\)/);
});

test("the editor's Add a link accepts what people type, and nothing unsafe", () => {
  assert.equal(linkMarkup("See our packages", "gr.com/pricing"), "[See our packages](https://gr.com/pricing)");
  assert.equal(linkMarkup("", "https://gr.com"), "[gr.com](https://gr.com)");
  assert.equal(linkMarkup("Email us", "hi@gr.com"), "[Email us](mailto:hi@gr.com)");
  assert.equal(linkMarkup("x", "javascript:alert(1)"), null);
  assert.equal(linkMarkup("x", "not a url"), null);
});

test("the reply template is in the editor", () => {
  assert.ok(EDITABLE_EMAILS.some((email) => email.key === "inquiry_reply"));
});
