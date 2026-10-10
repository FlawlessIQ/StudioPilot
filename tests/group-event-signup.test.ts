import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  CONFIRMATION_ALPHABET,
  confirmationCodeFrom,
  emailsFrom,
  eventPrice,
  eventSignupInputSchema,
  eventSignupSettingsProblem,
  eventSignupSettingsSchema,
  howToPay,
  normaliseEventSignup,
  normaliseVenmoHandle,
  signupState,
  signupTextMessage,
  smsHref,
  statusForMethod,
  venmoPayUrl,
} from "../features/group-events/signup.ts";
import { billingHoldApplies } from "../functions/src/saas/billing-hold.ts";
import { CLIENT_EMAIL_TYPES, renderEmailTemplate } from "../functions/src/communications/email-templates.ts";
import { EDITABLE_EMAILS } from "../features/communications/email-catalog.ts";

/**
 * Group event sign-up (docs/group-event-signup-plan-2026-10-10.md): parents
 * sign up from a link or a QR code at the field, pick a package and say how
 * they'll pay; the studio takes the money (mostly cash) and records it.
 */

const read = (path: string) => readFileSync(path, "utf8");
const brand = { studioName: "GR Productions", productName: "StudioCue", accentColor: null, logoUrl: null, replyTo: null } as never;

const configured = (signup: Record<string, unknown>) =>
  normaliseEventSignup({
    enabled: true,
    signup: {
      token: "tok_abcdefghijklmnop",
      options: [
        { id: "gold", name: "Gold", priceCents: 4500, description: "10 photos" },
        { id: "silver", name: "Silver", priceCents: 3000 },
      ],
      methods: ["cash", "check"],
      open: true,
      ...signup,
    },
  });

// ── The shared module ──

test("the functions copy of the sign-up module matches the app's, below the marker", () => {
  const body = (file: string) => {
    const text = read(file);
    const marker = "// --- shared with functions/src/group-events/signup.ts ---";
    assert.ok(text.includes(marker), `${file} has the marker`);
    return text.slice(text.indexOf(marker));
  };
  assert.equal(body("functions/src/group-events/signup.ts"), body("features/group-events/signup.ts"));
});

test("a way to pay the studio can't be paid by is never offered", () => {
  const config = configured({ methods: ["cash", "venmo", "zelle", "pay_link"] });
  assert.deepEqual(config.methods, ["cash"], "Venmo, Zelle and a pay link need their handle or link");
  const full = configured({
    methods: ["venmo", "zelle", "pay_link", "nonsense"],
    venmoHandle: "https://venmo.com/u/GR-Productions",
    zelleTo: "pay@gr.example",
    payLinkUrl: "https://square.link/u/abc",
  });
  assert.deepEqual(full.methods, ["venmo", "zelle", "pay_link"]);
  assert.equal(full.venmoHandle, "GR-Productions");
  assert.equal(configured({ methods: ["pay_link"], payLinkUrl: "http://insecure.example" }).payLinkUrl, null);
  assert.equal(normaliseVenmoHandle("@Bad Handle!"), null);
});

test("sign-up is open only when set up, switched on, before it closes and under the limit", () => {
  const now = "2026-10-10T12:00:00.000Z";
  assert.equal(signupState(normaliseEventSignup(null), now, 0), "not_set_up");
  assert.equal(signupState(configured({ open: false }), now, 0), "closed");
  assert.equal(signupState(configured({ closesAt: "2026-10-10T11:59:00.000Z" }), now, 0), "closed");
  assert.equal(signupState(configured({ capacity: 2 }), now, 2), "full");
  assert.equal(signupState(configured({ capacity: 2 }), now, 1), "open");
  assert.equal(signupState(configured({ options: [] }), now, 0), "not_set_up", "no packages, nothing to sign up for");
});

test("cash and check pay on the day; everything else is still to pay", () => {
  assert.equal(statusForMethod("cash"), "pay_on_day");
  assert.equal(statusForMethod("check"), "pay_on_day");
  assert.equal(statusForMethod("venmo"), "unpaid");
  assert.equal(statusForMethod("pay_link"), "unpaid");
});

test("a parent's sign-up needs their consent, an email and a real package, and keeps no child's details", () => {
  const base = {
    token: "tok_abcdefghijklmnop",
    parentName: "Dana Reyes",
    email: "Dana@Example.com ",
    athleteName: "Mia",
    optionId: "gold",
    method: "cash",
    consent: true,
  };
  const parsed = eventSignupInputSchema.parse(base);
  assert.equal(parsed.email, "dana@example.com");
  assert.equal(eventSignupInputSchema.safeParse({ ...base, consent: false }).success, false);
  assert.equal(eventSignupInputSchema.safeParse({ ...base, email: "" }).success, false);
  assert.equal(eventSignupInputSchema.safeParse({ ...base, method: "bitcoin" }).success, false);
  // The minors rule from Phase 1: the athlete is a name and a team.
  const shape = Object.keys(eventSignupInputSchema.shape);
  for (const field of shape) assert.doesNotMatch(field, /birth|dob|age|athleteEmail|athletePhone/i);
});

test("settings that would offer a way to pay with nowhere to pay are refused, each with its own reason", () => {
  const settings = (patch: Record<string, unknown>) =>
    eventSignupSettingsSchema.parse({
      options: [{ id: "a", name: "Digital", priceCents: 4500 }],
      methods: ["cash"],
      open: true,
      ...patch,
    });
  assert.equal(eventSignupSettingsProblem(settings({})), null);
  assert.equal(eventSignupSettingsProblem(settings({ methods: ["venmo"] })), "EVENT_VENMO_HANDLE_REQUIRED");
  assert.equal(eventSignupSettingsProblem(settings({ methods: ["zelle"] })), "EVENT_ZELLE_REQUIRED");
  assert.equal(eventSignupSettingsProblem(settings({ methods: ["pay_link"], payLinkUrl: "nope" })), "EVENT_PAY_LINK_INVALID");
  assert.equal(
    eventSignupSettingsProblem(settings({ options: [{ id: "a", name: "A", priceCents: 1 }, { id: "a", name: "B", priceCents: 2 }] })),
    "EVENT_OPTIONS_INVALID",
  );
  assert.equal(eventSignupSettingsSchema.safeParse({ options: [], methods: ["cash"], open: true }).success, false);
  const friendly = read("lib/ai/friendly-error.ts");
  for (const code of ["EVENT_VENMO_HANDLE_REQUIRED", "EVENT_ZELLE_REQUIRED", "EVENT_PAY_LINK_INVALID", "EVENT_OPTIONS_INVALID", "EVENT_CLOSES_AT_INVALID", "EVENT_SIGNUP_NOT_SET_UP", "EVENT_SIGNUP_CLOSED"])
    assert.match(friendly, new RegExp(`${code}:`), code);
});

test("Venmo opens to the studio with the amount and the athlete; the text is the studio's own to send", () => {
  const url = new URL(venmoPayUrl("GR-Productions", 4500, "Mia — Gold"));
  assert.equal(url.pathname, "/GR-Productions");
  assert.equal(url.searchParams.get("txn"), "pay");
  assert.equal(url.searchParams.get("amount"), "45.00");
  assert.equal(url.searchParams.get("note"), "Mia — Gold");
  const message = signupTextMessage({ studioName: "GR", eventName: "Spring Cheer", url: "https://studio-cue.com/e/x" });
  assert.match(message, /https:\/\/studio-cue\.com\/e\/x$/);
  assert.match(smsHref(message), /^sms:\?&body=/);
  assert.equal(eventPrice(4500), "$45");
  assert.equal(eventPrice(4550), "$45.50");
});

test("how to pay says where the money goes, for every method", () => {
  const config = { venmoHandle: "GR", zelleTo: "pay@gr.example", checkPayableTo: "GR Productions LLC" };
  assert.match(howToPay("cash", config, "GR"), /cash at the event/);
  // The screen and the email say to show the number; this sentence doesn't repeat it.
  for (const method of ["cash", "check", "venmo", "zelle", "pay_link"] as const)
    assert.doesNotMatch(howToPay(method, config, "GR"), /confirmation number/i, method);
  assert.match(howToPay("check", config, "GR"), /payable to GR Productions LLC/);
  assert.match(howToPay("venmo", config, "GR"), /@GR on Venmo/);
  assert.match(howToPay("zelle", config, "GR"), /Zelle to pay@gr\.example/);
  assert.match(howToPay("pay_link", config, "GR"), /online/);
});

test("a confirmation number is six characters with no look-alikes", () => {
  const code = confirmationCodeFrom(new Uint8Array([0, 1, 2, 250, 255, 31]));
  assert.equal(code.length, 6);
  for (const character of code) assert.ok(CONFIRMATION_ALPHABET.includes(character));
  assert.doesNotMatch(CONFIRMATION_ALPHABET, /[01IO]/);
});

test("a pasted list of parents becomes emails, once each", () => {
  const { emails, rejected } = emailsFrom("Dana@example.com, sam@example.com\n<dana@example.com>; nope\tlee@example.org");
  assert.deepEqual(emails, ["dana@example.com", "sam@example.com", "lee@example.org"]);
  assert.deepEqual(rejected, ["nope"]);
});

// ── The public route ──

test("the public route checks the browser, limits the rate, catches bots and takes nothing on trust", () => {
  const route = read("app/api/public/event-signup/route.ts");
  assert.match(route, /if \(process\.env\.NEXT_PUBLIC_USE_FIREBASE_EMULATORS !== "true"\)[\s\S]*adminAppCheck\.verifyToken/);
  assert.match(route, /withinRateLimit\(request, linkId\)/);
  assert.match(route, /if \(input\.website\) return/);
  // The link is looked up by its hash, and must be the event's current one.
  assert.match(route, /eventSignupLinks\/\$\{linkId\}/);
  assert.match(route, /if \(config\.token !== token\) return \{ error: "EVENT_LINK_RETIRED"/);
  // The price and the package are the studio's, never what the browser sent.
  assert.match(route, /amountCents: option\.priceCents,/);
  assert.doesNotMatch(route, /input\.(amountCents|priceCents|price)\b/);
  assert.match(route, /if \(!config\.methods\.includes\(input\.method\)\)/);
  // Capacity and a repeat are checked inside the transaction that creates the sign-up.
  const transaction = route.slice(route.indexOf("adminFirestore.runTransaction(async (transaction) => {\n    const roster"));
  assert.match(transaction, /const repeat = live\.find/);
  assert.match(transaction, /signupState\(config, now, live\.length\)/);
  assert.match(transaction, /transaction\.create\(reference, record\)/);
});

test("the parent's confirmation goes to them alone and links their own order", () => {
  const route = read("app/api/public/event-signup/route.ts");
  const job = route.slice(route.indexOf("emailJobs/group_signup_"), route.indexOf("const auditId"));
  assert.match(job, /type: "group_signup_confirmation"/);
  assert.match(job, /soleRecipient: true/);
  assert.match(job, /audience: "parent"/);
  assert.match(job, /actionUrl: orderUrl/);
});

test("the sign-up page is private: never indexed, and order pages survive a new event link", () => {
  assert.match(read("app/robots.ts"), /"\/e\/",/);
  assert.match(read("app/e/[token]/page.tsx"), /robots: \{ index: false, follow: false \}/);
  assert.match(read("app/e/order/[orderToken]/page.tsx"), /robots: \{ index: false, follow: false \}/);
  const route = read("app/api/public/event-signup/route.ts");
  // An order is found by its own token, not through the event's link.
  assert.match(route, /if \(orderToken\) return orderResponse\(orderToken\);/);
  assert.match(route, /where\("orderToken", "==", orderToken\)/);
});

// ── The studio's commands ──

test("sign-up settings, a new link and invites go through crmCommand, checked, audited and receipted", () => {
  const crm = read("functions/src/crm/commands.ts");
  for (const type of ["setGroupEventSignup", "resetGroupEventLink", "inviteGroupEventParents"]) {
    assert.match(crm, new RegExp(`type: z\\.literal\\("${type}"\\)`), type);
  }
  const settings = crm.slice(crm.indexOf('if (command.type === "setGroupEventSignup" || command.type === "resetGroupEventLink")'));
  const settingsBody = settings.slice(0, settings.indexOf("return output;"));
  assert.match(settingsBody, /hasProjectAccess\(membershipData, command\.input\.projectId\)/);
  assert.match(settingsBody, /eventSignupSettingsProblem\(settings\)/);
  assert.match(settingsBody, /status: "revoked"/, "a new link retires the old one");
  assert.match(settingsBody, /participantAudit\(/);
  assert.match(settingsBody, /transaction\.create\(commandReference/);
  const invite = crm.slice(crm.indexOf('if (command.type === "inviteGroupEventParents")'));
  const inviteBody = invite.slice(0, invite.indexOf("return output;"));
  assert.match(inviteBody, /hasProjectAccess\(membershipData, command\.input\.projectId\)/);
  assert.match(inviteBody, /if \(existing\[index\]!\.exists\) return;/, "nobody is emailed the same link twice");
  assert.match(inviteBody, /soleRecipient: true,\s*audience: "parent"/);
  // Turning the roster on or off keeps the sign-up settings.
  const setGroupEvent = crm.slice(crm.indexOf('if (command.type === "setGroupEvent")'));
  assert.match(setGroupEvent.slice(0, setGroupEvent.indexOf("return output;")), /"groupEvent\.enabled": command\.input\.enabled/);
});

test("crew on the event take payment at the field, and do nothing else through crmCommand", () => {
  const crm = read("functions/src/crm/commands.ts");
  assert.match(crm, /const fieldCrewCommands: readonly string\[\] = \["recordParticipantPayment"\];/);
  assert.match(crm, /fieldCrewRoles\.includes\(membershipData\.role\) && fieldCrewCommands\.includes\(command\.type\)/);
  const rules = read("firestore.rules");
  const block = rules.slice(rules.indexOf("match /eventParticipants/{participantId}"), rules.indexOf("match /crewMessages/{messageId}"));
  assert.match(block, /"subcontractor"\]\)\s*&& isAssignedToProject/);
  assert.doesNotMatch(block, /"client"/, "the organiser never reads the roster");
  assert.match(read("components/crew/kit/crew-job.tsx"), /href=\{`\/crew\/field\?project=/);
});

test("a receipt links the parent's own order, never the job's client home", () => {
  const crm = read("functions/src/crm/commands.ts");
  const receipt = crm.slice(crm.indexOf('type: "participant_receipt"') - 400, crm.indexOf('type: "participant_receipt"') + 900);
  assert.match(receipt, /audience: "parent"/);
  assert.match(receipt, /\/e\/order\/\$\{orderToken\}/);
  // The render worker gives parent mail no fallback to the organiser's portal or inquiry page.
  const jobs = read("functions/src/operations/jobs.ts");
  assert.match(jobs, /const parentMail = document\.get\("audience"\) === "parent";/);
  assert.match(jobs, /let clientHome = projectId && !parentMail \?/);
  assert.match(jobs, /const homeLeadId = parentMail \? null :/);
  assert.match(jobs, /\["crew", "vendor", "parent"\]\.includes/);
});

// ── The emails ──

test("the invite names the event and the studio, and its button is the sign-up link", () => {
  const rendered = renderEmailTemplate({
    key: "group_event_invite",
    brand,
    recipientName: null,
    projectName: "Spring Cheer Classic",
    values: { actionUrl: "https://studio-cue.com/e/tok", priceFrom: "$30", optionCount: 2, eventDate: "2026-11-07" },
  });
  assert.match(rendered.subject, /Sign up for Spring Cheer Classic with GR Productions/);
  assert.match(rendered.text, /one of two packages \(from \$30\)/);
  assert.match(rendered.text, /November 7, 2026/);
  assert.match(rendered.html, /href="https:\/\/studio-cue\.com\/e\/tok"/);
  assert.doesNotMatch(rendered.text, /wedding|couple/i);
});

test("the confirmation leads with Venmo when that's how they'll pay, and always links their order", () => {
  const values = {
    athleteName: "Mia",
    packageName: "Gold",
    amountText: "$45",
    confirmationCode: "K7QX2M",
    howToPay: "Pay @GR on Venmo. Put the athlete's name in the note.",
    actionUrl: "https://studio-cue.com/e/order/abc",
  };
  const venmo = renderEmailTemplate({
    key: "group_signup_confirmation",
    brand,
    recipientName: "Dana Reyes",
    projectName: "Spring Cheer Classic",
    values: { ...values, chosenMethod: "venmo", payUrl: "https://venmo.com/GR?txn=pay&amount=45.00" },
  });
  assert.match(venmo.subject, /You're signed up for Spring Cheer Classic/);
  assert.match(venmo.text, /K7QX2M/);
  assert.match(venmo.html, />Pay \$45 on Venmo</);
  assert.match(venmo.html, /href="https:\/\/studio-cue\.com\/e\/order\/abc"/);
  const cash = renderEmailTemplate({
    key: "group_signup_confirmation",
    brand,
    recipientName: "Dana Reyes",
    projectName: "Spring Cheer Classic",
    values: { ...values, chosenMethod: "cash", howToPay: "Pay GR Productions in cash at the event." },
  });
  assert.match(cash.html, />See your order</);
  assert.doesNotMatch(cash.html, /venmo/i);
});

test("the receipt links the parent's order when it has one", () => {
  const rendered = renderEmailTemplate({
    key: "participant_receipt",
    brand,
    recipientName: "Dana Reyes",
    projectName: "Spring Cheer Classic",
    values: { amountText: "$45.00", methodText: "in cash", athleteName: "Mia", packageName: "Gold", actionUrl: "https://studio-cue.com/e/order/abc" },
  });
  assert.match(rendered.html, /href="https:\/\/studio-cue\.com\/e\/order\/abc"/);
});

test("parent emails are client mail, listed for the studio, and a confirmation still arrives if billing lapses", () => {
  for (const key of ["group_event_invite", "group_signup_confirmation"]) {
    assert.ok(CLIENT_EMAIL_TYPES.has(key), key);
    assert.ok(EDITABLE_EMAILS.some((entry) => entry.key === key), `${key} is in the catalog`);
  }
  assert.equal(billingHoldApplies("emailJobs", "group_signup_confirmation"), false, "the parent just signed up");
  assert.equal(billingHoldApplies("emailJobs", "group_event_invite"), true, "outreach waits while billing is held");
});

// ── Data handling ──

test("sign-up links are server-only, exported, erased and purged with the job", () => {
  const rules = read("firestore.rules");
  assert.match(rules, /match \/eventSignupLinks\/\{linkId\} \{\s*allow read, write: if false;/);
  assert.match(read("functions/src/saas/data-lifecycle.ts"), /"eventSignupLinks",/);
  for (const file of ["functions/src/projects/purge-policy.ts", "features/projects/purge-policy.ts"])
    assert.match(read(file), /eventSignupLinks: \{ one: "sign-up link", many: "sign-up links" \}/, file);
});

test("only the sign prints on its page; every other page prints as before", () => {
  const css = read("app/globals.css");
  assert.match(css, /body:has\(\.event-sign\) \*\{visibility:hidden\}/);
  assert.doesNotMatch(css, /@media print\{\s*body \*\{visibility:hidden\}/);
});
