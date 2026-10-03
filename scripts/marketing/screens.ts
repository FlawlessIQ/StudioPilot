/**
 * The marketing site's screenshots, taken from the same wedding as the film
 * (docs/marketing-visuals-plan-2026-10-03.md §3).
 *
 *   scripts/how-to/stack.sh up            # the how-to stack, with journey snapshots
 *   npx tsx scripts/marketing/screens.ts  # every shot → public/marketing/
 *   npx tsx scripts/marketing/screens.ts portal-home crew-day-sheet
 *   npx tsx scripts/marketing/screens.ts --sheet   # also a contact sheet to review
 *
 * Each shot starts from a journey chapter's snapshot (the Harts at that
 * stage), optionally moves the story on, signs in as the studio, Ella or
 * Jordan, opens a screen and crops to the one element the copy talks about.
 * Output: <name>.webp (1×) and <name>@2x.webp, committed. Re-run when the
 * product's screens change, review the sheet, commit.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright";
import type { Action } from "../how-to/lib/define";
import { inbox } from "../how-to/lib/journey-recorder";
import { APP, locate, Pointer, run, signIn } from "../how-to/lib/recorder";
import { HOW_TO_HOME } from "../how-to/lib/voice";
import { latestEmail } from "../how-to/journey/emails";
import { webpSize } from "../../features/marketing/webp-size";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..", "..");
const OUT = path.join(ROOT, "public", "marketing");
const STACK = path.join(ROOT, "scripts", "how-to", "stack.sh");
const SNAPSHOTS = path.join(HOW_TO_HOME, "journey-snapshots");

for (const line of readFileSync(path.join(ROOT, ".env.local"), "utf8").split("\n")) {
  const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
  if (match && !process.env[match[1]!]) process.env[match[1]!] = match[2]!.replace(/^["']|["']$/g, "");
}

type Who = "owner" | "ella.hart@studiohub.test" | "crew";
type Shot = {
  name: string;
  /** The chapter whose end state the shot starts from. */
  after: number;
  /** Story beats to move on from there (scripts/how-to/journey/story.ts). */
  beats?: string[];
  as: Who;
  phone?: boolean;
  route: string;
  actions?: Action[];
  /** CSS of the element(s) to crop to — several make one box around them all; omit for the whole viewport. */
  crop?: string | string[];
  /** Cut the crop off this many CSS px below its top. */
  maxHeight?: number;
  /** Something another person does first, in their own browser (the studio sending an offer). */
  prep?: { as: Who; route: string; actions: Action[] };
  /** Padding around the crop, in CSS px. */
  pad?: number;
  /** Show this captured email in the phone's inbox view instead of a route. */
  email?: { subject: RegExp; to: string };
  /** What the picture shows — becomes its alt text in the site's media list. */
  alt: string;
};

const ELLA = "ella.hart@studiohub.test" as const;

const SHOTS: Shot[] = [
  // ── The studio ──
  {
    name: "today-prepared",
    after: 6,
    beats: ["wedding-in:1", "scheduler:communications/lifecycle-scheduler.ts#lifecycleMessageScheduler"],
    as: "owner",
    route: "/studio",
    actions: [{ waitFor: { css: ".today-card" } }],
    crop: [":text-is('Prepared for you')", ".today-card:has-text('Ella Hart Wedding') >> nth=2"],
    pad: 14,
    alt: "Today in StudioCue: the day-before checklist, final invoice notice and schedule confirmation for Ella & Marcus's wedding, each drafted and waiting for one tap to approve.",
  },
  {
    name: "job-page",
    after: 6,
    as: "owner",
    route: "/studio/projects/{job}",
    actions: [{ waitFor: { css: ".thread-next" } }],
    crop: "main",
    alt: "Ella & Marcus's wedding in StudioCue: where it is in the journey, the next move, and every step ticked off so far.",
  },
  {
    name: "booking-gate",
    after: 3,
    as: "owner",
    route: "/studio/booking?project={job}",
    actions: [{ waitFor: { css: ".booking-progress" } }],
    crop: [".booking-progress", ":text('Booked on') >> nth=-1 >> xpath=ancestor::div[2]"],
    pad: 18,
    alt: "The booking check: contract signed, retainer paid, booking confirmed — StudioCue books a wedding only on real evidence.",
  },
  {
    name: "wedding-week",
    after: 7,
    as: "owner",
    route: "/studio/event-day",
    actions: [{ waitFor: { text: "Run of show" } }],
    crop: [":text-is('Venue') >> xpath=ancestor::*[contains(@class,'card') or self::section][1]", ":text('Dancing and send-off')"],
    pad: 28,
    alt: "The event-day brief for Ella & Marcus's wedding: venue, schedule version, accepted crew, readiness, and the run of show.",
  },
  // ── The couple ──
  { name: "portal-home", after: 5, as: ELLA, phone: true, route: "/client", actions: [{ waitFor: { css: "h1.kit-title" } }], alt: "Ella's wedding portal on her phone: the countdown to the day and what comes next." },
  { name: "portal-proposal", after: 3, as: ELLA, phone: true, route: "/client/proposal", actions: [{ waitFor: { css: "h1.kit-title" } }], alt: "Ella's proposal on her phone: The Signature Collection, what's included, and the payment plan." },
  { name: "portal-agreement", after: 3, as: ELLA, phone: true, route: "/client/contract", actions: [{ waitFor: { css: "h1.kit-title" } }], alt: "Ella's signed wedding photography agreement on her phone." },
  { name: "portal-payment", after: 6, as: ELLA, phone: true, route: "/client/payments", actions: [{ waitFor: { css: "h1.kit-title" } }], alt: "Ella's next payment on her phone: the final balance, its due date, and the retainer already paid." },
  { name: "portal-timeline", after: 6, as: ELLA, phone: true, route: "/client/schedule", actions: [{ waitFor: { css: "h1.kit-title" } }], alt: "Ella's wedding-day timeline on her phone, hour by hour, with where each moment happens." },
  { name: "portal-photos", after: 8, as: ELLA, phone: true, route: "/client/delivery", actions: [{ waitFor: { css: "h1.kit-title" } }], alt: "Ella's photos on her phone: the gallery to open, and when access closes." },
  // ── The crew ──
  {
    name: "crew-offer",
    after: 3,
    prep: {
      as: "owner",
      route: "/studio/projects/{job}",
      actions: [
        { waitFor: { css: ".project-workspace-nav" } },
        { click: { css: ".project-workspace-nav a:has-text('Plan')" } },
        { waitFor: { text: "Crew for this job" } },
        { click: { text: "Crew for this job" } },
        { waitFor: { role: "button", name: "Approve crew plan and start" } },
        { click: { role: "button", name: "Approve crew plan and start" } },
        { wait: 3000 },
      ],
    },
    as: "crew",
    phone: true,
    route: "/crew",
    actions: [
      { waitFor: { css: ".kit-title" } },
      { click: { css: "section[aria-label='Needs you'] a:has-text('Ella Hart')" } },
      { waitFor: { role: "button", name: "Accept", exact: true } },
      { wait: 800 },
    ],
    alt: "The offer Jordan gets on their phone for Ella & Marcus's wedding: date, times, place, fee, what they'd do, and Accept.",
  },
  {
    name: "crew-day-sheet",
    after: 6,
    as: "crew",
    phone: true,
    route: "/crew/jobs",
    actions: [
      { waitFor: { css: "h1.kit-title" } },
      { click: { text: "Ella Hart Wedding" } },
      { waitFor: { text: "Day sheet", exact: true } },
      { click: { text: "Day sheet", exact: true } },
      { waitFor: { text: "READ BEFORE YOU SHOOT" } },
      { wait: 800 },
    ],
    alt: "Jordan's day sheet on their phone: first up, where to be, who to call, and what to handle carefully.",
  },
  { name: "crew-reminder", after: 7, as: "crew", phone: true, route: "", email: { subject: /Reminder/i, to: "crew@studiohub.test" }, alt: "The call-time reminder Jordan gets two days before the wedding, with a link to the day sheet." },
  { name: "crew-hours", after: 7, beats: ["wedding-in:-1"], as: "crew", phone: true, route: "/crew/closeout", actions: [{ waitFor: { role: "button", name: "Send to the studio" } }], alt: "Jordan's hours and expenses after the wedding, sent to the studio from their phone." },
];

const HIDE = `
  nextjs-portal, .firebase-emulator-warning, .feedback-fab, [class*="feedback-fab"] { display: none !important; }
  *, *::before, *::after { caret-color: transparent !important; }
`;

async function shoot(shot: Shot, page: Page, resolvePath: (p: string) => Promise<string>) {
  if (shot.email) {
    const email = latestEmail(shot.email.subject, shot.email.to);
    if (!email) throw new Error(`${shot.name}: no email matching ${shot.email.subject}.`);
    await page.goto("about:blank");
    await page.setContent(inbox(email));
  } else {
    await page.goto(`${APP}${await resolvePath(shot.route)}`, { waitUntil: "load" });
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
    await page
      .waitForFunction(() => !/Opening your|Catching up|Loading…/.test(document.body?.innerText ?? ""), null, { timeout: 15000 })
      .catch(() => {});
    const pointer = new Pointer(page, 1, 1);
    for (const action of shot.actions ?? []) await run(page, pointer, action, async () => {}, () => {});
  }
  await page.addStyleTag({ content: HIDE });
  await page.mouse.move(-10, -10);
  await page.waitForTimeout(900);
  const file = path.join(OUT, `${shot.name}@2x.png`);
  if (shot.crop) {
    const selectors = Array.isArray(shot.crop) ? shot.crop : [shot.crop];
    const first = locate(page, { css: selectors[0]! });
    await first.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(400);
    const scroll = await page.evaluate(() => scrollY);
    const boxes = [];
    for (const selector of selectors) {
      const box = await locate(page, { css: selector }).boundingBox();
      if (!box) throw new Error(`${shot.name}: nothing to crop at ${selector}`);
      boxes.push({ ...box, y: box.y + scroll });
    }
    // Several selectors: the box around them all, as wide as the widest.
    const left = Math.min(...boxes.map((b) => b.x));
    const top = Math.min(...boxes.map((b) => b.y));
    const right = Math.max(...boxes.map((b) => b.x + b.width));
    const bottom = Math.max(...boxes.map((b) => b.y + b.height));
    const pad = shot.pad ?? 0;
    const height = Math.min(bottom - top + pad * 2, shot.maxHeight ?? 1400);
    await page.screenshot({
      path: file,
      fullPage: true,
      clip: { x: Math.max(0, left - pad), y: Math.max(0, top - pad), width: right - left + pad * 2, height },
    });
  } else {
    await page.screenshot({ path: file });
  }
  // WebP at 2× and 1×; the PNG was only the capture.
  const webp2 = path.join(OUT, `${shot.name}@2x.webp`);
  const webp1 = path.join(OUT, `${shot.name}.webp`);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", file, "-c:v", "libwebp", "-quality", "82", webp2]);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", file, "-vf", "scale=iw/2:-1:flags=lanczos", "-c:v", "libwebp", "-quality", "84", webp1]);
  execFileSync("rm", [file]);
  console.log(`✓ ${shot.name}  ${Math.round(statSync(webp1).size / 1024)} KB · @2x ${Math.round(statSync(webp2).size / 1024)} KB`);
}

const args = process.argv.slice(2);
const sheet = args.includes("--sheet");
const wanted = args.filter((a) => !a.startsWith("--"));
const shots = SHOTS.filter((s) => !wanted.length || wanted.includes(s.name));
mkdirSync(OUT, { recursive: true });

const { story, resolvePath } = await import("../how-to/journey/story");
const browser = await chromium.launch({ channel: "chrome" });
try {
  // One emulator restore per chapter, shots that need the same world together.
  const groups = new Map<string, Shot[]>();
  for (const shot of shots) {
    const key = `${shot.after}|${(shot.beats ?? []).join(",")}`;
    groups.set(key, [...(groups.get(key) ?? []), shot]);
  }
  for (const group of groups.values()) {
    const { after, beats = [] } = group[0]!;
    execFileSync(STACK, ["reset", path.join(SNAPSHOTS, `journey-${after}`)], { stdio: "ignore" });
    for (const beat of beats) await story(beat);
    for (const shot of group) {
      const context = await browser.newContext({
        viewport: shot.phone ? { width: 390, height: 844 } : { width: 1440, height: 900 },
        deviceScaleFactor: 2,
        isMobile: Boolean(shot.phone),
        hasTouch: Boolean(shot.phone),
        colorScheme: "light",
        reducedMotion: "reduce",
      });
      if (shot.prep) {
        const prepContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
        const prepPage = await prepContext.newPage();
        await signIn(prepPage, shot.prep.as);
        await prepPage.goto(`${APP}${await resolvePath(shot.prep.route)}`, { waitUntil: "load" });
        for (const action of shot.prep.actions) await run(prepPage, new Pointer(prepPage, 1, 1), action, async () => {}, () => {});
        await prepContext.close();
        await story("drain");
      }
      const page = await context.newPage();
      if (!shot.email) {
        for (let attempt = 1; ; attempt++) {
          try {
            await signIn(page, shot.as);
            break;
          } catch (error) {
            if (attempt >= 3) throw error;
            await page.waitForTimeout(3000);
          }
        }
      }
      try {
        await shoot(shot, page, resolvePath);
      } catch (error) {
        const failed = path.join(HOW_TO_HOME, `screens-failed-${shot.name}.png`);
        await page.screenshot({ path: failed }).catch(() => {});
        console.log(`✗ ${shot.name}: ${(error as Error).message.split("\n")[0]}  (${failed})`);
      }
      await context.close();
    }
  }
} finally {
  await browser.close();
}

// The list the site reads: name, size, alt — so alt text lives with the shot.
// The size is the 1× file's, so every <img> carries its width and height.
const manifest = Object.fromEntries(
  SHOTS.map((s) => [
    s.name,
    { alt: s.alt, phone: Boolean(s.phone), ...webpSize(readFileSync(path.join(OUT, `${s.name}.webp`))) },
  ]),
);
writeFileSync(path.join(ROOT, "features", "marketing", "screens.json"), `${JSON.stringify(manifest, null, 2)}\n`);

if (sheet) {
  const files = SHOTS.map((s) => path.join(OUT, `${s.name}.webp`));
  const html = `<!doctype html><body style="margin:0;padding:24px;background:#F4F1EA;font-family:Helvetica,Arial,sans-serif;display:flex;flex-wrap:wrap;gap:24px;align-items:flex-start;width:1800px">${files
    .map((f, i) => `<figure style="margin:0;max-width:${SHOTS[i]!.phone ? 220 : 560}px"><img src="file://${f}" style="width:100%;border-radius:10px;box-shadow:0 6px 20px rgba(0,0,0,.12);background:#fff"><figcaption style="font-size:13px;margin-top:6px"><b>${SHOTS[i]!.name}</b></figcaption></figure>`)
    .join("")}</body>`;
  const sheetHtml = path.join(HOW_TO_HOME, "screens-sheet.html");
  writeFileSync(sheetHtml, html);
  const b = await chromium.launch({ channel: "chrome" });
  const p = await b.newPage({ viewport: { width: 1850, height: 1000 } });
  await p.goto(`file://${sheetHtml}`);
  await p.waitForTimeout(800);
  await p.screenshot({ path: path.join(HOW_TO_HOME, "screens-sheet.png"), fullPage: true });
  await b.close();
  console.log(`Contact sheet: ${path.join(HOW_TO_HOME, "screens-sheet.png")}`);
}
