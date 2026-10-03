/**
 * Records a journey film: several people on their own screens at once.
 *
 * Each member of the cast — the studio on a desktop, the couple and the crew
 * on phones — is signed in in a browser context of their own, and each is
 * screencast for the whole take, so every stream shares one clock. A step's
 * actions run on one screen (`on`); the compositor (lib/compose.ts) later
 * frames each step by its layout, so a couple signing on the right and the
 * studio's Booking tab ticking on the left can sit side by side, both live.
 *
 * Cards are rendered as full-frame stills of their own. Emails are the real
 * templates, captured as the email worker rendered them (story.ts), shown in
 * a plain phone inbox view. Story beats move the world on behind the camera
 * and are cut from the video.
 */
import { chromium, type BrowserContext, type CDPSession, type Page } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { HowToScript, Layout, Persona, Step } from "./define";
import { card, overlay, Pointer, run, signIn, VIEWPORTS, type Cut, type Frame } from "./recorder";
import { latestEmail } from "../journey/emails";

export type JourneyMark = {
  step: number;
  t: number;
  on: Persona;
  /** The phone shown beside the studio in a split, or alone in a phone layout. */
  phone: Persona | null;
  layout: Layout;
  caption: Step["caption"] | null;
  when: Step["when"] | null;
  /** The card still, for a card step. */
  cardFile: string | null;
};

export type JourneyRecording = {
  streams: Partial<Record<Persona, Frame[]>>;
  marks: JourneyMark[];
  cuts: Cut[];
  endT: number;
};

type Screen = { persona: Persona; context: BrowserContext; page: Page; pointer: Pointer; cdp: CDPSession | null; frames: Frame[] };

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** A plain phone inbox, opened on one message. Generic on purpose: no real mail app's look. */
function inbox(email: { subject: string; from: string; html: string }): string {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>
    html,body{margin:0;background:#fff;font-family:-apple-system,"Helvetica Neue",Helvetica,Arial,sans-serif;color:#1d1d1f}
    .bar{position:sticky;top:0;background:#f7f7f8;border-bottom:1px solid #e5e5ea;padding:14px 16px 12px;z-index:2}
    .back{color:#2E6B4B;font-size:15px}
    .meta{padding:16px 16px 10px;border-bottom:1px solid #eee}
    .subj{font-size:20px;font-weight:650;line-height:1.25;margin:0 0 10px}
    .from{display:flex;gap:10px;align-items:center;font-size:14px}
    .av{width:34px;height:34px;border-radius:50%;background:#2E6B4B;color:#fff;display:grid;place-items:center;font-weight:600}
    .from small{display:block;color:#8a8a8e;font-size:12.5px;margin-top:2px}
    .body{padding:4px 0 40px}
    .body > div{zoom:.64}
  </style></head><body>
    <div class="bar"><span class="back">‹ Inbox</span></div>
    <div class="meta"><p class="subj">${esc(email.subject)}</p>
      <div class="from"><div class="av">${esc(email.from.slice(0, 1).toUpperCase())}</div><div><b>${esc(email.from)}</b><small>to me · just now</small></div></div></div>
    <div class="body"><div>${email.html}</div></div>
  </body></html>`;
}

export async function recordJourney(
  script: HowToScript,
  holdFor: (step: number) => number,
  outDir: string,
  {
    dryRun = false,
    story,
    resolvePath,
    respond,
  }: {
    dryRun?: boolean;
    story: (beat: string) => Promise<void>;
    resolvePath: (template: string) => Promise<string>;
    respond: (name: string) => Promise<unknown>;
  },
): Promise<JourneyRecording> {
  const cast = script.cast ?? { studio: "owner" };
  const browser = await chromium.launch({ channel: "chrome" });
  const screens = new Map<Persona, Screen>();
  const cuts: Cut[] = [];
  const marks: JourneyMark[] = [];
  const cardDir = path.join(outDir, "cards");
  mkdirSync(cardDir, { recursive: true });

  try {
    for (const beat of script.before ?? []) await story(beat);

    for (const [persona, account] of Object.entries(cast) as Array<[Persona, string]>) {
      const view = VIEWPORTS[persona === "studio" ? "desktop" : "phone"];
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
      // Freshly restored emulators sometimes miss the first sign-in.
      for (let attempt = 1; account !== "guest"; attempt++) {
        try {
          await signIn(page, account);
          break;
        } catch (error) {
          if (attempt >= 3) throw error;
          await page.waitForTimeout(3000);
        }
      }
      screens.set(persona, { persona, context, page, pointer: new Pointer(page, view.width, view.height), cdp: null, frames: [] });
    }

    if (!dryRun) {
      for (const screen of screens.values()) {
        const view = VIEWPORTS[screen.persona === "studio" ? "desktop" : "phone"];
        const dir = path.join(outDir, "frames", screen.persona);
        mkdirSync(dir, { recursive: true });
        const cdp = await screen.context.newCDPSession(screen.page);
        screen.cdp = cdp;
        let n = 0;
        cdp.on("Page.screencastFrame", (frame) => {
          const file = path.join(dir, `f${String(n++).padStart(6, "0")}.jpg`);
          writeFileSync(file, Buffer.from(frame.data, "base64"));
          screen.frames.push({ t: frame.metadata.timestamp ?? Date.now() / 1000, file });
          void cdp.send("Page.screencastFrameAck", { sessionId: frame.sessionId }).catch(() => {});
        });
        await cdp.send("Page.startScreencast", {
          format: "jpeg",
          quality: 90,
          maxWidth: view.width * view.scale,
          maxHeight: view.height * view.scale,
          everyNthFrame: 1,
        });
      }
    }

    let stills = 0;
    const still = (screen: Screen) => async (target: Page) => {
      if (dryRun) return;
      const file = path.join(outDir, "frames", screen.persona, `s${String(stills++).padStart(4, "0")}.jpg`);
      await target.screenshot({ path: file, type: "jpeg", quality: 92 });
      screen.frames.push({ t: Date.now() / 1000, file });
      screen.frames.sort((a, b) => a.t - b.t);
    };

    let on: Persona = "studio";
    let lastPhone: Persona | null = null;
    let when: Step["when"] | null = null;
    // A phone keeps its caption ("What Ella sees") until a step gives it another.
    const captions = new Map<Persona, NonNullable<Step["caption"]>>();
    for (const [index, step] of script.steps.entries()) {
      on = step.on ?? on;
      if (on !== "studio") lastPhone = on;
      when = step.when ?? when;
      const isCard = step.do.some((action) => "card" in action);
      const layout: Layout = isCard ? "card" : (step.layout ?? (on === "studio" ? "studio" : "phone"));
      const screen = screens.get(on);
      if (!screen && !isCard) throw new Error(`${script.id} step ${index}: nobody plays "${on}" (add them to cast).`);

      const started = Date.now() / 1000;
      let cutInStep = 0;
      if (step.caption && on !== "studio") captions.set(on, step.caption);
      const caption = step.caption ?? (lastPhone ? captions.get(lastPhone) ?? null : null);
      const mark: JourneyMark = { step: index, t: started, on, phone: lastPhone, layout, caption, when, cardFile: null };
      marks.push(mark);
      const cut = (from: number, to: number) => {
        cuts.push({ from, to });
        cutInStep += to - from;
      };

      for (const action of step.do) {
        try {
          if ("card" in action) {
            // A full-frame still of its own; no one's screen is disturbed.
            mark.cardFile = path.join(cardDir, `card-${index}.png`);
            if (!dryRun) {
              const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
              const fill = async (text?: string) => (text && text.includes("{") ? resolvePath(text) : text);
              await page.setContent(card(await fill(action.card.eyebrow), (await fill(action.card.title))!, await fill(action.card.subtitle)));
              await page.evaluate(() => document.fonts.ready);
              // The card fades in over 0.6 s; a still taken sooner is half-painted.
              await page.waitForTimeout(900);
              await page.screenshot({ path: mark.cardFile });
              await page.close();
            }
          } else if ("story" in action) {
            const from = Date.now() / 1000;
            await story(action.story);
            cut(from, Date.now() / 1000);
          } else if ("email" in action) {
            const email = latestEmail(action.email.subject, action.email.to);
            if (!email) throw new Error(`No email captured matching ${action.email.subject}${action.email.to ? ` to ${action.email.to}` : ""}.`);
            await screen!.page.goto("about:blank");
            await screen!.page.setContent(inbox(email));
            await screen!.page.waitForTimeout(500);
            await still(screen!)(screen!.page);
          } else if ("respond" in action) {
            const body = JSON.stringify(await respond(action.respond.with));
            await screen!.page.route(action.respond.url, (route) => route.fulfill({ status: 200, contentType: "application/json", body }), { times: 1 });
          } else if ("goto" in action && action.goto.includes("{")) {
            await run(screen!.page, screen!.pointer, { goto: await resolvePath(action.goto) }, still(screen!), cut);
          } else {
            await run(screen!.page, screen!.pointer, action, still(screen!), cut);
          }
        } catch (error) {
          const shot = path.join(outDir, `failed-step-${index}.png`);
          await screen?.page.screenshot({ path: shot }).catch(() => {});
          throw new Error(`${script.id} step ${index} (${JSON.stringify(action)}): ${(error as Error).message}\n  screenshot: ${shot}`);
        }
      }
      // A check with HOW_TO_SHOTS set leaves a picture of each step, for writing the script.
      if (dryRun && process.env.HOW_TO_SHOTS && screen) {
        await screen.page.screenshot({ path: path.join(outDir, `check-${String(index).padStart(2, "0")}-${on}.png`) }).catch(() => {});
      }
      if (!dryRun) {
        const remaining = started + holdFor(index) + cutInStep - Date.now() / 1000;
        if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, Math.round(remaining * 1000)));
      }
    }
    const endT = Date.now() / 1000;
    for (const screen of screens.values()) if (screen.cdp) await screen.cdp.send("Page.stopScreencast");
    const streams: JourneyRecording["streams"] = {};
    for (const screen of screens.values()) streams[screen.persona] = [...screen.frames].sort((a, b) => a.t - b.t);
    writeFileSync(path.join(outDir, "recording.json"), JSON.stringify({ marks, cuts, endT }, null, 2));
    return { streams, marks, cuts, endT };
  } finally {
    await browser.close();
  }
}

/** For re-assembling a take without recording it again. */
export function readRecording(outDir: string): Omit<JourneyRecording, "streams"> {
  return JSON.parse(readFileSync(path.join(outDir, "recording.json"), "utf8"));
}
