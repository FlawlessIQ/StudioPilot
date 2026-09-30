// Phase-3 capture spike (docs/how-to-videos-plan-2026-09-30.md §7): one short
// Today walk. Result: CDP screencast at a 1440×810 viewport, 2× pixels,
// downscaled to 1080p beats Playwright recordVideo on text sharpness and gives
// per-frame timestamps for the audio sync. Run against scripts/how-to/stack.sh.
import { chromium, type Page } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const OUT = process.argv[2]!;
const BASE = "http://localhost:3100";
const W = 1440, H = 810;
mkdirSync(OUT, { recursive: true });

const OVERLAY = `
(() => {
  const css = document.createElement('style');
  css.textContent = \`
    nextjs-portal, .firebase-emulator-warning { display: none !important; }
    #howto-cursor { position: fixed; z-index: 2147483647; width: 22px; height: 22px; pointer-events: none;
      left: 0; top: 0; transform: translate(-3px,-2px); transition: none;
      background: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='22' height='22' viewBox='0 0 24 24'><path d='M4 2l15 11-7 1 4 8-3 1-4-8-5 5z' fill='black' stroke='white' stroke-width='1.5'/></svg>") no-repeat; }
    .howto-pulse { position: fixed; z-index: 2147483646; width: 34px; height: 34px; margin: -17px 0 0 -17px; border-radius: 50%;
      border: 3px solid rgba(46,107,75,.8); pointer-events: none; animation: howtoPulse .5s ease-out forwards; }
    @keyframes howtoPulse { from { transform: scale(.4); opacity: 1 } to { transform: scale(1.4); opacity: 0 } }
  \`;
  const add = () => { document.head.appendChild(css);
    const c = document.createElement('div'); c.id = 'howto-cursor'; document.body.appendChild(c);
    addEventListener('mousemove', e => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; }, true);
    addEventListener('mousedown', e => { const p = document.createElement('div'); p.className = 'howto-pulse';
      p.style.left = e.clientX + 'px'; p.style.top = e.clientY + 'px'; document.body.appendChild(p); setTimeout(() => p.remove(), 600); }, true);
  };
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', add); else add();
})();`;

async function glide(page: Page, x: number, y: number, from: { x: number; y: number }) {
  const steps = 28;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps, e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    await page.mouse.move(from.x + (x - from.x) * e, from.y + (y - from.y) * e);
    await page.waitForTimeout(16);
  }
  return { x, y };
}

async function signIn(page: Page) {
  await page.goto(`${BASE}/auth/login`);
  await page.getByPlaceholder("you@yourstudio.com").fill("owner@studiohub.test");
  await page.getByPlaceholder("Enter your password").fill(process.env.SEED_DEMO_PASSWORD!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/studio/, { timeout: 30000 });
}

async function walk(page: Page) {
  await page.goto(`${BASE}/studio`);
  await page.getByRole("heading", { name: "Prepared for you" }).waitFor({ timeout: 30000 });
  await page.waitForTimeout(1500);
  let at = { x: W / 2, y: H / 2 };
  await page.mouse.move(at.x, at.y);
  const trigger = page.locator(".ds-topbar .how-to-trigger");
  const box = (await trigger.boundingBox())!;
  at = await glide(page, box.x + box.width / 2, box.y + box.height / 2, at);
  await page.waitForTimeout(400);
  await page.mouse.down(); await page.mouse.up();
  await page.waitForTimeout(3000);
  await page.mouse.wheel(0, 500);
  await page.waitForTimeout(2500);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(800);
  const review = page.getByRole("button", { name: "Review" }).first();
  const rb = (await review.boundingBox())!;
  at = await glide(page, rb.x + rb.width / 2, rb.y + rb.height / 2, at);
  await page.waitForTimeout(400);
  await page.mouse.down(); await page.mouse.up();
  await page.waitForTimeout(3500);
}

const browser = await chromium.launch({ channel: "chrome" });

// A) recordVideo
if (process.env.SPIKE_A) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: path.join(OUT, "A"), size: { width: W, height: H } } });
  await ctx.addInitScript(OVERLAY);
  const page = await ctx.newPage();
  await signIn(page);
  await walk(page);
  await ctx.close();
}

// B) CDP screencast
{
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
  await ctx.addInitScript(OVERLAY);
  const page = await ctx.newPage();
  await signIn(page);
  const cdp = await ctx.newCDPSession(page);
  const frames: Array<{ t: number; file: string }> = [];
  mkdirSync(path.join(OUT, "B"), { recursive: true });
  let n = 0;
  cdp.on("Page.screencastFrame", async (f) => {
    const file = path.join(OUT, "B", `f${String(n++).padStart(5, "0")}.jpg`);
    writeFileSync(file, Buffer.from(f.data, "base64"));
    frames.push({ t: f.metadata.timestamp ?? Date.now() / 1000, file });
    await cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 95, maxWidth: W * 2, maxHeight: H * 2, everyNthFrame: 1 });
  await walk(page);
  await cdp.send("Page.stopScreencast");
  frames.push({ t: frames.at(-1)!.t + 0.5, file: frames.at(-1)!.file });
  // concat demuxer with per-frame durations → constant 30 fps
  const list = frames.slice(0, -1).map((f, i) => `file '${f.file}'\nduration ${(frames[i + 1].t - f.t).toFixed(4)}`).join("\n") + `\nfile '${frames.at(-1)!.file}'\n`;
  writeFileSync(path.join(OUT, "B", "list.txt"), list);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", path.join(OUT, "B", "list.txt"),
    "-vf", "fps=30,scale=1920:1080:flags=lanczos,format=yuv420p", "-c:v", "libx264", "-crf", "20", "-preset", "slow", "-movflags", "+faststart", path.join(OUT, "C.mp4")]);
  await ctx.close();
  console.log("B frames", frames.length);
}
await browser.close();
