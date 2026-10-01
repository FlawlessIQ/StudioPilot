import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  FEEDBACK_EMAIL_TYPES,
  emailTemplateKeys,
  isAuthEmailType,
  isPlatformEmailType,
  renderEmailTemplate,
} from "../functions/src/communications/email-templates.ts";
import {
  FEEDBACK_KINDS,
  FEEDBACK_KIND_LABELS,
  FEEDBACK_KIND_PROMPTS,
  FEEDBACK_NOTIFYING_STATUSES,
  FEEDBACK_ROLES,
  feedbackSubject,
} from "@/features/feedback/model";
import { roleSchema } from "@/features/auth/roles";

/**
 * Studio feedback (features/feedback, functions/src/feedback): the button, the
 * team inbox email, the thank-you, and the "planned"/"shipped" write-backs.
 */

const platformBrand = {
  studioName: "StudioCue",
  productName: "StudioCue",
  accentColor: "#35664a",
  logoUrl: null,
  contactEmail: null,
};

const body = (source: string) => source.slice(source.indexOf("export const FEEDBACK_KINDS"));

test("the functions copy of the feedback model matches features/ below the header", () => {
  const features = readFileSync("features/feedback/model.ts", "utf8");
  const functions = readFileSync("functions/src/feedback/model.ts", "utf8");
  assert.equal(body(functions), body(features));
});

test("every kind has a label and a prompt, and only studio roles get the button", () => {
  for (const kind of FEEDBACK_KINDS) {
    assert.ok(FEEDBACK_KIND_LABELS[kind]);
    assert.ok(FEEDBACK_KIND_PROMPTS[kind].endsWith("?") || FEEDBACK_KIND_PROMPTS[kind].endsWith("."));
  }
  for (const role of FEEDBACK_ROLES) assert.ok(roleSchema.options.includes(role), role);
  for (const role of ["client", "subcontractor", "guest"]) assert.ok(!(FEEDBACK_ROLES as readonly string[]).includes(role), role);
  assert.deepEqual([...FEEDBACK_NOTIFYING_STATUSES], ["planned", "shipped"]);
});

test("the team inbox subject names the kind, the studio and the start of the message", () => {
  assert.equal(feedbackSubject("idea", "Alder & Muse", "Let me duplicate a package"), "[Feedback · Idea] Alder & Muse — Let me duplicate a package");
  const long = feedbackSubject("broken", "GR Productions", `${"x".repeat(80)}\nsecond line`);
  assert.ok(long.startsWith("[Feedback · Something's broken] GR Productions — "));
  assert.ok(long.endsWith("…"));
  assert.ok(!long.includes("second line"));
  assert.equal(feedbackSubject("praise", "Studio", "   "), "[Feedback · Love this] Studio");
});

test("feedback mail is platform mail: StudioCue's letterhead, not the studio's", () => {
  for (const type of FEEDBACK_EMAIL_TYPES) {
    assert.ok(emailTemplateKeys.includes(type), type);
    assert.ok(isPlatformEmailType(type), type);
    // Not auth mail: it keeps ordinary tracking and threads nowhere.
    assert.ok(!isAuthEmailType(type), type);
  }
  assert.ok(isPlatformEmailType("password_reset"));
  assert.ok(!isPlatformEmailType("proposal_sent"));
  const worker = readFileSync("functions/src/operations/jobs.ts", "utf8");
  assert.match(worker, /const isAuth = isPlatformEmailType\(templateKey\)/);
});

test("the team inbox email carries what's needed to answer, and says whether they can be contacted", () => {
  const rendered = renderEmailTemplate({
    key: "feedback_received",
    brand: platformBrand,
    recipientName: "StudioCue team",
    values: {
      feedbackSubject: "[Feedback · Something's broken] Alder & Muse — The Send button spins forever",
      feedbackKind: "broken",
      feedbackMessage: "The Send button spins forever\nOn the proposal page.",
      studioName: "Alder & Muse",
      senderName: "Jordan Rivera",
      senderEmail: "jordan@alder.test",
      senderRole: "studio_owner",
      route: "/studio/proposals/new",
      viewport: "1440×900",
      userAgent: "Mozilla/5.0",
      lastError: "PROPOSAL_SEND_FAILED",
      feedbackScreenshotPath: "feedback/tenant-a/fb_abc.jpg",
      followUpOk: true,
      actionUrl: "https://studio-cue.com/platform-admin/feedback?id=fb_abc",
    },
  });
  assert.equal(rendered.subject, "[Feedback · Something's broken] Alder & Muse — The Send button spins forever");
  for (const expected of [
    "The Send button spins forever",
    "On the proposal page.",
    "Jordan Rivera <jordan@alder.test> (studio owner)",
    "Screen: /studio/proposals/new",
    "Device: 1440×900 · Mozilla/5.0",
    "Last error on screen: PROPOSAL_SEND_FAILED",
    "Screenshot attached.",
    "Reply to this email to answer them directly.",
    "Open in triage",
  ])
    assert.ok(rendered.text.includes(expected), expected);

  const noContact = renderEmailTemplate({
    key: "feedback_received",
    brand: platformBrand,
    values: { feedbackKind: "idea", feedbackMessage: "Dark mode", studioName: "Alder & Muse", followUpOk: false },
  });
  assert.ok(noContact.text.includes("They asked not to be contacted about this one."));
  assert.ok(noContact.text.includes("No screenshot."));
});

test("the studio's emails are signed by the team, never by a person", () => {
  const rendered = (key: string, values: Record<string, unknown>) =>
    renderEmailTemplate({ key, brand: platformBrand, recipientName: "Jordan Rivera", values }).text;
  const all = [
    rendered("feedback_thanks", { feedbackKind: "idea", feedbackMessage: "Dark mode please", followUpOk: true, actionUrl: "https://x.test/studio/help#feedback" }),
    rendered("feedback_thanks", { feedbackKind: "broken", feedbackMessage: "It broke", followUpOk: false }),
    rendered("feedback_planned", { feedbackKind: "idea", feedbackMessage: "Dark mode please", statusNote: "Pencilled in for November." }),
    rendered("feedback_shipped", { feedbackKind: "broken", feedbackMessage: "It broke" }),
  ];
  for (const text of all) {
    assert.ok(text.includes("The StudioCue team"), text);
    assert.doesNotMatch(text, /conor|flawlessiq/i);
  }
  assert.ok(all[0]!.includes("“Dark mode please”"));
  assert.ok(all[0]!.includes("We'll let you know if it makes it onto the plan."));
  // Without permission to follow up, nothing promises a reply.
  assert.ok(all[1]!.includes("We're looking into what went wrong."));
  assert.doesNotMatch(all[1]!, /we'll reply/i);
  assert.ok(all[2]!.includes("Pencilled in for November."));
  assert.ok(all[2]!.includes("We'll write again when it's live."));
  assert.ok(all[3]!.includes("That's now fixed in StudioCue."));

  const subject = (key: string, kind: string) =>
    renderEmailTemplate({ key, brand: platformBrand, values: { feedbackKind: kind } }).subject;
  assert.equal(subject("feedback_shipped", "idea"), "You asked, and it's live in StudioCue");
  assert.equal(subject("feedback_shipped", "broken"), "Fixed: the problem you reported");
  assert.equal(subject("feedback_planned", "idea"), "Your idea is on the StudioCue plan");
  assert.equal(subject("feedback_planned", "broken"), "We're fixing the problem you reported");
});

test("the feedback command is wired end to end: export, relay, invokers, rules, index", () => {
  assert.match(readFileSync("functions/src/index.ts", "utf8"), /export \{ feedbackCommand \} from "\.\/feedback\/commands\.js";/);
  assert.match(readFileSync("app/api/functions/[functionName]/route.ts", "utf8"), /"feedbackCommand",/);
  assert.match(readFileSync("scripts/configure-production-function-invokers.sh", "utf8"), /^\s+feedbackcommand$/m);
  const rules = readFileSync("firestore.rules", "utf8");
  assert.match(rules, /match \/feedback\/\{feedbackId\} \{[\s\S]*?allow write: if false;/);
  assert.match(readFileSync("storage.rules", "utf8"), /match \/feedback\/\{tenantId\}\/\{fileName\} \{[\s\S]*?allow write: if false;/);
  const indexes = JSON.parse(readFileSync("firestore.indexes.json", "utf8")) as {
    indexes: Array<{ collectionGroup: string; fields: Array<{ fieldPath: string }> }>;
  };
  assert.ok(
    indexes.indexes.some(
      (index) =>
        index.collectionGroup === "feedback" &&
        index.fields.map((field) => field.fieldPath).join(",") === "tenantId,userId,createdAt",
    ),
    "Your feedback's query needs its index",
  );
});

test("the command checks studio membership, rate-limits, and never gates on the subscription", () => {
  const source = readFileSync("functions/src/feedback/commands.ts", "utf8");
  assert.match(source, /FEEDBACK_ROLES as readonly string\[\]\)\.includes/);
  assert.match(source, /withinRateLimit/);
  assert.match(source, /identity\.platformAdmin !== true/);
  assert.doesNotMatch(source, /requireActiveSubscription/);
  // Platform mail: a failed send never lands on a studio's Today.
  assert.match(source, /tenantId: "platform"/);
  // The thank-you's Reply-To is the team address, not the inbox's own.
  assert.doesNotMatch(source, /conor|flawlessiq/i);
});

test("the launcher sits in the studio shell, and the How-to popup offers it to studios only", () => {
  const shell = readFileSync("components/layout/app-shell.tsx", "utf8");
  assert.match(shell, /<FeedbackLauncher \/>/);
  assert.match(shell, /ds-nav-feedback/);
  const portal = readFileSync("components/layout/portal-shell.tsx", "utf8");
  assert.doesNotMatch(portal, /FeedbackLauncher/);
  const howTo = readFileSync("components/help/how-to.tsx", "utf8");
  assert.match(howTo, /onFeedback=\{/);
  // Only the studio branch passes it.
  const kitBranch = howTo.slice(howTo.indexOf("<KitRoot"), howTo.indexOf("</KitRoot>"));
  assert.doesNotMatch(kitBranch, /onFeedback/);
});
