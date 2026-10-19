/**
 * "Meet Cue": the 30-second social ad for Instagram Reels, TikTok and
 * Facebook, from Gabe's script (2026-10-19), voiced by Matilda.
 *
 *   npx tsx scripts/how-to/social-ad.ts                 # every cut
 *   npx tsx scripts/how-to/social-ad.ts tall            # 9:16, 30 s, voice + music-only
 *   npx tsx scripts/how-to/social-ad.ts feed            # 4:5, 30 s
 *   npx tsx scripts/how-to/social-ad.ts short           # 9:16, 15 s
 *   npx tsx scripts/how-to/social-ad.ts --code GABEVZ4D # the code on the end card
 *   npx tsx scripts/how-to/social-ad.ts --music rock    # the rock bed (files end .rock.mp4)
 *   npx tsx scripts/how-to/social-ad.ts --music rock --reuse-picture  # sound only, over the last pictures
 *   npx tsx scripts/how-to/social-ad.ts --music-file <mp3> [--music-lift 25.9]  # a recorded bed (music-takes.ts)
 *   npx tsx scripts/how-to/social-ad.ts --partners <json> ...  # every cut per partner: [{ name, code }]
 *
 * Every product claim is a duty in features/marketing/cue-duties.ts, checked
 * below; the picture is the journey film's kept streams and the COI take,
 * plus the real COI request email. Gabe's quote is his one cleared line,
 * attributed as the site does (components/marketing/studio-proof.tsx).
 *
 * Each frame is drawn in a browser (captions, cards, phones, the end card)
 * and piped to ffmpeg; the narration is placed on the same clock, so the
 * captions follow her word by word, and also work muted.
 * Output: $HOW_TO_HOME/out/social-ad/. Nothing here uploads anything.
 */
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium, type Browser } from "playwright";
import { cueDuty, type CueDutyId } from "../../features/marketing/cue-duties";
import { inbox } from "./lib/journey-recorder";
import { makeMusicBed } from "./lib/music";
import { HOW_TO_HOME, speak, spoken, type Line, type VoiceConfig } from "./lib/voice";

// A static import of functions/src would pull the functions package into the app build (see one-saturday.ts).
type EmailBrand = { studioName: string; productName: string; accentColor: string; logoUrl: string | null; contactEmail: string | null };
const { renderEmailTemplate } = (await import(`${process.cwd()}/functions/src/communications/email-templates.ts`)) as {
  renderEmailTemplate: (input: Record<string, unknown>) => { subject: string; html: string; text: string };
};

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HOW_TO_HOME, "out");
const DIR = path.join(OUT, "social-ad");
const WORK = path.join(DIR, "work");
const FPS = 30;
const ffmpeg = (args: string[]) => execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...args], { stdio: "inherit" });
const probe = (file: string) =>
  Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString().trim());

// ── The script ──────────────────────────────────────────────────────────────

type Rect = { x: number; y: number; w: number; h: number };
type Clip =
  | {
      kind: "desk";
      file: string;
      at: number;
      crop: Rect;
      len?: number;
      /** Cut at the right edge: fade it, so the cut reads as framing. */
      fade?: boolean;
      /** Hold the first frame (the take moves on to things the line isn't about). */
      hold?: boolean;
      /** A highlighter swept across this part of the crop, `at` seconds into the clip. */
      mark?: Rect & { at: number };
    }
  | { kind: "phone"; file: string; at: number; len?: number }
  | { kind: "email"; len?: number };
type Look = { kind: "stack" } | { kind: "clips"; clips: Clip[] } | { kind: "quote" } | { kind: "end" };
type Scene = {
  id: string;
  eyebrow?: string;
  say?: string;
  /** The duties `say` claims. `acts` lines say Cue did it unattended, so those must be `on_its_own`. */
  duties?: CueDutyId[];
  acts?: boolean;
  look: Look;
  min: number;
  short?: boolean;
};

const stream = (ch: number, on: string) => path.join(OUT, `journey-${ch}`, "streams", `${on}.mp4`);
const COI_TAKE = path.join(OUT, "coi", "coi.voice.mp4");
// Desktop crops, in the 1920×1080 recordings: the inquiry card on Today, its reply and Send, the certificate check.
const INQUIRY: Rect = { x: 425, y: 350, w: 600, h: 392 };
const SEND: Rect = { x: 495, y: 472, w: 560, h: 262 };
const CERTIFICATE: Rect = { x: 488, y: 362, w: 610, h: 488 };

const SCENES: Scene[] = [
  { id: "hook", say: "What if your office kept running while you were out shooting?", look: { kind: "stack" }, min: 3.4, short: true },
  {
    id: "brand",
    eyebrow: "For photographers and videographers",
    say: "Meet Cue, the office manager inside StudioCue.",
    look: { kind: "stack" },
    min: 3.6,
  },
  {
    id: "inquiry",
    eyebrow: "Inquiries",
    say: "Inquiry comes in? Your reply's drafted.",
    duties: ["inquiry_reply"],
    look: { kind: "clips", clips: [{ kind: "desk", file: stream(1, "studio"), at: 31.2, crop: INQUIRY, fade: true }] },
    min: 2.6,
  },
  {
    id: "contract",
    eyebrow: "Agreements",
    say: "Proposal accepted? The contract's drafted.",
    duties: ["agreement_prepared"],
    look: {
      kind: "clips",
      clips: [
        { kind: "phone", file: stream(3, "couple"), at: 29.3, len: 1.4 },
        { kind: "phone", file: stream(3, "couple"), at: 41.0 },
      ],
    },
    min: 2.6,
  },
  {
    id: "coi",
    eyebrow: "Insurance",
    say: "Venue needs insurance? Cue chases the certificate and checks it.",
    duties: ["coi_chase", "coi_check"],
    acts: true,
    look: { kind: "clips", clips: [{ kind: "email", len: 1.6 }, { kind: "desk", file: COI_TAKE, at: 66.3, crop: CERTIFICATE, hold: true, mark: { x: 60, y: 186, w: 458, h: 24, at: 0.7 } }] },
    min: 3.6,
    short: true,
  },
  {
    id: "crew",
    eyebrow: "Crew",
    say: "It even lines up your crew.",
    duties: ["crew_offers"],
    look: { kind: "clips", clips: [{ kind: "phone", file: stream(4, "crew"), at: 25.6 }] },
    min: 2.4,
  },
  {
    id: "send",
    eyebrow: "You approve",
    say: "You review it. You send it.",
    look: { kind: "clips", clips: [{ kind: "desk", file: stream(1, "studio"), at: 40.3, crop: SEND, fade: true }] },
    min: 2.4,
    short: true,
  },
  { id: "quote", look: { kind: "quote" }, min: 1.8 },
  { id: "end", say: "Half off your first year. The code's in the caption.", look: { kind: "end" }, min: 3.6, short: true },
];

/** The opening pile-up, then (while she introduces Cue) what Cue makes of each one. */
const STACK: Array<{ icon: string; title: string; problem: string; solved: string; duty: CueDutyId; done: boolean }> = [
  { icon: "mail", title: "New inquiry · Ella Hart", problem: "June 12 at Willow Creek Barn. Is your date free?", solved: "Date checked. Your reply is drafted.", duty: "inquiry_reply", done: false },
  { icon: "shield", title: "Willow Creek Barn", problem: "We'll need your certificate of insurance.", solved: "Request ready for your agent.", duty: "coi_request", done: false },
  { icon: "pen", title: "Okafor wedding", problem: "The agreement still isn't signed.", solved: "Signing reminder sent.", duty: "signing_reminders", done: true },
  { icon: "people", title: "Hart wedding", problem: "You still need a second shooter.", solved: "Offer ready for your first choice.", duty: "crew_offers", done: false },
  { icon: "card", title: "Park wedding", problem: "The final balance is due in four weeks.", solved: "Final invoice raised in QuickBooks.", duty: "final_invoice", done: true },
];

const QUOTE = { kicker: "Built with a working studio", text: "I review it and send it.", name: "Gabriel Rhodes", place: "GR Productions, Madison, New Jersey" };

// The ad may only say what the product does (tests/marketing-claims.test.ts holds the site to the same).
for (const scene of SCENES) {
  for (const id of scene.duties ?? []) if (scene.acts && cueDuty(id).mode !== "on_its_own") throw new Error(`"${scene.say}" says Cue does ${id} by itself; it doesn't.`);
}
for (const item of STACK) if (item.done && cueDuty(item.duty).mode !== "on_its_own") throw new Error(`"${item.solved}" says Cue did ${item.duty} by itself; it doesn't.`);

// ── Shapes ──────────────────────────────────────────────────────────────────

/** CSS pixels, drawn at 2×. Tall keeps words out of the top 110 and bottom 210 the apps cover. */
type Shape = { name: "tall" | "feed"; W: number; H: number; capTop: number; capSize: number; visTop: number; visBottom: number; phoneW: number; deskW: number; note: { h: number; step: number; scale: number } };
const SHAPES: Record<Shape["name"], Shape> = {
  tall: { name: "tall", W: 540, H: 960, capTop: 122, capSize: 31, visTop: 296, visBottom: 740, phoneW: 340, deskW: 500, note: { h: 74, step: 86, scale: 1.1 } },
  feed: { name: "feed", W: 540, H: 675, capTop: 40, capSize: 29, visTop: 196, visBottom: 660, phoneW: 300, deskW: 490, note: { h: 66, step: 76, scale: 1 } },
};
const BEZEL = 9;
const PHONE_SRC = { w: 1080, h: 2338 };

// ── Narration and the clock ─────────────────────────────────────────────────

const FILM = JSON.parse(readFileSync(path.join(HERE, "one-saturday.voice.json"), "utf8")) as { use: string; candidates: Array<VoiceConfig & { name: string }> };
const VOICE = FILM.candidates.find((c) => c.name === FILM.use)!;

type Word = { text: string; at: number };
type Timed = Scene & { start: number; end: number; voiceAt: number; line?: Line; words: Word[]; clipTimes: Array<{ s: number; e: number }> };

/** The display words, timed from the spoken alignment ("StudioCue" is said as two words). */
function wordsOf(text: string, line: Line, voiceAt: number): Word[] {
  const { characters, character_start_times_seconds: starts } = line.alignment;
  const spokenWords: number[] = [];
  let inWord = false;
  characters.forEach((c, i) => {
    if (/\s/.test(c)) inWord = false;
    else if (!inWord) {
      inWord = true;
      spokenWords.push(starts[i]!);
    }
  });
  let k = 0;
  return text.split(/\s+/).map((w) => {
    const at = spokenWords[Math.min(k, spokenWords.length - 1)] ?? 0;
    k += spoken(w).split(/\s+/).length;
    return { text: w, at: voiceAt + at };
  });
}

async function timeline(scenes: Scene[]): Promise<Timed[]> {
  let clock = 0;
  const out: Timed[] = [];
  for (const [i, scene] of scenes.entries()) {
    const line = scene.say ? await speak(scene.say, VOICE) : undefined;
    const lead = i === 0 ? 0.12 : 0.2;
    const last = i === scenes.length - 1;
    const len = Math.max(scene.min, line ? lead + line.durationSec + (last ? 1.3 : 0.34) : scene.min);
    const voiceAt = clock + lead;
    const clipTimes: Timed["clipTimes"] = [];
    if (scene.look.kind === "clips") {
      let s = 0;
      for (const [c, clip] of scene.look.clips.entries()) {
        const e = c === scene.look.clips.length - 1 ? len : s + (clip.len ?? len);
        clipTimes.push({ s, e });
        s = e;
      }
    }
    out.push({ ...scene, start: clock, end: clock + len, voiceAt, line, words: line && scene.say ? wordsOf(scene.say, line, voiceAt) : [], clipTimes });
    clock += len;
  }
  return out;
}

// ── Pictures: frames for each clip, the email still ─────────────────────────

const even = (n: number) => Math.round(n / 2) * 2;
/** Clips are cut a little larger than shown, so the slow push-in stays sharp. */
const OVERSCAN = 1.06;

function deskSize(shape: Shape, crop: Rect) {
  const w = shape.deskW;
  return { w, h: Math.round((w * crop.h) / crop.w) };
}
function phoneScreen(shape: Shape) {
  const w = shape.phoneW - 2 * BEZEL;
  return { w, h: Math.round((w * PHONE_SRC.h) / PHONE_SRC.w) };
}

const extracted = new Map<string, string[]>();

/** JPEG frames for one clip, sized for the shape; returns their URLs relative to the page. Once per run. */
function extract(shape: Shape, clip: Exclude<Clip, { kind: "email" }>, seconds: number, key: string): string[] {
  const memo = `${shape.name}/${key}/${seconds.toFixed(3)}`;
  if (extracted.has(memo)) return extracted.get(memo)!;
  const frames = extractNow(shape, clip, seconds, key);
  extracted.set(memo, frames);
  return frames;
}

function extractNow(shape: Shape, clip: Exclude<Clip, { kind: "email" }>, seconds: number, key: string): string[] {
  const dir = path.join(WORK, "frames", shape.name, key);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const size = clip.kind === "desk" ? deskSize(shape, clip.crop) : phoneScreen(shape);
  const w = even(size.w * 2 * OVERSCAN), h = even(size.h * 2 * OVERSCAN);
  const crop = clip.kind === "desk" ? `crop=${clip.crop.w}:${clip.crop.h}:${clip.crop.x}:${clip.crop.y},` : "";
  // Desktop takes are 1×, so they're upscaled; a light unsharp keeps the type crisp.
  const sharpen = clip.kind === "desk" ? ",unsharp=5:5:0.7" : "";
  const take = clip.kind === "desk" && clip.hold ? 1 / FPS : seconds;
  ffmpeg(["-ss", clip.at.toFixed(3), "-t", take.toFixed(3), "-i", clip.file, "-vf", `fps=${FPS},${crop}scale=${w}:${h}:flags=lanczos${sharpen}`, "-q:v", "2", path.join(dir, "%04d.jpg")]);
  const count = Number(execFileSync("sh", ["-c", `ls "${dir}" | wc -l`]).toString().trim());
  if (!count) throw new Error(`No frames for ${key}: is ${clip.file} there, and longer than ${clip.at}s?`);
  return Array.from({ length: count }, (_, i) => `frames/${shape.name}/${key}/${String(i + 1).padStart(4, "0")}.jpg`);
}

const BRAND: EmailBrand = { studioName: "Alder & Muse", productName: "StudioCue", accentColor: "#2E6B4B", logoUrl: null, contactEmail: null };

/** The COI request your agent gets, from the real template, in the journey film's phone inbox. */
async function emailStill(browser: Browser) {
  const file = path.join(WORK, "email-coi.png");
  const rendered = renderEmailTemplate({
    key: "coi_request",
    brand: BRAND,
    projectName: "Ella Hart Wedding",
    values: { chaseNumber: 1, requirement: { venueLegalName: "Willow Creek Barn LLC", eventDate: "2026-11-30", dueDate: "2026-11-16", certificateHolder: "Willow Creek Barn LLC" } },
  });
  const page = await browser.newPage({ viewport: { width: PHONE_SRC.w / 3, height: Math.round(PHONE_SRC.h / 3) }, deviceScaleFactor: 3 });
  await page.setContent(inbox({ subject: rendered.subject, from: BRAND.studioName, html: rendered.html }));
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  await page.screenshot({ path: file });
  await page.close();
  return "email-coi.png";
}

// ── The page that draws each frame ──────────────────────────────────────────

const ICONS: Record<string, string> = {
  mail: '<path d="M4 6h16v12H4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="m4 7 8 6 8-6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  shield: '<path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  pen: '<path d="m15 5 4 4L9 19H5v-4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  people: '<circle cx="9" cy="8" r="3.2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M16 5.5a3 3 0 0 1 0 5.6M18 14.5c1.4.8 2.2 2.3 2.5 4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  card: '<rect x="3.5" y="6" width="17" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3.5 10h17" stroke="currentColor" stroke-width="1.8"/>',
  check: '<path d="m6 12.5 4 4 8-9" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
};

const STYLE = `
  :root{--ink:#1E2521;--cream:#F4F1EA;--green:#2E6B4B;--mint:#9CC6AA;--gold:#C9973D;--muted:#5d655f}
  html,body{margin:0;background:var(--cream);overflow:hidden}
  #stage{position:relative;overflow:hidden;font-family:"Instrument Sans",system-ui,sans-serif;color:var(--ink);
    background:radial-gradient(130% 70% at 50% 0%,#FCFBF7 0%,#F4F1EA 62%,#EEE9DE 100%)}
  .layer{position:absolute;inset:0;will-change:transform,opacity}
  .eyebrow{font-size:13px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--green);margin-bottom:10px}
  .cap{position:absolute;left:32px;right:40px}
  .cap p{margin:0;font-weight:650;letter-spacing:-.015em;line-height:1.14}
  .cap span{display:inline-block;white-space:pre}
  .desk{position:absolute;border-radius:16px;overflow:hidden;background:#fff;
    box-shadow:0 34px 70px -24px rgba(30,37,33,.38),0 0 0 1px rgba(30,37,33,.07)}
  .phone{position:absolute;background:#121614;border-radius:46px;padding:${BEZEL}px;
    box-shadow:0 40px 80px -28px rgba(30,37,33,.5)}
  .screen{position:relative;overflow:hidden;border-radius:37px;background:#fff}
  .clip img{position:absolute;inset:0;width:100%;height:100%;display:block}
  .hl{position:absolute;z-index:1;border-radius:4px;background:rgba(201,151,61,.34);mix-blend-mode:multiply;transform-origin:0 50%;transform:scaleX(0)}
  .fade{position:absolute;top:0;right:0;bottom:0;width:72px;z-index:2;background:linear-gradient(to right,rgba(255,255,255,0),#fff 85%)}
  .note{position:absolute;left:28px;right:28px;box-sizing:border-box;display:flex;align-items:center;gap:13px;
    padding:0 16px;background:rgba(255,255,255,.92);border-radius:18px;
    box-shadow:0 14px 30px -18px rgba(30,37,33,.35),0 0 0 1px rgba(30,37,33,.06)}
  .note{font-size:16px}
  .note .ic{flex:none;position:relative;width:2.4em;height:2.4em;border-radius:.75em;background:#EDEAE2;color:var(--ink)}
  .note .ic svg{position:absolute;inset:22%;width:56%;height:56%}
  .note .tx{position:relative;flex:1;min-width:0;height:2.5em}
  .note b{display:block;font-size:.95em;font-weight:650;letter-spacing:-.01em;white-space:nowrap}
  .note .line{position:absolute;left:0;right:0;top:1.3em;font-size:.88em;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .note .solved{color:var(--green);font-weight:600}
  .note .pill{flex:none;font-size:.75em;font-weight:700;letter-spacing:.04em;color:#fff;background:var(--green);border-radius:999px;padding:5px 10px}
  .quote{position:absolute;left:40px;right:40px;text-align:left}
  .quote q{display:block;font-family:Fraunces,Georgia,serif;font-style:italic;font-weight:420;font-size:46px;line-height:1.08;letter-spacing:-.02em;quotes:"\\201C" "\\201D"}
  .quote .who{margin-top:22px;font-size:16px;color:var(--muted);line-height:1.4}
  .quote .who b{color:var(--ink);font-weight:650}
  .endp{position:absolute;inset:0;background:var(--ink);color:var(--cream)}
  .endp .in{position:absolute;left:40px;right:40px}
  .endp .mark{width:62px;height:62px}
  .endp .word{font-family:Fraunces,Georgia,serif;font-size:48px;font-weight:500;letter-spacing:-.02em;margin-top:14px}
  .endp .word i{color:var(--mint);font-weight:500}
  .endp .tag{font-size:18px;color:#C9D2CB;margin-top:6px}
  .endp .rule{height:1px;background:rgba(244,241,234,.16);margin:30px 0 26px}
  .endp .offer{font-family:Fraunces,Georgia,serif;font-size:40px;line-height:1.05;letter-spacing:-.02em}
  .endp .code{display:inline-flex;align-items:center;gap:12px;margin-top:18px;border:1.5px solid var(--gold);border-radius:14px;padding:12px 18px}
  .endp .code small{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#C9D2CB;font-weight:600}
  .endp .code b{font-size:26px;letter-spacing:.06em;font-weight:700;color:#fff}
  .endp .url{margin-top:18px;font-size:20px;font-weight:600;color:var(--mint)}
`;

/** Runs in the page: builds the stage from the plan, then `render(t)` draws the frame at t seconds. */
const RENDERER = String.raw`
var XF = 0.32, D, els = [];
function c01(x){ return Math.min(1, Math.max(0, x)); }
function ease(x){ x = c01(x); return 1 - Math.pow(1 - x, 3); }
function el(tag, cls, parent, html){ var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; if (parent) parent.appendChild(e); return e; }
function svg(name){ return '<svg viewBox="0 0 24 24">' + D.icons[name] + '</svg>'; }
window.setup = function(data){
  D = data; var S = D.shape;
  var stage = el('div', '', document.body); stage.id = 'stage';
  stage.style.width = S.W + 'px'; stage.style.height = S.H + 'px';
  D.scenes.forEach(function(sc, i){
    var layer = el('div', 'layer', stage); var rec = { sc: sc, layer: layer, words: [], clips: [] };
    if (sc.look.kind === 'end') {
      var p = el('div', 'endp', layer); var inn = el('div', 'in', p);
      inn.style.top = Math.round(S.H * (S.name === 'tall' ? 0.25 : 0.14)) + 'px';
      rec.end = [
        el('div', '', inn, '<svg class="mark" viewBox="0 0 96 96"><circle cx="48" cy="52" r="26" fill="none" stroke="#F4F1EA" stroke-width="7"/><circle cx="48" cy="52" r="9" fill="#F4F1EA"/><circle cx="76" cy="20" r="7" fill="#C9973D"/></svg>'),
        el('div', 'word', inn, 'Studio<i>Cue</i>'),
        el('div', 'tag', inn, 'Meet Cue, your studio’s office manager.'),
        el('div', 'rule', inn),
        el('div', 'offer', inn, 'Half off your<br>first year'),
        el('div', '', inn, '<div class="code"><small>Code</small><b>' + D.code + '</b></div>'),
        el('div', 'url', inn, 'studio-cue.com')
      ];
      rec.panel = p;
    }
    if (sc.look.kind === 'quote') {
      var q = el('div', 'quote', layer); q.style.top = Math.round(S.H * (S.name === 'tall' ? 0.3 : 0.28)) + 'px';
      el('div', 'eyebrow', q, D.quote.kicker);
      el('q', '', q, D.quote.text);
      el('div', 'who', q, '<b>' + D.quote.name + '</b><br>' + D.quote.place);
    }
    if (sc.words.length && sc.look.kind !== 'end') {
      var cap = el('div', 'cap', layer); cap.style.top = S.capTop + 'px';
      if (sc.eyebrow) el('div', 'eyebrow', cap, sc.eyebrow);
      var p2 = el('p', '', cap); p2.style.fontSize = S.capSize + 'px';
      sc.words.forEach(function(w, k){ var s = el('span', '', p2); s.textContent = w.text + (k < sc.words.length - 1 ? ' ' : ''); rec.words.push({ w: w, e: s }); });
    }
    if (sc.look.kind === 'clips') {
      sc.look.clips.forEach(function(clip, c){
        var box, img = document.createElement('img'), holder;
        if (clip.kind === 'desk') {
          box = el('div', 'desk clip', layer); box.style.width = clip.w + 'px'; box.style.height = clip.h + 'px';
          box.style.left = Math.round((S.W - clip.w) / 2) + 'px'; box.style.top = Math.round(Math.max(S.visTop + 14, (S.visTop + S.visBottom - clip.h) / 2 - 20)) + 'px';
          box.style.transformOrigin = '50% 50%'; holder = box;
        } else {
          box = el('div', 'phone', layer); box.style.left = Math.round((S.W - clip.w - 2 * D.bezel) / 2) + 'px'; box.style.top = S.visTop + 'px';
          box.style.transformOrigin = '50% 0%';
          holder = el('div', 'screen clip', box); holder.style.width = clip.w + 'px'; holder.style.height = clip.h + 'px';
        }
        holder.appendChild(img);
        if (clip.fade) el('div', 'fade', holder);
        var mk = null;
        if (clip.mark) { mk = el('div', 'hl', holder); mk.style.left = (clip.mark.x * 100) + '%'; mk.style.top = (clip.mark.y * 100) + '%'; mk.style.width = (clip.mark.w * 100) + '%'; mk.style.height = (clip.mark.h * 100) + '%'; }
        if (clip.still) img.src = clip.still;
        rec.clips.push({ clip: clip, box: box, img: img, mk: mk, t: sc.clipTimes[c], last: '' });
      });
    }
    els.push(rec);
  });
  // The notification stack spans the stack scenes that open the ad.
  var stackScenes = D.scenes.filter(function(s){ return s.look.kind === 'stack'; });
  if (stackScenes.length) {
    var layer2 = el('div', 'layer', stage);
    D.stackLayer = { layer: layer2, end: stackScenes[stackScenes.length - 1].end, morph: stackScenes.length > 1 ? stackScenes[1] : null, notes: [] };
    D.stack.forEach(function(n, i){
      var note = el('div', 'note', layer2); note.style.top = (S.visTop + 10 + i * S.note.step) + 'px'; note.style.height = S.note.h + 'px'; note.style.fontSize = S.note.scale + 'em';
      var ic = el('div', 'ic', note, svg(n.icon) + '<span class="chk" style="position:absolute;inset:0;border-radius:inherit;background:#2E6B4B;color:#fff;opacity:0">' + svg('check') + '</span>');
      var tx = el('div', 'tx', note); el('b', '', tx).textContent = n.title;
      var a = el('div', 'line', tx); a.textContent = n.problem;
      var b = el('div', 'line solved', tx); b.textContent = n.solved; b.style.opacity = 0;
      var pill = el('div', 'pill', note, 'Cue'); pill.style.opacity = 0;
      D.stackLayer.notes.push({ note: note, chk: ic.querySelector('.chk'), a: a, b: b, pill: pill });
    });
  }
};
function place(layer, t, sc, first, last){
  var p = first ? 1 : ease((t - sc.start) / XF), q = last ? 0 : ease((t - sc.end) / XF);
  var on = t >= sc.start - 0.001 && (last || t <= sc.end + XF);
  layer.style.display = on ? 'block' : 'none';
  layer.style.opacity = p * (1 - q);
  layer.style.transform = 'translateY(' + ((1 - p) * 30 - q * 30).toFixed(2) + 'px)';
  return on;
}
window.render = function(t){
  var waits = [], n = els.length;
  els.forEach(function(rec, i){
    var sc = rec.sc;
    if (!place(rec.layer, t, sc, i === 0, i === n - 1)) return;
    var local = t - sc.start;
    if (rec.panel) {
      var w = ease(local / 0.45);
      rec.panel.style.clipPath = 'inset(' + ((1 - w) * 100).toFixed(2) + '% 0 0 0)';
      rec.layer.style.opacity = 1; rec.layer.style.transform = 'none';
      rec.end.forEach(function(e, k){ var a = ease((local - 0.2 - k * 0.09) / 0.4); e.style.opacity = a; e.style.transform = 'translateY(' + ((1 - a) * 16).toFixed(2) + 'px)'; });
    }
    rec.words.forEach(function(x, k){
      var a = ease((t - x.w.at + 0.05) / 0.14);
      var next = k < rec.words.length - 1 ? rec.words[k + 1].w.at : x.w.at + 0.45;
      x.e.style.opacity = a;
      x.e.style.transform = 'translateY(' + ((1 - a) * 0.3).toFixed(3) + 'em)';
      x.e.style.color = t >= x.w.at && t < next ? '#2E6B4B' : '#1E2521';
    });
    rec.clips.forEach(function(c, k){
      var on = local >= c.t.s - 0.001 && local <= c.t.e + 0.25;
      c.box.style.display = on ? 'block' : 'none';
      if (!on) return;
      // A dip, not a dissolve: the outgoing shot is mostly gone before the next settles.
      var fin = k === 0 ? 1 : ease((local - c.t.s - 0.06) / 0.22);
      var nx = rec.clips[k + 1], fout = nx ? ease((local - nx.t.s) / 0.14) : 0;
      if (c.mk) c.mk.style.transform = 'scaleX(' + ease((local - c.t.s - c.clip.mark.at) / 0.45).toFixed(4) + ')';
      var push = 1 + 0.045 * c01((local - c.t.s) / (c.t.e - c.t.s + 0.25));
      c.box.style.opacity = fin * (1 - fout);
      c.box.style.zIndex = 10 + k;
      c.box.style.transform = 'translateY(' + ((1 - fin) * 18).toFixed(2) + 'px) scale(' + push.toFixed(4) + ')';
      if (c.clip.frames) {
        var f = Math.max(0, Math.min(c.clip.frames.length - 1, Math.floor((local - c.t.s) * 30 + 1e-6)));
        var src = c.clip.frames[f];
        if (src !== c.last) { c.last = src; c.img.src = src; waits.push(c.img.decode().catch(function(){})); }
      }
    });
  });
  var L = D.stackLayer;
  if (L) {
    var q = ease((t - L.end) / XF), on = t <= L.end + XF;
    L.layer.style.display = on ? 'block' : 'none';
    L.layer.style.opacity = 1 - q; L.layer.style.transform = 'translateY(' + (-q * 30).toFixed(2) + 'px)';
    L.notes.forEach(function(x, i){
      var at = 0.02 + i * 0.36, a = i === 0 ? 1 : ease((t - at) / 0.28);
      var buzz = i === 0 ? 0 : Math.sin(c01((t - at - 0.2) / 0.3) * Math.PI * 4) * 3 * (1 - c01((t - at - 0.2) / 0.3));
      x.note.style.opacity = a;
      x.note.style.transform = 'translateX(' + ((1 - a) * 46 + buzz).toFixed(2) + 'px) scale(' + (0.96 + 0.04 * a).toFixed(4) + ')';
      var m = L.morph ? ease((t - (L.morph.voiceAt + 0.35 + i * 0.3)) / 0.3) : 0;
      x.chk.style.opacity = m; x.a.style.opacity = 1 - m; x.b.style.opacity = m; x.pill.style.opacity = m;
    });
  }
  return Promise.all(waits);
};
`;

type PageClip = { kind: string; w: number; h: number; fade?: boolean; mark?: Rect & { at: number }; frames?: string[]; still?: string };

/** Frames [from, to) of the cut (all of it by default), encoded to `out`. */
async function renderPicture(browser: Browser, shape: Shape, scenes: Timed[], code: string, out: string, emailFile: string, range?: { from: number; to: number }) {
  const length = scenes[scenes.length - 1]!.end;
  const data = {
    shape,
    bezel: BEZEL,
    code,
    icons: ICONS,
    quote: QUOTE,
    stack: STACK,
    scenes: scenes.map((sc) => {
      const look =
        sc.look.kind === "clips"
          ? {
              kind: "clips",
              clips: sc.look.clips.map((clip, c): PageClip => {
                const t = sc.clipTimes[c]!;
                if (clip.kind === "email") return { kind: "phone", ...phoneScreen(shape), still: emailFile };
                const size = clip.kind === "desk" ? deskSize(shape, clip.crop) : phoneScreen(shape);
                const mark = clip.kind === "desk" && clip.mark ? { x: clip.mark.x / clip.crop.w, y: clip.mark.y / clip.crop.h, w: clip.mark.w / clip.crop.w, h: clip.mark.h / clip.crop.h, at: clip.mark.at } : undefined;
                return { kind: clip.kind, ...size, fade: clip.kind === "desk" && clip.fade, mark, frames: extract(shape, clip, t.e - t.s + 0.3, `${sc.id}-${c}`) };
              }),
            }
          : sc.look;
      return { id: sc.id, eyebrow: sc.eyebrow, start: sc.start, end: sc.end, voiceAt: sc.voiceAt, words: sc.words, clipTimes: sc.clipTimes, look };
    }),
  };
  const html = `<!doctype html><html><head><meta charset="utf-8">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400..700;1,9..144,400..700&family=Instrument+Sans:wght@400..700&display=block" rel="stylesheet">
    <style>${STYLE}</style></head><body><script>${RENDERER}</script></body></html>`;
  const pageFile = path.join(WORK, `page-${shape.name}.html`);
  writeFileSync(pageFile, html);
  const page = await browser.newPage({ viewport: { width: shape.W, height: shape.H }, deviceScaleFactor: 2 });
  await page.goto(pathToFileURL(pageFile).href);
  await page.evaluate((d) => (window as unknown as { setup: (d: unknown) => void }).setup(d), data);
  await page.evaluate(async () => {
    await Promise.all(['650 31px "Instrument Sans"', '400 15px "Instrument Sans"', 'italic 420 46px Fraunces', '500 48px Fraunces'].map((f) => document.fonts.load(f)));
    await document.fonts.ready;
  });
  const missing = await page.evaluate(() => ["Instrument Sans", "Fraunces"].filter((f) => !document.fonts.check(`16px "${f}"`)));
  if (missing.length) throw new Error(`Fonts didn't load: ${missing.join(", ")} (needs fonts.googleapis.com).`);

  const encoder = spawn("ffmpeg", [
    "-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "-",
    "-c:v", "libx264", "-preset", "slow", "-crf", "17", "-pix_fmt", "yuv420p", "-r", String(FPS), "-movflags", "+faststart", out,
  ], { stdio: ["pipe", "inherit", "inherit"] });
  const done = new Promise<void>((resolve, reject) => encoder.on("close", (c) => (c === 0 ? resolve() : reject(new Error(`ffmpeg exited ${c}`)))));
  const frames = Math.ceil(length * FPS);
  const from = range?.from ?? 0, to = range?.to ?? frames;
  for (let f = from; f < to; f++) {
    await page.evaluate((t) => (window as unknown as { render: (t: number) => Promise<unknown> }).render(t), f / FPS);
    const jpg = await page.screenshot({ type: "jpeg", quality: 93 });
    if (!encoder.stdin.write(jpg)) await new Promise((r) => encoder.stdin.once("drain", r));
    if (!range && f % 150 === 0) process.stdout.write(`   ${shape.name} ${(f / FPS).toFixed(0)}s/${length.toFixed(0)}s\n`);
  }
  encoder.stdin.end();
  await done;
  await page.close();
  return length;
}

// ── Sound ───────────────────────────────────────────────────────────────────

/** Integrated loudness of a file, in LUFS. */
function loudness(file: string) {
  const run = spawnSync("ffmpeg", ["-hide_banner", "-i", file, "-af", "ebur128", "-f", "null", "-"], { encoding: "utf8" });
  const found = [...run.stderr.matchAll(/I:\s+(-?[\d.]+) LUFS/g)].pop();
  if (!found) throw new Error(`Couldn't measure ${file}.`);
  return Number(found[1]);
}

/**
 * Social audio is music-forward (Conor, 2026-10-19: "more upbeat, louder
 * music throughout"): the bed is set (MUSIC.bed) about a decibel under her
 * -16, and dips only ~4 dB while she speaks, where the films duck ~9. The
 * music-only cut is the bed at -14, the level the apps play at. Rock's
 * guitars fill the voice's range (~9 dB more 250 Hz–1.5 kHz), so under her
 * it's carved at 1 and 2.6 kHz and dips a little harder. A `track` is a
 * recorded bed (music-takes.ts, or a licensed file) mixed the same way as
 * rock; it starts where its lift meets the end card, so a shorter cut joins
 * the track part way in.
 */
type Music = "social" | "rock" | "track";
type Track = { file: string; liftAt: number };
const MUSIC: Record<Music, { bed: number; carve: string; duck: string }> = {
  social: { bed: -17, carve: "", duck: "threshold=0.06:ratio=2.2:attack=15:release=220:knee=6" },
  rock: { bed: -17.5, carve: ",equalizer=f=1000:t=o:w=1.2:g=-3,equalizer=f=2600:t=o:w=1:g=-4", duck: "threshold=0.05:ratio=2.8:attack=12:release=220:knee=6" },
  track: { bed: -17.5, carve: ",equalizer=f=1000:t=o:w=1.2:g=-3,equalizer=f=2600:t=o:w=1:g=-4", duck: "threshold=0.05:ratio=2.8:attack=12:release=220:knee=6" },
};

function mix(picture: string, scenes: Timed[], length: number, out: string, withVoice: boolean, music: Music, track?: Track) {
  const tune = MUSIC[music];
  const endAt = scenes.find((s) => s.look.kind === "end")?.start ?? length - 3;
  let bed: string, from = 0;
  if (music === "track") {
    if (!track) throw new Error("A track mix needs --music-file.");
    bed = track.file;
    from = Math.max(0, track.liftAt - endAt);
    if (from + length > probe(bed) + 0.05) throw new Error(`${bed} runs out before the cut ends (needs ${(from + length).toFixed(1)} s).`);
  } else {
    bed = path.join(WORK, `bed-${music}-${Math.round(length * 10)}.wav`);
    if (!existsSync(bed)) makeMusicBed(length + 1, bed, 43, music, { liftAt: endAt });
  }
  const gain = (target: number) => (target - loudness(bed)).toFixed(2);
  const bedChain = (target: number, carve = "") =>
    `[1:a]atrim=${from.toFixed(3)}:${(from + length).toFixed(3)},asetpts=PTS-STARTPTS${from ? ",afade=t=in:d=0.04" : ""},aformat=sample_rates=44100:channel_layouts=stereo,highpass=f=40,volume=${gain(target)}dB${carve},afade=t=out:st=${(length - 1).toFixed(3)}:d=1`;
  if (!withVoice) {
    ffmpeg([
      "-i", picture, "-i", bed,
      "-filter_complex", `${bedChain(-14)},alimiter=limit=0.89:level=false[a]`,
      "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ac", "2", "-ar", "44100", "-movflags", "+faststart", "-shortest", out,
    ]);
    return;
  }
  const placed = scenes.filter((s) => s.line).map((s) => ({ line: s.line!, at: s.voiceAt }));
  const voice = path.join(WORK, `${path.basename(out, ".mp4")}-voice.mp4`);
  const delays = placed.map((p, i) => `[${i + 1}:a]adelay=${Math.round(p.at * 1000)}:all=1[a${i}]`).join(";");
  ffmpeg([
    "-i", picture, ...placed.flatMap((p) => ["-i", p.line.audioPath]),
    "-filter_complex",
    `${delays};${placed.map((_, i) => `[a${i}]`).join("")}amix=inputs=${placed.length}:normalize=0:dropout_transition=0,apad,atrim=0:${length.toFixed(3)},loudnorm=I=-16:TP=-1.5:LRA=11[aout]`,
    "-map", "0:v", "-map", "[aout]", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-ac", "1", "-ar", "44100", voice,
  ]);
  ffmpeg([
    "-i", voice, "-i", bed,
    "-filter_complex",
    [
      "[0:a]pan=stereo|c0=c0|c1=c0,aresample=44100,asplit=2[voice][key]",
      `${bedChain(tune.bed, tune.carve)}[bed]`,
      `[bed][key]sidechaincompress=${tune.duck}[ducked]`,
      "[voice][ducked]amix=inputs=2:normalize=0:duration=first,alimiter=limit=0.89:level=false[a]",
    ].join(";"),
    "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ac", "2", "-ar", "44100", "-movflags", "+faststart", out,
  ]);
}

// ── Partner versions ────────────────────────────────────────────────────────

type Partner = { name: string; code: string };
const folderOf = (p: Partner) => `${p.name.replace(/[/\\:*?"<>|]/g, "-")} (${p.code})`;

function concat(parts: string[], out: string) {
  const list = `${out}.txt`;
  writeFileSync(list, parts.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n") + "\n");
  ffmpeg(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", out]);
}
function mux(video: string, sound: string, out: string) {
  ffmpeg(["-i", video, "-i", sound, "-map", "0:v", "-map", "1:a", "-c", "copy", "-shortest", "-movflags", "+faststart", out]);
}

/**
 * One cut for every partner, their code on the end card. Only the end card
 * differs, so everything before it renders once and each partner gets just
 * the end card's frames, joined on (both halves are the same encoder
 * settings, the join is on a keyframe). The sound doesn't depend on the code,
 * so it's mixed once. Output: DIR/partners/<name (CODE)>/.
 */
async function partnerCut(browser: Browser, cut: { name: string; shape: Shape; scenes: Timed[]; music?: boolean }, email: string, partners: Partner[], mixAs: Music, track?: Track) {
  const scenes = cut.scenes;
  const length = scenes[scenes.length - 1]!.end;
  const end = scenes.find((sc) => sc.look.kind === "end");
  if (!end) throw new Error(`${cut.name} has no end card.`);
  const split = Math.round(end.start * FPS), total = Math.ceil(length * FPS);
  const prefix = path.join(WORK, `${cut.name}-prefix.mp4`);
  await renderPicture(browser, cut.shape, scenes, partners[0]!.code, prefix, email, { from: 0, to: split });
  const sound = path.join(WORK, `${cut.name}-sound.mp4`);
  const musicOnly = path.join(WORK, `${cut.name}-music-only.mp4`);
  const cover = path.join(WORK, `${cut.name}-cover.jpg`);
  for (const [i, partner] of partners.entries()) {
    const dir = path.join(DIR, "partners", folderOf(partner));
    mkdirSync(dir, { recursive: true });
    const tail = path.join(WORK, `${cut.name}-tail.mp4`);
    await renderPicture(browser, cut.shape, scenes, partner.code, tail, email, { from: split, to: total });
    const picture = path.join(WORK, `${cut.name}-joined.mp4`);
    rmSync(picture, { force: true });
    concat([prefix, tail], picture);
    if (i === 0) {
      mix(picture, scenes, length, sound, true, mixAs, track);
      if (cut.music) mix(picture, scenes, length, musicOnly, false, mixAs, track);
      ffmpeg(["-ss", (scenes[0]!.end - 0.12).toFixed(2), "-i", picture, "-frames:v", "1", "-q:v", "2", cover]);
    }
    mux(picture, sound, path.join(dir, `${cut.name}.mp4`));
    if (cut.music) mux(picture, musicOnly, path.join(dir, `${cut.name}.music-only.mp4`));
    execFileSync("cp", [cover, path.join(dir, `${cut.name}.jpg`)]);
    console.log(`   ✓ ${cut.name} · ${folderOf(partner)}`);
  }
}

// ── Run ─────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const codeAt = args.indexOf("--code");
const code = (codeAt >= 0 ? args[codeAt + 1] : "GABEVZ4D") ?? "";
if (!/^[A-Z0-9]{4,16}$/.test(code)) throw new Error(`"${code}" isn't a code (capitals and digits, 4–16).`);
const musicAt = args.indexOf("--music");
const music = (musicAt >= 0 ? args[musicAt + 1] : "social") as Music;
if (!(music in MUSIC)) throw new Error(`Unknown music "${music}": ${Object.keys(MUSIC).join(" or ")}.`);
/** Remix the sound over pictures already rendered (they don't depend on the music). */
const reusePicture = args.includes("--reuse-picture");
const fileAt = args.indexOf("--music-file");
const liftArg = args.indexOf("--music-lift");
const track: Track | undefined = fileAt >= 0 ? { file: path.resolve(args[fileAt + 1] ?? ""), liftAt: liftArg >= 0 ? Number(args[liftArg + 1]) : 25.9 } : undefined;
if (track && !existsSync(track.file)) throw new Error(`No music file at ${track.file}.`);
if (track && !(track.liftAt > 0)) throw new Error("--music-lift is the second the track's lift lands, e.g. 25.9.");
const mixAs: Music = track ? "track" : music;
const partnersAt = args.indexOf("--partners");
const partners = partnersAt >= 0 ? (JSON.parse(readFileSync(path.resolve(args[partnersAt + 1] ?? ""), "utf8")) as Partner[]) : undefined;
for (const p of partners ?? []) if (!p.name || !/^[A-Z0-9]{4,16}$/.test(p.code)) throw new Error(`Partner ${JSON.stringify(p)} needs a name and a code.`);
const valueAt = new Set([codeAt, musicAt, fileAt, liftArg, partnersAt].filter((i) => i >= 0).map((i) => i + 1));
const wanted = args.find((a, i) => !a.startsWith("--") && !valueAt.has(i)) ?? "all";
if (!["all", "tall", "feed", "short"].includes(wanted)) throw new Error(`Unknown cut "${wanted}": all, tall, feed or short.`);

mkdirSync(WORK, { recursive: true });
const full = await timeline(SCENES);
const short = await timeline(SCENES.filter((s) => s.short));
const browser = await chromium.launch({ channel: "chrome" });
try {
  const email = await emailStill(browser);
  const cuts: Array<{ name: string; shape: Shape; scenes: Timed[]; music?: boolean }> = [];
  if (wanted === "all" || wanted === "tall") cuts.push({ name: "meet-cue-9x16", shape: SHAPES.tall, scenes: full, music: true });
  if (wanted === "all" || wanted === "feed") cuts.push({ name: "meet-cue-4x5", shape: SHAPES.feed, scenes: full });
  if (wanted === "all" || wanted === "short") cuts.push({ name: "meet-cue-15s-9x16", shape: SHAPES.tall, scenes: short });
  for (const cut of cuts) {
    if (partners) {
      await partnerCut(browser, cut, email, partners, mixAs, track);
      continue;
    }
    const picture = path.join(WORK, `${cut.name}-picture.mp4`);
    const length = reusePicture && existsSync(picture) ? cut.scenes[cut.scenes.length - 1]!.end : await renderPicture(browser, cut.shape, cut.scenes, code, picture, email);
    const suffix = track ? `.${path.basename(track.file, path.extname(track.file))}` : music === "social" ? "" : `.${music}`;
    const out = path.join(DIR, `${cut.name}${suffix}.mp4`);
    mix(picture, cut.scenes, length, out, true, mixAs, track);
    if (cut.music) mix(picture, cut.scenes, length, path.join(DIR, `${cut.name}${suffix}.music-only.mp4`), false, mixAs, track);
    // The cover: the pile-up complete, with the whole question on screen.
    const hook = cut.scenes[0]!;
    ffmpeg(["-ss", (hook.end - 0.12).toFixed(2), "-i", out, "-frames:v", "1", "-q:v", "2", path.join(DIR, `${cut.name}.jpg`)]);
    console.log(`✓ ${path.basename(out)}: ${probe(out).toFixed(1)}s → ${out}`);
    for (const s of cut.scenes) console.log(`   ${s.start.toFixed(2).padStart(6)}–${s.end.toFixed(2).padStart(6)}  ${s.id.padEnd(9)} ${s.say ?? ""}`);
  }
} finally {
  await browser.close();
}
writeFileSync(
  path.join(DIR, "transcript.txt"),
  [`Narration (Matilda, ${VOICE.modelId}):`, ...SCENES.flatMap((s) => (s.say ? [s.say] : [])), "", `Quote: "${QUOTE.text}" ${QUOTE.name}, ${QUOTE.place}`, `End card code: ${code}`].join("\n") + "\n",
);
