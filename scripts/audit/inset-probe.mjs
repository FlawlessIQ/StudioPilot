// Focused inset probe: the routes that host the eight no-padding candidates,
// plus the settings page the fix landed on. Unbuffered, one line per route.
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const BASE = process.argv[2] ?? "http://localhost:3100";
const ROUTES = process.argv.slice(3);
const detector = readFileSync("scripts/audit/container-inset.js", "utf8");

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8").split("\n")
    .map((l) => l.split("="))
    .filter((p) => p.length >= 2)
    .map(([k, ...v]) => [k.trim(), v.join("=").trim()]),
);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
await page.goto(`${BASE}/auth/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.locator("input[type=email]").first().fill("owner@studiohub.test");
await page.locator("input[type=password]").first().fill(env.SEED_DEMO_PASSWORD);
await page.locator("button[type=submit]").first().click();
await page.waitForTimeout(8000);
process.stdout.write("signed in\n");

for (const route of ROUTES) {
  try {
    await page.goto(BASE + route, { waitUntil: "domcontentloaded", timeout: 25000 });
  } catch {}
  const ok = await page.waitForFunction(
    () => {
      const t = document.body?.innerText ?? "";
      if (/Checking your secure studio access|Opening your workspace/.test(t)) return false;
      return Boolean(document.querySelector(".panel, .ds-card, .client-booking-page, .crew-mobile-page"))
        || /Nothing|No /i.test(t);
    }, { timeout: 60000 }).then(() => true).catch(() => false);
  if (!ok) { process.stdout.write(`${route}  NEVER RENDERED\n`); continue; }
  await page.evaluate(() => { for (const d of document.querySelectorAll("details")) d.open = true; });
  await page.waitForTimeout(500);
  const r = await page.evaluate(detector);
  const flush = r.findings.filter((f) => f.kind === "flush");
  if (!flush.length) { process.stdout.write(`${route}  clean\n`); continue; }
  process.stdout.write(`${route}\n`);
  for (const f of flush) {
    process.stdout.write(`   .${f.container.split(/\s+/).join(".")} — ${f.child} ${f.gap}px from ${f.side}  "${f.text}"\n`);
  }
}
await browser.close();
