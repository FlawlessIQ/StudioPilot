/**
 * "One Saturday": the office-manager film, 30–45 s, in 16:9 (website) and
 * 9:16 (social) (docs/positioning-office-manager-plan-2026-10-06.md →
 * Outbound).
 *
 *   npx tsx scripts/how-to/one-saturday.ts            # both
 *   npx tsx scripts/how-to/one-saturday.ts wide       # 16:9 only
 *   npx tsx scripts/how-to/one-saturday.ts tall       # 9:16 only
 *
 * The story is the homepage's Saturday log (features/marketing/cue-duties.ts):
 * while the photographer shoots, Cue works through the day, and on Monday a
 * few prepared things wait for a tap. Each Saturday line names its duty and
 * the script refuses to run if that duty isn't `on_its_own`; each Monday line
 * must be `you_approve`. So the film can't claim more than the product does.
 *
 * Nothing is re-recorded. The picture comes from the journey chapters' kept
 * streams (make.ts journey-<n> with HOW_TO_KEEP_STREAMS=1), the COI how-to
 * take, and three real email templates rendered into the same phone inbox
 * the journey film uses: the inquiry acknowledgement as the worker captured
 * it, and the signing reminder and COI chase from renderEmailTemplate. Every
 * client-facing screen is in the studio's name; Cue appears only in the
 * studio-facing log.
 *
 * Music only (lib/music.ts); the log is the caption, so it works muted.
 * Output: $HOW_TO_HOME/out/one-saturday/one-saturday-{16x9,9x16}.{mp4,jpg}.
 * Files to review, not to publish: nothing here uploads anything.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium, type Browser } from "playwright";
import { cueDuty, type CueDutyId } from "../../features/marketing/cue-duties";
import { renderEmailTemplate, type EmailBrand } from "../../functions/src/communications/email-templates";
import { latestEmail } from "./journey/emails";
import { inbox } from "./lib/journey-recorder";
import { makeMusicBed } from "./lib/music";
import { card } from "./lib/recorder";
import { HOW_TO_HOME } from "./lib/voice";

const OUT = path.join(HOW_TO_HOME, "out");
const DIR = path.join(OUT, "one-saturday");
const WORK = path.join(DIR, "work");
const ffmpeg = (args: string[]) => execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...args], { stdio: "inherit" });
const probe = (file: string) =>
  Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString().trim());
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

// ── The shot list ───────────────────────────────────────────────────────────

type Rect = { x: number; y: number; w: number; h: number };
type Persona = "studio" | "couple" | "crew";
/** Where the picture comes from. Stream shots start `skip` seconds into a journey chapter's step. */
type Source =
  | { ch: number; step: number; skip?: number; on: Persona }
  | { take: string; at: number }
  | { email: "ack" | "sign" | "coi_chase" };
type Shot = Source & {
  len: number;
  /** Desktop shots: the part of the 1920×1080 screen to show, per frame shape. Phones show whole. */
  crop?: { wide: Rect; tall: Rect };
};

type Beat =
  | { kind: "card"; eyebrow: string; title: string; subtitle: string; len: number; end?: boolean }
  | { kind: "saturday"; time: string; duties: CueDutyId[]; text: string; short: string; shots: Shot[] }
  | { kind: "monday"; shots: Shot[] };

// The Today card and Send reply, framed to the inquiry card.
const TODAY_CARD = { wide: { x: 340, y: 100, w: 1176, h: 940 }, tall: { x: 390, y: 0, w: 900, h: 1080 } };
// Today's "Prepared for you" list, below the headline.
const PREPARED = { wide: { x: 390, y: 395, w: 1060, h: 685 }, tall: { x: 395, y: 395, w: 1050, h: 685 } };
// The COI take is composed (no kept streams): its window, cropped to the certificate.
const CERTIFICATE = { wide: { x: 445, y: 250, w: 880, h: 700 }, tall: { x: 450, y: 260, w: 700, h: 620 } };

/**
 * Times are the homepage's (SATURDAY_LOG); the words name the people on
 * screen, since the footage is the journey film's wedding (Ella and Jordan).
 */
const BEATS: Beat[] = [
  { kind: "card", eyebrow: "One Saturday", title: "You're shooting a wedding.", subtitle: "Here's what Cue did while you were out.", len: 3 },
  {
    kind: "saturday",
    time: "9:42 am",
    duties: ["inquiry_ack"],
    text: "New inquiry for June 12. Your date is free. Cue acknowledged it, told you, and drafted your reply.",
    short: "Answered a new inquiry",
    shots: [
      { ch: 1, step: 3, skip: 3.4, on: "couple", len: 2.4 },
      { email: "ack", len: 2.4 },
      { ch: 1, step: 5, skip: 2.6, on: "studio", len: 3.2, crop: TODAY_CARD },
    ],
  },
  {
    kind: "saturday",
    time: "11:05 am",
    duties: ["signing_reminders"],
    text: "Reminded the Okafors to sign their agreement.",
    short: "Reminded the Okafors to sign",
    shots: [{ email: "sign", len: 3 }],
  },
  {
    kind: "saturday",
    time: "1:30 pm",
    duties: ["crew_cascade"],
    text: "Marcus passed on the Hart wedding. Cue offered it to Jordan, next on your list.",
    short: "Offered the Harts' job to Jordan",
    shots: [{ ch: 4, step: 3, skip: 1.7, on: "crew", len: 3.2 }],
  },
  {
    kind: "saturday",
    time: "2:15 pm",
    duties: ["coi_chase"],
    text: "Chased your insurance agent for the Willow Creek certificate.",
    short: "Chased your agent",
    shots: [{ email: "coi_chase", len: 3 }],
  },
  {
    kind: "saturday",
    time: "4:50 pm",
    duties: ["crew_calendar"],
    text: "Jordan said yes. The wedding is on their calendar.",
    short: "Jordan said yes",
    shots: [{ ch: 4, step: 4, skip: -0.5, on: "crew", len: 3 }],
  },
  {
    kind: "saturday",
    time: "6:20 pm",
    duties: ["coi_check"],
    text: "The certificate came in with $500,000 of cover. Willow Creek needs $1,000,000. Flagged it for you.",
    short: "Caught a short certificate",
    shots: [{ take: "coi", at: 66.8, len: 3.6, crop: CERTIFICATE }],
  },
  {
    kind: "saturday",
    time: "8:00 pm",
    duties: ["week_before_note", "call_times"],
    text: "Sent next week's couple their week-before note. Call times went to the crew.",
    short: "Sent the week-before note",
    shots: [
      { ch: 7, step: 1, skip: 0.8, on: "couple", len: 2.6 },
      { ch: 7, step: 3, skip: 2.0, on: "crew", len: 2.6 },
    ],
  },
  {
    kind: "monday",
    shots: [
      { ch: 7, step: 8, skip: 1.3, on: "studio", len: 4, crop: PREPARED },
      { ch: 1, step: 6, skip: 0, on: "studio", len: 3, crop: TODAY_CARD },
    ],
  },
  {
    kind: "card",
    end: true,
    eyebrow: "StudioCue",
    title: "Meet Cue, your studio's office manager.",
    subtitle: "Works around the clock. Waits for you on what matters.",
    len: 3.6,
  },
];

/** What waits on Monday, each prepared and one tap (MONDAY_WAITING, in the film's names). */
const MONDAY: Array<{ text: string; duty: CueDutyId }> = [
  { text: "Your reply to Ella", duty: "inquiry_reply" },
  { text: "The certificate: send it, or ask your agent to fix it", duty: "coi_send" },
  { text: "The Harts' schedule confirmation", duty: "schedule_confirmation" },
  { text: "A reminder to the Parks: their balance is late", duty: "payment_reminder" },
];

// The film may only say what the product does (tests/marketing-claims.test.ts holds the homepage to the same).
for (const beat of BEATS)
  if (beat.kind === "saturday")
    for (const id of beat.duties)
      if (cueDuty(id).mode !== "on_its_own") throw new Error(`"${beat.time}" uses ${id}, which Cue doesn't do on its own.`);
for (const item of MONDAY)
  if (cueDuty(item.duty).mode !== "you_approve") throw new Error(`Monday's "${item.text}" (${item.duty}) isn't a prepared, one-tap duty.`);

const SATURDAY = BEATS.filter((b): b is Extract<Beat, { kind: "saturday" }> => b.kind === "saturday");

// ── Frames ──────────────────────────────────────────────────────────────────

type Shape = "wide" | "tall";
const SIZE: Record<Shape, { w: number; h: number }> = { wide: { w: 1920, h: 1080 }, tall: { w: 1080, h: 1920 } };
/** Where the picture goes; the rest of the frame is the log. */
const BOX: Record<Shape, Rect> = { wide: { x: 700, y: 70, w: 1156, h: 940 }, tall: { x: 40, y: 600, w: 1000, h: 1260 } };
const PHONE_SRC = { w: 1080, h: 2338 };
const BEZEL = 14;
const even = (n: number) => Math.round(n / 2) * 2;

function placement(shot: Shot, shape: Shape) {
  const phone = !shot.crop;
  const src: Rect = shot.crop ? shot.crop[shape] : { x: 0, y: 0, ...PHONE_SRC };
  const box = BOX[shape];
  const room = phone ? { w: box.w - 2 * BEZEL, h: box.h - 2 * BEZEL } : box;
  const scale = Math.min(room.w / src.w, room.h / src.h);
  const w = even(src.w * scale), h = even(src.h * scale);
  // Tall frames hang the picture just under the words; wide ones centre it beside them.
  const y = shape === "tall" ? box.y + (phone ? BEZEL : 0) : even(box.y + (box.h - h) / 2);
  return { phone, src, rect: { x: even(box.x + (box.w - w) / 2), y, w, h } };
}

const PAGE = `html,body{margin:0;background:#F4F1EA;font-family:"Helvetica Neue",Helvetica,Arial,sans-serif;color:#1E2521;overflow:hidden}
  .eyebrow{letter-spacing:.16em;text-transform:uppercase;color:#2E6B4B;font-weight:600}
  .serif{font-family:Georgia,"Times New Roman",serif;letter-spacing:-.01em}`;

/** The frame around the picture: phone bezel or desktop window, at `rect`. */
function frameHtml(rect: Rect, phone: boolean) {
  const r = phone ? Math.round(rect.w * 0.125) : 14;
  return phone
    ? `<div style="position:absolute;left:${rect.x - BEZEL}px;top:${rect.y - BEZEL}px;width:${rect.w + 2 * BEZEL}px;height:${rect.h + 2 * BEZEL}px;border-radius:${r + BEZEL}px;background:#15191a;box-shadow:0 26px 70px rgba(30,37,33,.28)"></div>`
    : `<div style="position:absolute;left:${rect.x - 1}px;top:${rect.y - 1}px;width:${rect.w + 2}px;height:${rect.h + 2}px;border-radius:${r + 1}px;background:#d9d6cd;box-shadow:0 24px 60px rgba(30,37,33,.18)"></div>`;
}

/** The log beside (16:9) or above (9:16) the picture. */
function logHtml(beat: Beat, shape: Shape) {
  if (beat.kind === "card") return "";
  const index = beat.kind === "saturday" ? SATURDAY.indexOf(beat) : SATURDAY.length;
  if (shape === "wide") {
    if (beat.kind === "monday") {
      return `<div style="position:absolute;left:84px;top:96px;width:540px">
        <div class="eyebrow" style="font-size:20px">Monday, 8:30 am</div>
        <div class="serif" style="font-size:54px;line-height:1.08;margin-top:14px">Waiting for you</div>
        <div style="font-size:23px;line-height:1.45;color:#4f5752;margin-top:18px">${SATURDAY.length} things done on Saturday. ${MONDAY.length} need your yes, one tap each.</div>
        <div style="margin-top:34px;display:grid;gap:14px">${MONDAY.map(
          (m) => `<div style="display:flex;gap:14px;align-items:flex-start;background:#fff;border:1px solid #e4e0d6;border-radius:12px;padding:16px 18px">
            <div style="flex:none;margin-top:3px;width:20px;height:20px;border-radius:50%;border:2px solid #2E6B4B"></div>
            <div style="font-size:21px;line-height:1.35">${esc(m.text)}</div></div>`,
        ).join("")}</div></div>
        <div style="position:absolute;left:84px;bottom:64px;font-size:20px;color:#2E6B4B"><b style="color:#1E2521">Studio</b>Cue</div>`;
    }
    const past = SATURDAY.slice(0, index)
      .map((b) => `<div style="display:flex;gap:18px;font-size:21px;line-height:1.3;color:#8a8f88"><span style="flex:none;width:96px;font-variant-numeric:tabular-nums">${b.time}</span><span>${esc(b.short)}</span></div>`)
      .join("");
    return `<div style="position:absolute;left:84px;top:96px;width:540px">
        <div class="eyebrow" style="font-size:20px">Saturday</div>
        <div class="serif" style="font-size:44px;line-height:1.1;margin-top:12px">While you shoot a wedding</div>
        <div style="margin-top:34px;display:grid;gap:12px">${past}</div>
        <div style="margin-top:${index ? 26 : 8}px;border-left:4px solid #2E6B4B;padding:4px 0 4px 20px">
          <div class="eyebrow" style="font-size:22px;letter-spacing:.06em">${beat.time}</div>
          <div class="serif" style="font-size:34px;line-height:1.22;margin-top:10px">${esc(beat.text)}</div>
        </div></div>
        <div style="position:absolute;left:84px;bottom:64px;font-size:20px;color:#2E6B4B"><b style="color:#1E2521">Studio</b>Cue</div>`;
  }
  // Tall: the current line large, the day as a row of times beneath it.
  const dots = SATURDAY.map(
    (b, i) => `<div style="flex:1;text-align:center;font-size:19px;color:${i === index ? "#1E2521" : i < index ? "#2E6B4B" : "#b3b0a6"};font-weight:${i === index ? 700 : 500}">
      <div style="height:8px;margin:0 3px 10px;border-radius:4px;background:${i <= index ? "#2E6B4B" : "#dcd8cd"}"></div>${b.time.replace(/ (am|pm)$/, "")}</div>`,
  ).join("");
  if (beat.kind === "monday")
    return `<div style="position:absolute;left:64px;right:64px;top:84px">
      <div class="eyebrow" style="font-size:26px">Monday · ${SATURDAY.length} done on Saturday</div>
      <div class="serif" style="font-size:56px;line-height:1.08;margin-top:14px">${MONDAY.length} waiting, one tap each</div>
      <div style="margin-top:26px;display:grid;gap:12px">${MONDAY.map(
        (m) => `<div style="display:flex;gap:16px;align-items:center;font-size:29px;line-height:1.25"><div style="flex:none;width:24px;height:24px;border-radius:50%;border:3px solid #2E6B4B"></div>${esc(m.text)}</div>`,
      ).join("")}</div></div>`;
  return `<div style="position:absolute;left:64px;right:64px;top:96px">
      <div class="eyebrow" style="font-size:28px">Saturday · ${beat.time}</div>
      <div class="serif" style="font-size:50px;line-height:1.18;margin-top:18px;height:240px">${esc(beat.text)}</div>
      <div style="display:flex;margin-top:34px">${dots}</div></div>`;
}

async function shotChrome(browser: Browser, beat: Beat, shot: Shot, shape: Shape, file: string) {
  const size = SIZE[shape];
  const { phone, rect } = placement(shot, shape);
  const page = await browser.newPage({ viewport: { width: size.w, height: size.h } });
  await page.setContent(`<!doctype html><html><head><style>${PAGE}</style></head><body style="width:${size.w}px;height:${size.h}px">${logHtml(beat, shape)}${frameHtml(rect, phone)}</body></html>`);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: file });
  // The mask: the picture's rounded corners.
  await page.close();
  const mask = file.replace(/\.png$/, "-mask.png");
  const maskPage = await browser.newPage({ viewport: { width: rect.w, height: rect.h } });
  await maskPage.setContent(
    `<!doctype html><html style="margin:0;background:#000"><body style="margin:0;background:#000"><div style="width:${rect.w}px;height:${rect.h}px;border-radius:${phone ? Math.round(rect.w * 0.125) : 14}px;background:#fff"></div></body></html>`,
  );
  await maskPage.screenshot({ path: mask, clip: { x: 0, y: 0, width: rect.w, height: rect.h } });
  await maskPage.close();
  return { mask, rect };
}

async function cardStill(browser: Browser, beat: Extract<Beat, { kind: "card" }>, shape: Shape, file: string) {
  const size = SIZE[shape];
  const page = await browser.newPage({ viewport: { width: size.w / 2, height: size.h / 2 }, deviceScaleFactor: 2 });
  let html = card(beat.eyebrow, beat.title, beat.subtitle);
  if (beat.end)
    html = html.replace(
      "</main>",
      `<div style="margin-top:10px;font-size:clamp(20px,2.2vw,30px);font-weight:600;color:#F4F1EA;letter-spacing:.01em">studio-cue.com</div></main>`,
    );
  await page.setContent(html);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(900); // after the card's fade-in
  await page.screenshot({ path: file });
  await page.close();
}

// ── Emails: the real templates, in the journey film's phone inbox ───────────

const BRAND: EmailBrand = { studioName: "Alder & Muse", productName: "StudioCue", accentColor: "#2E6B4B", logoUrl: null, contactEmail: null };

function emailFor(which: "ack" | "sign" | "coi_chase") {
  if (which === "ack") {
    const captured = latestEmail(/received your inquiry/, "ella.hart@studiohub.test");
    if (!captured) throw new Error("No captured inquiry acknowledgement: make journey-1 first.");
    return captured;
  }
  const rendered =
    which === "sign"
      ? renderEmailTemplate({ key: "contract_reminder", brand: BRAND, recipientName: "Ada Okafor", projectName: "Okafor Wedding", values: { portalUrl: "https://studio-cue.com/portal" } })
      : renderEmailTemplate({
          key: "coi_request",
          brand: BRAND,
          projectName: "Ella Hart Wedding",
          values: { chaseNumber: 1, requirement: { venueLegalName: "Willow Creek Barn LLC", eventDate: "2026-11-30", dueDate: "2026-11-16", certificateHolder: "Willow Creek Barn LLC" } },
        });
  return { subject: rendered.subject, from: BRAND.studioName, html: rendered.html };
}

async function emailStill(browser: Browser, which: "ack" | "sign" | "coi_chase", file: string) {
  const page = await browser.newPage({ viewport: { width: PHONE_SRC.w / 3, height: Math.round(PHONE_SRC.h / 3) }, deviceScaleFactor: 3 });
  await page.setContent(inbox(emailFor(which)));
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  await page.screenshot({ path: file });
  await page.close();
}

// ── Assembly ────────────────────────────────────────────────────────────────

function marksOf(ch: number) {
  return JSON.parse(readFileSync(path.join(OUT, `journey-${ch}`, "streams", "marks.json"), "utf8")) as Array<{ step: number; at: number }>;
}

/** The source file and where the shot starts in it; how long it can run before its step ends. */
function sourceOf(shot: Shot): { file: string; start: number; room: number } {
  if ("take" in shot) return { file: path.join(OUT, shot.take, `${shot.take}.voice.mp4`), start: shot.at, room: shot.len };
  if ("email" in shot) throw new Error("emails are stills");
  const marks = marksOf(shot.ch);
  const i = marks.findIndex((m) => m.step === shot.step);
  if (i < 0) throw new Error(`journey-${shot.ch} has no step ${shot.step}.`);
  const file = path.join(OUT, `journey-${shot.ch}`, "streams", `${shot.on}.mp4`);
  const start = marks[i]!.at + (shot.skip ?? 0);
  const next = marks.slice(i + 1).find((m) => m.at > marks[i]!.at + 0.01);
  const end = next ? next.at : probe(file);
  return { file, start, room: Math.max(0.5, end - start) };
}

async function renderShape(browser: Browser, shape: Shape) {
  const size = SIZE[shape];
  const clips: string[] = [];
  let posterAt = 0;
  let clock = 0;
  const fade = 0.35;
  for (const [b, beat] of BEATS.entries()) {
    if (beat.kind === "card") {
      const png = path.join(WORK, `${shape}-b${b}-card.png`);
      await cardStill(browser, beat, shape, png);
      const file = path.join(WORK, `${shape}-b${b}.mp4`);
      ffmpeg(["-loop", "1", "-t", beat.len.toFixed(3), "-i", png, "-vf", `scale=${size.w}:${size.h},fps=30,format=yuv420p`, "-c:v", "libx264", "-preset", "medium", "-crf", "16", file]);
      clips.push(file);
      clock += beat.len - fade;
      continue;
    }
    for (const [s, shot] of beat.shots.entries()) {
      const chrome = path.join(WORK, `${shape}-b${b}-s${s}.png`);
      const { mask, rect } = await shotChrome(browser, beat, shot, shape, chrome);
      const { src, phone } = placement(shot, shape);
      const file = path.join(WORK, `${shape}-b${b}-s${s}.mp4`);
      // Phones (streams and email stills) fill their frame whole; desktops are cropped to what the line is about.
      const fit = `${phone ? "" : `crop=${src.w}:${src.h}:${src.x}:${src.y},`}scale=${rect.w}:${rect.h}:flags=lanczos`;
      let picture: string[];
      let pictureChain: string;
      if ("email" in shot) {
        const still = path.join(WORK, `email-${shot.email}.png`);
        await emailStill(browser, shot.email, still);
        picture = ["-loop", "1", "-t", shot.len.toFixed(3), "-i", still];
        pictureChain = `[1:v]${fit},format=rgba[p]`;
      } else {
        const { file: source, start, room } = sourceOf(shot);
        const run = Math.min(shot.len, room);
        picture = ["-ss", start.toFixed(3), "-t", run.toFixed(3), "-i", source];
        pictureChain = `[1:v]fps=30,${fit},tpad=stop_mode=clone:stop_duration=${Math.max(0, shot.len - run).toFixed(3)},format=rgba[p]`;
      }
      ffmpeg([
        "-loop", "1", "-t", shot.len.toFixed(3), "-i", chrome,
        ...picture,
        "-loop", "1", "-t", shot.len.toFixed(3), "-i", mask,
        "-filter_complex",
        `${pictureChain};[2:v]format=gray,scale=${rect.w}:${rect.h}[m];[p][m]alphamerge[pm];[0:v][pm]overlay=${rect.x}:${rect.y}:shortest=1,fps=30,format=yuv420p[out]`,
        "-map", "[out]", "-t", shot.len.toFixed(3), "-c:v", "libx264", "-preset", "medium", "-crf", "16", file,
      ]);
      // The poster: the short certificate, with most of the day already in the log.
      if (beat.kind === "saturday" && beat.duties.includes("coi_check")) posterAt = clock + shot.len / 2;
      clips.push(file);
      clock += shot.len - fade;
    }
  }
  return { clips, posterAt };
}

/** Joins clips with a short dissolve, then lays the music bed under the whole film. */
function finish(clips: string[], out: string, seed: number) {
  const fade = 0.35;
  const lengths = clips.map(probe);
  const inputs = clips.flatMap((c) => ["-i", c]);
  let graph = "";
  let last = "[0:v]";
  let offset = 0;
  for (let i = 1; i < clips.length; i++) {
    offset += lengths[i - 1]! - fade;
    graph += `${last}[${i}:v]xfade=transition=fade:duration=${fade}:offset=${offset.toFixed(3)}[x${i}];`;
    last = `[x${i}]`;
  }
  const length = lengths.reduce((a, b) => a + b, 0) - fade * (clips.length - 1);
  const picture = path.join(WORK, `${path.basename(out, ".mp4")}-picture.mp4`);
  ffmpeg([...inputs, "-filter_complex", `${graph}${last}fade=t=out:st=${(length - 0.6).toFixed(3)}:d=0.6[v]`, "-map", "[v]", "-an", "-c:v", "libx264", "-preset", "slow", "-crf", "19", "-pix_fmt", "yuv420p", picture]);
  const bed = path.join(WORK, `bed-${seed}.wav`);
  makeMusicBed(length + 1, bed, seed);
  // No voice to duck under: the bed alone, at a comfortable -18 LUFS, fading out with the picture.
  ffmpeg([
    "-i", picture, "-i", bed,
    "-filter_complex", `[1:a]atrim=0:${length.toFixed(3)},highpass=f=60,afade=t=in:d=0.8,afade=t=out:st=${(length - 2).toFixed(3)}:d=2,loudnorm=I=-18:TP=-1.5:LRA=11,aresample=44100[a]`,
    "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ac", "2", "-movflags", "+faststart", "-shortest", out,
  ]);
  return length;
}

const wanted = (process.argv[2] ?? "both") as Shape | "both";
rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });
const browser = await chromium.launch({ channel: "chrome" });
try {
  for (const shape of ["wide", "tall"] as const) {
    if (wanted !== "both" && wanted !== shape) continue;
    const name = `one-saturday-${shape === "wide" ? "16x9" : "9x16"}`;
    const { clips, posterAt } = await renderShape(browser, shape);
    const out = path.join(DIR, `${name}.mp4`);
    const length = finish(clips, out, shape === "wide" ? 31 : 37);
    ffmpeg(["-ss", posterAt.toFixed(2), "-i", out, "-frames:v", "1", "-q:v", "3", path.join(DIR, `${name}.jpg`)]);
    console.log(`✓ ${name}: ${length.toFixed(1)}s, ${Math.round(readFileSync(out).length / 1024)} KB → ${out}`);
  }
} finally {
  await browser.close();
}
writeFileSync(
  path.join(DIR, "transcript.txt"),
  [...SATURDAY.map((b) => `${b.time}: ${b.text}`), `Monday: ${MONDAY.map((m) => m.text).join(" · ")}`].join("\n") + "\n",
);
rmSync(WORK, { recursive: true, force: true });
