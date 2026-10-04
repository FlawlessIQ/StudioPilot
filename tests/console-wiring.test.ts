import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { consoleHandlers } from "../functions/src/console/handlers/index.ts";
import { CONSOLE_CAPABILITIES } from "../functions/src/console/roles.ts";
import { CONSOLE_FEATURES, featureOnFor } from "../functions/src/console/features.ts";
import { confirmsName } from "../functions/src/console/handlers/studios.ts";
import { normaliseTag } from "../functions/src/console/handlers/crm.ts";
import { safeActionUrl } from "../functions/src/console/studio-owner.ts";
import { feedbackIdFromReplyToken, feedbackReplyAddress, feedbackTokenFromRecipients } from "../functions/src/feedback/reply-address.ts";
import { TEAM_EMAIL_TYPES, emailTemplateKeys, isPlatformEmailType, renderEmailTemplate } from "../functions/src/communications/email-templates.ts";
import { FEATURE_CATALOG } from "../features/console/feature-catalog.ts";
import { CONSOLE_NAV } from "../components/console/nav.ts";

/**
 * The Console's wiring (docs/console.md): every command names a real
 * capability and is dispatched through the one audited endpoint; every page in
 * the rail exists; old addresses still land; the rules keep the team's records
 * the team's; and the deploy lists know about the new scheduler.
 */
const read = (path: string) => readFileSync(path, "utf8");

test("every Console command names a capability the role table defines", () => {
  const types = Object.keys(consoleHandlers);
  assert.ok(types.length >= 40, `only ${types.length} commands registered`);
  for (const [type, handler] of Object.entries(consoleHandlers)) {
    assert.ok(handler.capability in CONSOLE_CAPABILITIES, `${type} needs an unknown capability ${handler.capability}`);
    assert.equal(typeof handler.run, "function", type);
  }
  // The ones that move money, access or data are not for everyone.
  for (const type of ["extendTrial", "setComp", "changePlan", "applyDiscount", "createDiscountCode", "generateCodeBatch"])
    assert.equal(consoleHandlers[type]?.capability === "billing.write" || consoleHandlers[type]?.capability === "codes.write", true, type);
  assert.equal(consoleHandlers.suspendTenant?.capability, "studios.suspend");
  assert.equal(consoleHandlers.approveDeletion?.capability, "deletion.approve");
  assert.equal(consoleHandlers.setConsoleRole?.capability, "admins.manage");
});

test("saasAdminCommand checks the role before it parses or runs anything, and audits every change", () => {
  const source = read("functions/src/saas/admin.ts");
  const role = source.indexOf("roleFromClaims(");
  const capability = source.indexOf("roleCan(role, handler.capability)");
  const parse = source.indexOf("handler.input.parse(");
  const run = source.indexOf("handler.run(");
  assert.ok(role > 0 && role < capability && capability < parse && parse < run, "identity → role → capability → schema → run");
  assert.match(source, /requireAppCheck\(request\)/);
  assert.match(source, /actorType: "platform_admin"/);
  assert.match(source, /reason: audit\.reason \?\? null/);
});

test("a refusal names the field or reason, never a stack", () => {
  const source = read("functions/src/saas/admin.ts");
  assert.match(source, /INVALID_REQUEST:\$\{caught\.issues\[0\]\?\.path\.join\("\."\) \|\| "input"\}/);
});

test("every section in the rail has a page; renamed pages redirect", () => {
  for (const item of CONSOLE_NAV.flatMap((section) => section.items)) {
    const path = item.href === "/platform-admin" ? "app/platform-admin/page.tsx" : `app${item.href}/page.tsx`;
    assert.ok(existsSync(path), `${item.label} → ${path}`);
  }
  for (const [old, now] of [
    ["tenants", "studios"],
    ["users", "people"],
    ["failed-jobs", "jobs"],
    ["feature-flags", "features"],
    ["audit-logs", "audit"],
    ["system-health", "health"],
  ])
    assert.match(read(`app/platform-admin/${old}/page.tsx`), new RegExp(`redirect\\("/platform-admin/${now}"\\)`), old);
  // Team emails already sent link to /platform-admin/feedback?id=…
  assert.match(read("app/platform-admin/feedback/page.tsx"), /\/platform-admin\/inbox\?id=\$\{encodeURIComponent\(id\)\}/);
});

test("the Console's stylesheet is loaded by its layout, after the shared sheets", () => {
  const layout = read("app/platform-admin/layout.tsx");
  assert.ok(layout.indexOf('import "@/app/app-styles";') < layout.indexOf('import "@/app/console.css";'));
  assert.doesNotMatch(read("app/console.css"), /^\s*(body|html|button|input|table)\s*[,{]/m, "no global element rules: everything is under .cx-root");
});

test("the rules keep the team's records read-only and away from studios", () => {
  const rules = read("firestore.rules");
  for (const name of ["consoleStudios", "consolePeople", "consoleNotes", "consoleTasks", "consoleSettings", "consoleMetrics", "consoleReplies", "platformAdmins", "issues", "saasInvoices", "saasDiscounts"]) {
    const block = rules.match(new RegExp(`match /${name}/\\{[^}]+\\} \\{([\\s\\S]*?)\\n    \\}`))?.[1] ?? "";
    assert.match(block, /allow read: if isPlatformAdmin\(\);/, `${name} is read by platform admins only`);
    assert.match(block, /allow write: if false;/, `${name} is written only by Console commands`);
  }
  const messages = rules.match(/match \/feedbackMessages\/\{messageId\} \{([\s\S]*?)\n    \}/)?.[1] ?? "";
  assert.match(messages, /resource\.data\.visibleToSender == true/, "an internal note is never shown to the studio");
  assert.match(messages, /resource\.data\.senderUserId == request\.auth\.uid/);
  // The activity heartbeat may stamp one field and nothing else.
  assert.match(rules, /\.hasOnly\(\["lastActiveAt"\]\)/);
});

test("the new scheduler is exported and listed for invoker binding", () => {
  assert.match(read("functions/src/index.ts"), /export \{ consoleRollupScheduler \} from "\.\/console\/scheduler\.js";/);
  assert.match(read("scripts/configure-production-function-invokers.sh"), /^\s+consolerollupscheduler$/m);
  assert.match(read("app/api/functions/[functionName]/route.ts"), /"saasAdminCommand",/);
});

test("suspension is enforced where every studio command already looks", () => {
  const guard = read("functions/src/saas/entitlement-guard.ts");
  assert.match(guard, /subscription\.get\("suspendedAt"\)[\s\S]*?STUDIO_SUSPENDED/);
  assert.match(read("components/layout/app-shell.tsx"), /workspace\.tenantSuspended/);
});

test("the feature catalog: browser and server agree, and only real gates are listed", () => {
  assert.deepEqual(
    FEATURE_CATALOG.map(({ key, label, requires }) => ({ key, label, requires })),
    CONSOLE_FEATURES.map(({ key, label, requires }) => ({ key, label, requires })),
  );
  assert.match(read("features/contracts/rollout.ts"), /nativeContractSigning/);
  assert.match(read("features/contracts/rollout.ts"), /combinedAgreement/);
  assert.equal(featureOnFor("all", [], "t1"), true);
  assert.equal(featureOnFor("some", ["t1"], "t1"), true);
  assert.equal(featureOnFor("some", ["t1"], "t2"), false);
  assert.equal(featureOnFor("off", ["t1"], "t1"), false);
});

test("Stripe calls from the Console are pinned and scoped to StudioCue", () => {
  const admin = read("functions/src/console/stripe-admin.ts");
  assert.match(admin, /"stripe-version": STRIPE_ADMIN_API_VERSION/);
  const codes = read("functions/src/console/handlers/codes.ts");
  assert.match(codes, /"applies_to\[products\]": products/);
  assert.match(codes, /"metadata\[app\]": STUDIOCUE_METADATA\.app/);
  // A Console discount waiting for a studio's first Checkout replaces the
  // promotion-code field and any code from a link: Stripe takes one discount.
  const checkout = read("functions/src/saas/stripe.ts");
  assert.match(checkout, /params\.delete\("allow_promotion_codes"\);\s*params\.delete\("discounts\[0\]\[promotion_code\]"\);\s*params\.set\("discounts\[0\]\[coupon\]", pendingCoupon\);/);
});

test("typed confirmation, tags and action links are forgiving where they should be and strict where they must be", () => {
  assert.equal(confirmsName("  juniper &   oak ", ["Juniper & Oak"]), true);
  assert.equal(confirmsName("Juniper", ["Juniper & Oak"]), false);
  assert.equal(normaliseTag("  Multi Brand!! "), "multi-brand");
  process.env.NEXT_PUBLIC_APP_URL = "https://studio-cue.com";
  assert.equal(safeActionUrl("/studio/subscription"), "https://studio-cue.com/studio/subscription");
  assert.equal(safeActionUrl("//evil.example/x"), null);
  assert.equal(safeActionUrl("https://evil.example/x"), null);
  assert.equal(safeActionUrl("https://studio-cue.com/studio"), "https://studio-cue.com/studio");
});

test("a feedback reply address round-trips, and an edited one is refused", () => {
  process.env.INBOUND_REPLY_SIGNING_SECRET = "x".repeat(40);
  process.env.SENDGRID_INBOUND_DOMAIN = "inbound.studio-cue.com";
  const id = `fb_${"ab12".repeat(7)}`;
  const address = feedbackReplyAddress(id)!;
  assert.match(address, /^feedback\+[A-Za-z0-9_-]{19}\.[A-Za-z0-9_-]{11}@inbound\.studio-cue\.com$/);
  const token = feedbackTokenFromRecipients(`Studio <${address}>`)!;
  assert.equal(feedbackIdFromReplyToken(token), id);
  const tampered = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;
  assert.equal(feedbackIdFromReplyToken(tampered), null);
  assert.equal(feedbackReplyAddress("fb_seed_0"), null, "only real feedback ids get an address");
  delete process.env.INBOUND_REPLY_SIGNING_SECRET;
  assert.equal(feedbackReplyAddress(id), null, "fails closed without the secret");
  // The dispatcher routes it to the message function.
  assert.match(read("app/api/webhooks/sendgrid/inbound/route.ts"), /feedback\\\+\[A-Za-z0-9_-\]\{19\}/);
});

test("team mail is platform mail, signed by the team", () => {
  const brand = { studioName: "StudioCue", productName: "StudioCue", accentColor: "#35664a", logoUrl: null, contactEmail: null };
  for (const key of TEAM_EMAIL_TYPES) {
    assert.ok((emailTemplateKeys as readonly string[]).includes(key), key);
    assert.equal(isPlatformEmailType(key), true, key);
  }
  const message = renderEmailTemplate({
    key: "platform_message",
    brand,
    recipientName: "Maya Ortiz",
    values: { customSubject: "Checking in", customBody: "Line one.\nLine two.", actionUrl: "https://studio-cue.com/studio/setup", actionLabel: "Setup" },
  });
  assert.equal(message.subject, "Checking in");
  assert.match(message.text, /Hi Maya,/);
  assert.match(message.text, /Line one\.[\s\S]*Line two\.[\s\S]*The StudioCue team/);
  const reply = renderEmailTemplate({ key: "feedback_reply", brand, recipientName: "Morgan Blake", values: { customBody: "Fixed today.", feedbackMessage: "Deposit says $0" } });
  assert.match(reply.text, /Fixed today\.[\s\S]*You wrote: “Deposit says \$0”[\s\S]*The StudioCue team/);
});
