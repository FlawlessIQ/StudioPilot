/**
 * Look at a screen on the how-to stack before writing its video script:
 * a screenshot, plus the visible headings, buttons and links with their
 * exact labels (the targets a script uses).
 *
 *   npx tsx scripts/how-to/probe.ts owner /studio/leads
 *   npx tsx scripts/how-to/probe.ts client /client --phone
 *   npx tsx scripts/how-to/probe.ts owner /studio/projects/abc --click "Booking"
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import path from "node:path";
import { APP, VIEWPORTS } from "./lib/recorder";
import { HOW_TO_HOME } from "./lib/voice";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
  if (match && !process.env[match[1]!]) process.env[match[1]!] = match[2]!.replace(/^["']|["']$/g, "");
}

const [as = "owner", route = "/studio", ...rest] = process.argv.slice(2);
const phone = rest.includes("--phone");
const clickAt = rest.indexOf("--click");
const click = clickAt >= 0 ? rest[clickAt + 1] : undefined;
const emails: Record<string, string> = {
  owner: "owner@studiohub.test",
  client: "client@studiohub.test",
  crew: "crew@studiohub.test",
};
const email = emails[as] ?? as;
const view = VIEWPORTS[phone ? "phone" : "desktop"];

const browser = await chromium.launch({ channel: "chrome" });
const context = await browser.newContext({
  viewport: { width: view.width, height: view.height },
  deviceScaleFactor: 1,
  isMobile: view.mobile,
  hasTouch: view.mobile,
});
const page = await context.newPage();
await page.goto(`${APP}/auth/login`);
await page.locator('input[type="email"]').fill(email);
await page.locator('input[type="password"]').fill(process.env.SEED_DEMO_PASSWORD!);
await page.locator('button[type="submit"]').click();
await page.waitForURL((url) => !url.pathname.startsWith("/auth"), { timeout: 45000 });
await page.goto(`${APP}${route}`);
await page.waitForTimeout(3500);
if (click) {
  await page.getByText(click, { exact: true }).first().click({ force: true });
  await page.waitForTimeout(2500);
}
const shot = path.join(HOW_TO_HOME, "probe.png");
await page.screenshot({ path: shot, fullPage: true });
// A string, not a function: tsx's name-keeping helper (__name) doesn't exist in the page.
const found = await page.evaluate(`(() => {
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden"; };
  const text = (el) => (el.getAttribute("aria-label") || el.innerText || "").replace(/\\s+/g, " ").trim().slice(0, 70);
  const pick = (selector) => [...document.querySelectorAll(selector)].filter(visible).map((el) => {
    const r = el.getBoundingClientRect();
    const cls = typeof el.className === "string" && el.className ? "  ." + el.className.split(" ").slice(0, 2).join(".") : "";
    return text(el) + "  @" + Math.round(r.x) + "," + Math.round(r.y + scrollY) + cls;
  });
  return { url: location.pathname + location.search, headings: pick("h1, h2, h3, legend, .eyebrow, .kit-eyebrow"),
    buttons: pick("button, [role=button]"), links: pick("a[href]").slice(0, 60) };
})()`);
console.log(JSON.stringify(found, null, 1));
console.log(`screenshot: ${shot}`);
await browser.close();
