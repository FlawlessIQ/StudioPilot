import { chromium } from "playwright";
import { readFileSync } from "node:fs";
const BASE = process.argv[2], ROUTE = process.argv[3], SEL = process.argv[4], WHO = process.argv[5] ?? "owner";
const env = Object.fromEntries(readFileSync(".env.local","utf8").split("\n").map(l=>l.split("=")).filter(p=>p.length>=2).map(([k,...v])=>[k.trim(),v.join("=").trim()]));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
await page.goto(`${BASE}/auth/login`, { waitUntil: "domcontentloaded" });
await page.locator("input[type=email]").first().fill(WHO === "crew" ? "crew@studiohub.test" : "owner@studiohub.test");
await page.locator("input[type=password]").first().fill(env.SEED_DEMO_PASSWORD);
await page.locator("button[type=submit]").first().click();
await page.waitForTimeout(9000);
await page.goto(BASE + ROUTE, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(6000);
const out = await page.evaluate((sel) => {
  const el = document.querySelector(sel);
  if (!el) return { error: "not found", body: document.body.innerText.slice(0, 120) };
  const cs = getComputedStyle(el), r = el.getBoundingClientRect();
  const kid = el.querySelector(".eyebrow, label, small, strong");
  const kr = kid?.getBoundingClientRect();
  return {
    padding: cs.padding, width: Math.round(r.width),
    sheets: document.styleSheets.length,
    links: document.querySelectorAll('link[rel="stylesheet"]').length,
    panelInset: getComputedStyle(document.documentElement).getPropertyValue("--panel-inset"),
    kid: kid ? `${kid.tagName}.${String(kid.className).split(" ")[0]} leftGap=${Math.round(kr.left - r.left)}` : "none",
  };
}, SEL);
console.log(JSON.stringify(out, null, 1));
await browser.close();
