/**
 * The payment plan's screens, in a real browser against the emulator walk
 * (scripts/uat/payment-plan-walk.mts): the package's plan, the proposal
 * composer's plan editor, the draft, Today, and the client's schedule —
 * screenshots at desk and phone width. Emulator only.
 *
 *   APP=http://localhost:3100 OUT=/tmp/plan-shots npx tsx scripts/uat/payment-plan-screens.mts <step>
 *   steps: package | compose | draft | today | client | invoices
 */
import { chromium, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

const APP = process.env.APP ?? "http://localhost:3100";
if (!/^http:\/\/(localhost|127\.0\.0\.1):/.test(APP)) throw new Error("Emulator walk only: APP must be a local server.");
const OUT = process.env.OUT ?? "/tmp/plan-shots";
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "";
mkdirSync(OUT, { recursive: true });
const step = process.argv[2] ?? "compose";
const JOB = "plan-job";

async function signIn(page: Page, email: string) {
  await page.goto(`${APP}/auth/login`);
  await page.getByLabel("Email address").first().fill(email);
  await page.getByPlaceholder("Enter your password").fill(PASSWORD);
  await page.locator("button.sign-in-submit").click();
  await page.waitForURL((url) => !url.pathname.startsWith("/auth"), { timeout: 45000 });
  await page.waitForLoadState("networkidle").catch(() => undefined);
}

const shot = async (page: Page, name: string, target?: string) => {
  const path = `${OUT}/${name}.png`;
  if (target) await page.locator(target).first().screenshot({ path });
  else await page.screenshot({ path, fullPage: false });
  console.log("shot", path);
};

const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome" });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: "America/New_York" });
const page = await context.newPage();
// A dev server compiles each route on its first visit.
page.setDefaultNavigationTimeout(240000);
page.setDefaultTimeout(120000);
page.on("pageerror", (error) => console.log("pageerror", error.message.slice(0, 200)));

if (step === "package") {
  await signIn(page, "owner@studiohub.test");
  await page.goto(`${APP}/studio/packages/signature-wedding`);
  const plan = page.getByLabel("Payment plan");
  await plan.waitFor({ timeout: 45000 });
  await plan.selectOption("3");
  await page.getByRole("button", { name: "Save package" }).click();
  await page.getByText(/^Saved\./).first().waitFor({ timeout: 180000 }).catch(() => undefined);
  console.log("notice:", (await page.locator(".form-error, .form-notice, [role=status], [role=alert]").allInnerTexts()).join(" | ").slice(0, 300));
  await plan.scrollIntoViewIfNeeded();
  await shot(page, "1-package-plan-1280");
} else if (step === "compose") {
  await signIn(page, "owner@studiohub.test");
  await page.goto(`${APP}/studio/proposals/new?project=${JOB}`);
  await page.waitForLoadState("networkidle").catch(() => undefined);
  // Lock the package when the job has none yet.
  const lock = page.getByRole("button", { name: "Lock this package" }).first();
  if (await lock.isVisible().catch(() => false)) {
    await lock.click();
    await page.waitForTimeout(4000);
  }
  const editor = page.locator(".payment-plan-editor");
  await page.waitForTimeout(3000);
  await shot(page, "2-composer-arrival-1280");
  await editor.waitFor({ timeout: 180000 });
  await page.waitForTimeout(1500);
  await editor.scrollIntoViewIfNeeded();
  await shot(page, "2-composer-plan-default-1280", ".proposal-composer-section:has(.payment-plan-editor)");
  // The deposit due tomorrow, and the first installment moved up so it bills now (today + 8).
  const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
  await page.getByLabel(/Retainer due|Deposit due/).fill(day(1));
  await page.getByLabel("Installment 1 due").fill(day(8));
  await page.waitForTimeout(500);
  await shot(page, "3-composer-plan-edited-1280", ".proposal-composer-section:has(.payment-plan-editor)");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(800);
  await editor.scrollIntoViewIfNeeded();
  await shot(page, "4-composer-plan-edited-390", ".payment-plan-editor");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("button", { name: "Create draft" }).click();
  await page.waitForURL(/\/studio\/proposals\/(?!new)/, { timeout: 45000 });
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.waitForTimeout(2500);
  console.log("draft at", page.url());
  await page.locator(".payment-plan-editor").first().scrollIntoViewIfNeeded().catch(() => undefined);
  await shot(page, "5-draft-plan-1280");
} else if (step === "today") {
  await signIn(page, "owner@studiohub.test");
  await page.goto(`${APP}/studio`);
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.waitForTimeout(3000);
  const card = page.locator(".today-card", { hasText: /installment/i }).first();
  console.log("installment card:", (await card.innerText().catch(() => "none")).replace(/\s+/g, " ").slice(0, 300));
  await card.scrollIntoViewIfNeeded().catch(() => undefined);
  await shot(page, "6-today-installment-1280");
  if (process.env.PRESS === "send") {
    await card.getByRole("button", { name: /Send installment|Create the installment/ }).click();
    const confirm = page.getByRole("button", { name: /Send the .* bill/ });
    if (await confirm.isVisible().catch(() => false)) await confirm.click();
    await page.waitForTimeout(4000);
    console.log("after send:", (await page.locator(".today-card", { hasText: /installment/i }).first().innerText().catch(() => "gone")).replace(/\s+/g, " ").slice(0, 300));
    await shot(page, "7-today-after-send-1280");
  }
} else if (step === "client") {
  await signIn(page, "plan-couple@studiohub.test");
  await page.goto(`${APP}/client/payments`);
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.waitForTimeout(3000);
  console.log(((await page.locator("main").first().innerText().catch(() => "")) || "").replace(/\s+/g, " ").slice(0, 900));
  await shot(page, "8-client-payments-1280");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(800);
  await page.locator("[aria-label='Payment plan']").first().scrollIntoViewIfNeeded().catch(() => undefined);
  await shot(page, "9-client-payments-390");
  await page.goto(`${APP}/client/proposal`);
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.waitForTimeout(2500);
  await page.getByText("Payment plan").first().scrollIntoViewIfNeeded().catch(() => undefined);
  await shot(page, "10-client-proposal-390");
} else if (step === "invoices") {
  await signIn(page, "owner@studiohub.test");
  await page.goto(`${APP}/studio/invoices?project=${JOB}`);
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.waitForTimeout(3000);
  console.log(((await page.locator("main").first().innerText().catch(() => "")) || "").replace(/\s+/g, " ").slice(0, 1200));
  await shot(page, "11-invoices-1280");
  await page.goto(`${APP}/studio/projects/${JOB}`);
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.waitForTimeout(3000);
  const stepCard = page.getByText(/\d of \d paid/).first();
  await stepCard.scrollIntoViewIfNeeded().catch(() => undefined);
  console.log("journey:", ((await page.locator("body").first().innerText().catch(() => "")) || "").match(/[^\n]{0,80}\d of \d paid[^\n]{0,160}/g));
  await shot(page, "12-job-journey-1280");
}
await browser.close();
