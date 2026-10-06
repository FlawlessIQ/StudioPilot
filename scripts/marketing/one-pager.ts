/**
 * Cue's job description as a one-page PDF, for Gabe to hand to other vendors
 * (app/office-manager/one-pager, docs/positioning-office-manager-plan-2026-10-06.md).
 *
 *   npx tsx scripts/marketing/one-pager.ts                       # from studio-cue.com
 *   npx tsx scripts/marketing/one-pager.ts http://localhost:3001  # from a local build
 *
 * Writes marketing-out/cue-one-pager.pdf (not committed).
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const base = (process.argv[2] ?? "https://studio-cue.com").replace(/\/$/, "");
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "marketing-out");
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 816, height: 1056 } });
await page.goto(`${base}/office-manager/one-pager`, { waitUntil: "networkidle" });
await page.emulateMedia({ media: "print" });
const file = path.join(out, "cue-one-pager.pdf");
await page.pdf({ path: file, format: "Letter", printBackground: true, margin: { top: "0", bottom: "0", left: "0", right: "0" } });
const pages = await page.evaluate(() => Math.ceil(document.documentElement.scrollHeight / 1056));
await browser.close();
console.log(`${file} (${pages === 1 ? "one page" : `${pages} pages: tighten the sheet`})`);
