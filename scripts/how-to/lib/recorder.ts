/**
 * Records a how-to script against the how-to stack (scripts/how-to/stack.sh).
 *
 * Capture is a CDP screencast — at a 1440×810 viewport with 2× pixels for
 * the studio, a 390×844 phone at 3× for couples and crew — because it is
 * sharper than Playwright's recordVideo and every frame carries a timestamp
 * (docs/how-to-videos-plan-2026-09-30.md §7). Each step is timestamped as it
 * starts, and held until its narration would end, so the assembler can lay
 * the voice exactly where it belongs.
 *
 * Headless browsers draw no pointer, so an overlay does: a cursor that glides
 * (a touch dot on phones), a pulse on each click, and a spotlight ring on
 * whatever the narration is about.
 */
import { chromium, type CDPSession, type Locator, type Page } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Action, HowToScript, Target } from "./define";

export const APP = process.env.HOW_TO_APP ?? "http://localhost:3100";

const ACCOUNTS = {
  owner: "owner@studiohub.test",
  client: "client@studiohub.test",
  crew: "crew@studiohub.test",
} as const;

export const VIEWPORTS = {
  desktop: { width: 1440, height: 810, scale: 2, mobile: false },
  phone: { width: 390, height: 844, scale: 3, mobile: true },
} as const;

export type Frame = { t: number; file: string };
export type Mark = { step: number; t: number };
export type Recording = { frames: Frame[]; marks: Mark[]; endT: number };

const overlay = (touch: boolean) => `
(() => {
  const TOUCH = ${touch};
  // Cue asks a morning brief on its first visit; in mock mode the answer is a
  // placeholder no video should show.
  try { sessionStorage.setItem('studiohub.copilotAutoBrief', '1'); } catch {}
  const css = document.createElement('style');
  css.textContent = \`
    nextjs-portal, .firebase-emulator-warning { display: none !important; }
    #howto-cursor { position: fixed; z-index: 2147483647; pointer-events: none; left: -100px; top: -100px; }
    #howto-cursor.arrow { width: 22px; height: 22px; transform: translate(-3px,-2px);
      background: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='22' height='22' viewBox='0 0 24 24'><path d='M4 2l15 11-7 1 4 8-3 1-4-8-5 5z' fill='black' stroke='white' stroke-width='1.5'/></svg>") no-repeat; }
    #howto-cursor.touch { width: 34px; height: 34px; margin: -17px 0 0 -17px; border-radius: 50%;
      background: rgba(20,30,24,.18); border: 2px solid rgba(255,255,255,.9); box-shadow: 0 1px 6px rgba(0,0,0,.25); }
    .howto-pulse { position: fixed; z-index: 2147483646; width: 40px; height: 40px; margin: -20px 0 0 -20px; border-radius: 50%;
      border: 3px solid rgba(46,107,75,.85); pointer-events: none; animation: howtoPulse .55s ease-out forwards; }
    @keyframes howtoPulse { from { transform: scale(.35); opacity: 1 } to { transform: scale(1.5); opacity: 0 } }
    .howto-spot { position: fixed; z-index: 2147483645; pointer-events: none; border-radius: 12px;
      box-shadow: 0 0 0 3px rgba(46,107,75,.9), 0 0 0 9px rgba(46,107,75,.18); transition: opacity .35s ease; }
  \`;
  const add = () => {
    document.head.appendChild(css);
    const c = document.createElement('div'); c.id = 'howto-cursor'; c.className = TOUCH ? 'touch' : 'arrow';
    document.body.appendChild(c);
    addEventListener('mousemove', e => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; }, true);
    addEventListener('mousedown', e => {
      // A click often navigates in place; a ring left over would sit on the next page.
      document.querySelectorAll('.howto-spot').forEach(el => el.remove());
      const p = document.createElement('div'); p.className = 'howto-pulse';
      p.style.left = e.clientX + 'px'; p.style.top = e.clientY + 'px';
      document.body.appendChild(p); setTimeout(() => p.remove(), 650);
    }, true);
    window.__howtoSpot = (r, hold) => {
      const s = document.createElement('div'); s.className = 'howto-spot';
      Object.assign(s.style, { left: (r.x - 6) + 'px', top: (r.y - 6) + 'px', width: (r.width + 12) + 'px', height: (r.height + 12) + 'px' });
      document.body.appendChild(s);
      setTimeout(() => { s.style.opacity = '0'; setTimeout(() => s.remove(), 400); }, hold);
    };
  };
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', add); else add();
})();`;

export function card(eyebrow: string | undefined, title: string, subtitle: string | undefined) {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  return `<!doctype html><html><head><style>
    html,body{margin:0;height:100%;background:#1E2521;color:#F4F1EA;font-family:"Helvetica Neue",Helvetica,Arial,sans-serif}
    main{height:100%;display:grid;place-content:center;gap:18px;padding:0 9vw;text-align:left;animation:in .6s ease-out both}
    @keyframes in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
    .e{font-size:clamp(12px,1.3vw,18px);letter-spacing:.16em;text-transform:uppercase;color:#9CC6AA;font-weight:600}
    h1{margin:0;font-family:Georgia,"Times New Roman",serif;font-weight:500;font-size:clamp(34px,5.4vw,76px);line-height:1.04;letter-spacing:-.02em}
    p{margin:0;font-size:clamp(16px,1.8vw,24px);color:#C9D2CB;max-width:34ch;line-height:1.4}
    .m{position:fixed;left:9vw;bottom:7vh;font-size:clamp(14px,1.4vw,20px);letter-spacing:.02em;color:#9CC6AA}
    .m b{color:#F4F1EA;font-weight:600}
  </style></head><body><main>${eyebrow ? `<div class="e">${esc(eyebrow)}</div>` : ""}<h1>${esc(title)}</h1>${
    subtitle ? `<p>${esc(subtitle)}</p>` : ""
  }</main><div class="m"><b>Studio</b>Cue</div></body></html>`;
}

export function locate(page: Page, target: Target): Locator {
  const base =
    "role" in target
      ? page.getByRole(target.role, { name: target.name, exact: target.exact })
      : "text" in target
        ? page.getByText(target.text, { exact: target.exact })
        : page.locator(target.css);
  return base.nth(target.nth ?? 0);
}

class Pointer {
  x: number;
  y: number;
  constructor(private page: Page, width: number, height: number) {
    this.x = width * 0.62;
    this.y = height * 0.58;
  }
  async glide(x: number, y: number) {
    const steps = Math.max(14, Math.min(40, Math.round(Math.hypot(x - this.x, y - this.y) / 22)));
    const from = { x: this.x, y: this.y };
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      await this.page.mouse.move(from.x + (x - from.x) * e, from.y + (y - from.y) * e);
      await this.page.waitForTimeout(14);
    }
    this.x = x;
    this.y = y;
  }
}

async function center(locator: Locator) {
  await locator.scrollIntoViewIfNeeded({ timeout: 15000 });
  const box = await locator.boundingBox();
  if (!box) throw new Error(`Not visible: ${locator}`);
  return { box, x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function run(page: Page, pointer: Pointer, action: Action, still: (page: Page) => Promise<void>) {
  if ("goto" in action) {
    await page.goto(`${APP}${action.goto}`, { waitUntil: "load" });
    await page.waitForTimeout(600);
  } else if ("card" in action) {
    // A fresh document first: setContent on the app's page keeps the app's
    // JavaScript running, which crashes into "This page couldn't load" over
    // the card. And a static card sends the screencast no further frames, so
    // it goes into the video as a real screenshot once it has settled.
    await page.goto("about:blank");
    await page.setContent(card(action.card.eyebrow, action.card.title, action.card.subtitle));
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(700);
    await still(page);
  } else if ("click" in action) {
    const { x, y } = await center(locate(page, action.click));
    await pointer.glide(x, y);
    await page.waitForTimeout(220);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(350);
  } else if ("hover" in action) {
    const { x, y } = await center(locate(page, action.hover));
    await pointer.glide(x, y);
    await page.waitForTimeout(300);
  } else if ("spotlight" in action) {
    const { box } = await center(locate(page, action.spotlight));
    await page.evaluate(
      ([r, hold]) => (window as unknown as { __howtoSpot: (r: object, h: number) => void }).__howtoSpot(r, hold),
      [box, action.holdMs ?? 1800] as const,
    );
    await page.waitForTimeout(250);
  } else if ("scrollTo" in action) {
    await locate(page, action.scrollTo).evaluate((el) => el.scrollIntoView({ behavior: "smooth", block: "center" }));
    await page.waitForTimeout(900);
  } else if ("scrollBy" in action) {
    await page.evaluate((dy) => window.scrollBy({ top: dy, behavior: "smooth" }), action.scrollBy);
    await page.waitForTimeout(900);
  } else if ("type" in action) {
    const { x, y } = await center(locate(page, action.type.into));
    await pointer.glide(x, y);
    await page.mouse.click(x, y);
    await page.keyboard.type(action.type.text, { delay: 45 });
  } else if ("key" in action) {
    await page.keyboard.press(action.key);
    await page.waitForTimeout(300);
  } else if ("waitFor" in action) {
    await locate(page, action.waitFor).waitFor({ state: "visible", timeout: action.timeoutMs ?? 30000 });
  } else if ("wait" in action) {
    await page.waitForTimeout(action.wait);
  }
}

async function signIn(page: Page, as: keyof typeof ACCOUNTS) {
  const password = process.env.SEED_DEMO_PASSWORD;
  if (!password) throw new Error("SEED_DEMO_PASSWORD is not set (it's in .env.local).");
  await page.goto(`${APP}/auth/login`);
  await page.locator('input[type="email"]').fill(ACCOUNTS[as]);
  await page.locator('input[type="password"]').fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((url) => !url.pathname.startsWith("/auth"), { timeout: 45000 });
}

/**
 * Records the script. `holdFor(step)` is how long that step must last — its
 * narration plus a breath — so nothing moves on while the voice is speaking.
 * With `dryRun`, the actions run with no screencast and no holds: a fast
 * check that every target a video relies on still exists.
 */
export async function record(
  script: HowToScript,
  holdFor: (step: number) => number,
  outDir: string,
  { dryRun = false }: { dryRun?: boolean } = {},
): Promise<Recording> {
  const view = VIEWPORTS[script.start.viewport];
  const browser = await chromium.launch({ channel: "chrome" });
  const context = await browser.newContext({
    viewport: { width: view.width, height: view.height },
    deviceScaleFactor: view.scale,
    isMobile: view.mobile,
    hasTouch: view.mobile,
    colorScheme: "light",
    reducedMotion: "no-preference",
  });
  await context.addInitScript(overlay(view.mobile));
  const page = await context.newPage();
  const frames: Frame[] = [];
  const marks: Mark[] = [];
  let cdp: CDPSession | null = null;
  try {
    await signIn(page, script.start.as);
    const pointer = new Pointer(page, view.width, view.height);

    if (!dryRun) {
      const dir = path.join(outDir, "frames");
      mkdirSync(dir, { recursive: true });
      cdp = await context.newCDPSession(page);
      let n = 0;
      cdp.on("Page.screencastFrame", (frame) => {
        const file = path.join(dir, `f${String(n++).padStart(6, "0")}.jpg`);
        writeFileSync(file, Buffer.from(frame.data, "base64"));
        frames.push({ t: frame.metadata.timestamp ?? Date.now() / 1000, file });
        void cdp?.send("Page.screencastFrameAck", { sessionId: frame.sessionId }).catch(() => {});
      });
      await cdp.send("Page.startScreencast", {
        format: "jpeg",
        quality: 92,
        maxWidth: view.width * view.scale,
        maxHeight: view.height * view.scale,
        everyNthFrame: 1,
      });
    }

    let stills = 0;
    const still = async (target: Page) => {
      if (dryRun) return;
      const file = path.join(outDir, "frames", `s${String(stills++).padStart(4, "0")}.jpg`);
      await target.screenshot({ path: file, type: "jpeg", quality: 92 });
      frames.push({ t: Date.now() / 1000, file });
      frames.sort((a, b) => a.t - b.t);
    };

    for (const [index, step] of script.steps.entries()) {
      const started = Date.now() / 1000;
      marks.push({ step: index, t: started });
      for (const action of step.do) {
        try {
          await run(page, pointer, action, still);
        } catch (error) {
          const shot = path.join(outDir, `failed-step-${index}.png`);
          mkdirSync(outDir, { recursive: true });
          await page.screenshot({ path: shot }).catch(() => {});
          throw new Error(`${script.id} step ${index} (${JSON.stringify(action)}): ${(error as Error).message}\n  screenshot: ${shot}`);
        }
      }
      if (!dryRun) {
        const remaining = started + holdFor(index) - Date.now() / 1000;
        if (remaining > 0) await page.waitForTimeout(Math.round(remaining * 1000));
      }
    }
    const endT = Date.now() / 1000;
    if (cdp) await cdp.send("Page.stopScreencast");
    return { frames, marks, endT };
  } finally {
    await browser.close();
  }
}
