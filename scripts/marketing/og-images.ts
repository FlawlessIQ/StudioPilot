/**
 * The marketing pages' social cards: public/og/<name>.png, 1200×630, one per
 * page (features/marketing/metadata.ts OG_IMAGES), each a still from the
 * journey film beside the page's own headline in the brand type (Fraunces over
 * Instrument Sans, on the dark green the site closes on).
 *
 *   npx tsx scripts/marketing/og-images.ts            # all of them
 *   npx tsx scripts/marketing/og-images.ts home pricing
 *
 * Stills are cut from the published film with ffmpeg at the times below
 * (STUDIOCUE_FILM, default ~/.cache/studiocue-how-to/published-film/journey.mp4).
 * Each PNG is kept under 300 KB: if Chromium's PNG is bigger it is re-encoded
 * with a 256-colour palette, which the flat UI stills survive untouched.
 * Commit the PNGs; nothing here runs at build time.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import sharp from "sharp";
import { OG_IMAGES, type OgImage } from "../../features/marketing/metadata";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "..", "..", "public", "og");
const FILM =
  process.env.STUDIOCUE_FILM ?? path.join(os.homedir(), ".cache", "studiocue-how-to", "published-film", "journey.mp4");
const MAX_BYTES = 300_000;

/** Each card: the film moment (seconds in), and the page's own words. */
const CARDS: Record<OgImage, { at: number; kicker: string; headline: string }> = {
  home: { at: 116, kicker: "For wedding photographers", headline: "Every wedding, inquiry to album — already prepared." },
  features: { at: 96, kicker: "Features", headline: "Most of what matters is what it refuses to do." },
  pricing: { at: 132, kicker: "Pricing · 14-day trial", headline: "Price the operation, not every client." },
  integrations: { at: 64, kicker: "Integrations", headline: "Keep trusted systems authoritative." },
  "wedding-photographers": { at: 176, kicker: "For wedding photographers", headline: "Be ready for the day no one can reschedule." },
  corporate: { at: 216, kicker: "Corporate photography", headline: "The questions that sink a corporate shoot, asked before the day." },
  sports: { at: 152, kicker: "Sports photography", headline: "Minors, consent and the running order, settled first." },
  "for-crew": { at: 236, kicker: "For your crew", headline: "Your crew stop asking you what time to be there." },
  "for-clients": { at: 184, kicker: "For your clients", headline: "One link, from booking to the gallery." },
  "how-to": { at: 32, kicker: "How to", headline: "How to use StudioCue." },
  "wedding-journey": { at: 328, kicker: "Watch it run", headline: "A wedding, start to finish." },
};

const MARK = `<svg viewBox="0 0 96 96" width="44" height="44"><rect x="8" y="8" width="80" height="80" rx="22" fill="#F4F1E8"/><circle cx="48" cy="48" r="21" fill="none" stroke="#14201B" stroke-width="5.5"/><circle cx="48" cy="48" r="7" fill="#14201B"/><circle cx="71.5" cy="24.5" r="5.5" fill="#C9973D"/></svg>`;

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function html(card: (typeof CARDS)[OgImage], still: string): string {
  const size = card.headline.length > 52 ? 50 : card.headline.length > 36 ? 56 : 64;
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,460&family=Instrument+Sans:wght@500;650&display=block" rel="stylesheet">
<style>
  *{box-sizing:border-box;margin:0}
  body{width:1200px;height:630px;overflow:hidden;background:#14201b;font-family:"Instrument Sans",sans-serif;color:#fff}
  .glow{position:absolute;inset:0;background:radial-gradient(70% 90% at 0% 100%,rgb(201 151 61/22%),transparent 60%),radial-gradient(60% 70% at 100% 0%,rgb(70 199 154/16%),transparent 60%)}
  .copy{position:absolute;left:64px;top:60px;bottom:60px;width:520px;display:flex;flex-direction:column}
  .brand{display:flex;align-items:center;gap:12px;font-weight:650;font-size:24px;letter-spacing:-.01em}
  .kicker{margin-top:auto;color:#cdb98a;font-size:17px;font-weight:650;letter-spacing:.14em;text-transform:uppercase}
  h1{margin-top:18px;font-family:"Fraunces",Georgia,serif;font-weight:460;font-size:${size}px;line-height:1.06;letter-spacing:-.02em}
  .trial{margin-top:26px;color:#9fb0a6;font-size:18px;font-weight:500}
  .shot{position:absolute;left:640px;top:96px;width:760px;height:428px;border-radius:16px;overflow:hidden;
        border:1px solid rgb(255 255 255/14%);box-shadow:0 40px 80px -20px rgb(0 0 0/60%);background:#f4f1e8}
  .shot img{display:block;width:100%;height:100%;object-fit:cover;object-position:left center}
</style></head><body>
<div class="glow"></div>
<div class="copy">
  <div class="brand">${MARK}<span>StudioCue</span></div>
  <div class="kicker">${escape(card.kicker)}</div>
  <h1>${escape(card.headline)}</h1>
  <div class="trial">Prepared for you, approved by you · studio-cue.com</div>
</div>
<div class="shot"><img src="${still}"></div>
</body></html>`;
}

async function main() {
  if (!existsSync(FILM)) throw new Error(`No film at ${FILM}; set STUDIOCUE_FILM.`);
  const wanted = process.argv.slice(2);
  const names = (wanted.length ? wanted : OG_IMAGES) as OgImage[];
  for (const name of names) if (!CARDS[name]) throw new Error(`Unknown card: ${name}`);
  mkdirSync(OUT, { recursive: true });
  const tmp = mkdtempSync(path.join(os.tmpdir(), "og-"));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  try {
    for (const name of names) {
      const card = CARDS[name];
      const frame = path.join(tmp, `${name}.jpg`);
      execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-ss", String(card.at), "-i", FILM, "-frames:v", "1", "-vf", "scale=1520:-2", "-q:v", "3", frame]);
      const still = `data:image/jpeg;base64,${readFileSync(frame).toString("base64")}`;
      await page.setContent(html(card, still), { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      const target = path.join(OUT, `${name}.png`);
      let png = await page.screenshot({ type: "png" });
      if (png.length > MAX_BYTES) png = await sharp(png).png({ palette: true, colors: 256, compressionLevel: 9 }).toBuffer();
      if (png.length > MAX_BYTES) png = await sharp(png).png({ palette: true, colors: 128, compressionLevel: 9 }).toBuffer();
      writeFileSync(target, png);
      const bytes = statSync(target).size;
      console.log(`${name}.png  ${Math.round(bytes / 1024)} KB`);
      if (bytes > MAX_BYTES) throw new Error(`${name}.png is ${bytes} bytes; the budget is ${MAX_BYTES}.`);
    }
  } finally {
    await browser.close();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
