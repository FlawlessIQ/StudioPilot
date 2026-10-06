/**
 * Short cuts of the journey film, for the website and social
 * (docs/marketing-video-onboarding-plan-2026-10-02.md §1).
 *
 *   npx tsx scripts/how-to/cutdowns.ts              # everything below
 *   npx tsx scripts/how-to/cutdowns.ts mk-teaser    # one
 *
 * Made from the chapter takes, never re-recorded: each chapter is made with
 * HOW_TO_KEEP_STREAMS=1, which keeps every screen at full size and the step
 * marks on the chapter's own timeline (out/journey-<n>/streams/). A shot is
 * "chapter, step, how long": the shot starts where that step starts.
 *
 *   mk-hero-loop, mk-loop-*   16:9 silent loops from the composed chapters
 *   mk-teaser                 16:9, ~70 s, Matilda (paced) over the lively bed
 *   social-couple, social-crew, social-year
 *                             9:16, ~30 s, one phone filling the frame,
 *                             narration, burned-in captions, music
 *
 * Output: $HOW_TO_HOME/out/<id>/<id>.mp4 (+ .jpg poster, + .vtt where voiced).
 * Publish the website ones with `publish-media.ts`; the social ones are files
 * to post.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { captions } from "./lib/assemble";
import { makeMusicBed, withMusic, type BedStyle } from "./lib/music";
import { HOW_TO_HOME, speak, speakPaced, type Line, type VoiceConfig } from "./lib/voice";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HOW_TO_HOME, "out");
const ffmpeg = (args: string[]) => execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...args], { stdio: "inherit" });
const probe = (file: string) =>
  Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString().trim());

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
  if (match && !process.env[match[1]!]) process.env[match[1]!] = match[2]!.replace(/^["']|["']$/g, "");
}
const voiceFrom = (file: string) => JSON.parse(readFileSync(path.join(HERE, file), "utf8")) as VoiceConfig;
// The loops and the social cuts keep Brian; the trial teaser is Matilda, as the journey film (Conor, 2026-10-06).
const voice = voiceFrom("voice.config.json");
const TEASER_VOICE = voiceFrom("voice.journey.json");

/**
 * The chapter takes these shots were chosen from, pinned: the journey was
 * re-recorded (new voice, page loads cut), which moved every step.
 * out/cutdown-takes/journey-<n> holds those takes; without it, the current ones.
 */
const PINNED = existsSync(path.join(OUT, "cutdown-takes")) ? path.join(OUT, "cutdown-takes") : OUT;
/** Which takes chapter() reads: pinned for the loops and social cuts; the teaser uses the current journey (no loading screens). */
let TAKES = PINNED;

type Mark = { step: number; at: number; on: string; layout: string };
type Shot = { ch: number; step: number; len: number; skip?: number };

function chapter(n: number) {
  const dir = path.join(TAKES, `journey-${n}`);
  const marks = JSON.parse(readFileSync(path.join(dir, "streams", "marks.json"), "utf8")) as Mark[];
  const composed = path.join(dir, `journey-${n}.voice.mp4`);
  return { dir, marks, composed, length: probe(composed) };
}

/** Where a shot starts and ends on its chapter's timeline, kept inside its step. */
function window(shot: Shot) {
  const c = chapter(shot.ch);
  const index = c.marks.findIndex((m) => m.step === shot.step);
  if (index < 0) throw new Error(`journey-${shot.ch} has no step ${shot.step}.`);
  const start = c.marks[index]!.at + (shot.skip ?? 0);
  const stepEnd = index + 1 < c.marks.length ? c.marks[index + 1]!.at : c.length;
  return { c, start, end: Math.min(stepEnd, start + shot.len) };
}

/** Joins picture-only clips with a short dissolve between each. */
function joinClips(clips: string[], out: string, fade = 0.35) {
  if (clips.length === 1) return void ffmpeg(["-i", clips[0]!, "-an", "-c:v", "copy", out]);
  const lengths = clips.map(probe);
  const inputs = clips.flatMap((c) => ["-i", c]);
  let graph = "";
  let last = "[0:v]";
  let offset = 0;
  for (let i = 1; i < clips.length; i++) {
    offset += lengths[i - 1]! - fade;
    const label = `[x${i}]`;
    graph += `${last}[${i}:v]xfade=transition=fade:duration=${fade}:offset=${offset.toFixed(3)}${label};`;
    last = label;
  }
  ffmpeg([...inputs, "-filter_complex", graph.replace(/;$/, ""), "-map", last, "-an", "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out]);
}

/** One shot of the composed 16:9 chapter, picture only, held on its last frame if `hold` asks for more. */
function landscapeShot(shot: Shot, file: string, hold = 0) {
  const { c, start, end } = window(shot);
  const pad = hold > 0 ? `,tpad=stop_mode=clone:stop_duration=${hold.toFixed(3)}` : "";
  ffmpeg(["-ss", start.toFixed(3), "-t", (end - start).toFixed(3), "-i", c.composed, "-an", "-vf", `fps=30,format=yuv420p${pad}`, "-c:v", "libx264", "-preset", "medium", "-crf", "16", file]);
}

function poster(video: string, at: number, file: string) {
  ffmpeg(["-ss", at.toFixed(2), "-i", video, "-frames:v", "1", "-q:v", "3", file]);
}

/** Clears a cut's folder for a new render, keeping any rollback copy (<id>.brian.*). */
function fresh(id: string) {
  const dir = path.join(OUT, id);
  if (existsSync(dir))
    for (const name of readdirSync(dir)) if (!name.includes(".brian.")) rmSync(path.join(dir, name), { recursive: true, force: true });
  mkdirSync(path.join(dir, "work"), { recursive: true });
  return dir;
}

// Shots that open a page skip its first seconds: the portal's "Opening your…"
// loading line is not something to put on a homepage.

// ── Loops ──────────────────────────────────────────────────────────────────

const LOOPS: Record<string, Shot[]> = {
  "mk-hero-loop": [
    { ch: 1, step: 3, len: 3.5, skip: 2 },
    { ch: 1, step: 5, len: 5.5, skip: 3.2 },
    { ch: 1, step: 6, len: 3 },
    { ch: 1, step: 8, len: 4.5 },
  ],
  // Skips Today's opening seconds: the demo studio's overdue headline isn't the story.
  "mk-loop-today": [{ ch: 1, step: 5, len: 7, skip: 3.2 }],
  "mk-loop-proposal": [{ ch: 3, step: 5, len: 7, skip: 2.5 }],
  "mk-loop-sign": [{ ch: 3, step: 8, len: 9 }],
  "mk-loop-crew": [{ ch: 4, step: 3, len: 4.5 }, { ch: 4, step: 4, len: 4 }],
  "mk-loop-timeline": [{ ch: 6, step: 8, len: 9 }],
  "mk-loop-gallery": [{ ch: 8, step: 8, len: 4, skip: 2.5 }, { ch: 8, step: 10, len: 4, skip: 4.5 }],
};

function makeLoop(id: string) {
  const dir = fresh(id);
  const clips = LOOPS[id]!.map((shot, i) => {
    const file = path.join(dir, "work", `s${i}.mp4`);
    landscapeShot(shot, file);
    return file;
  });
  const joined = path.join(dir, "work", "joined.mp4");
  joinClips(clips, joined);
  // Small enough to autoplay on a homepage: 1280 wide, no audio, a fade in
  // and out so the loop seam doesn't jump.
  const length = probe(joined);
  const out = path.join(dir, `${id}.mp4`);
  ffmpeg([
    "-i", joined, "-an",
    "-vf", `scale=1280:-2:flags=lanczos,fade=t=in:d=0.4,fade=t=out:st=${(length - 0.4).toFixed(3)}:d=0.4,format=yuv420p`,
    "-c:v", "libx264", "-preset", "slow", "-crf", "27", "-profile:v", "main", "-movflags", "+faststart", out,
  ]);
  poster(out, Math.min(2.5, length / 2), path.join(dir, `${id}.jpg`));
  rmSync(path.join(dir, "work"), { recursive: true, force: true });
  console.log(`✓ ${id}: ${length.toFixed(1)}s, ${Math.round(readFileSync(out).length / 1024)} KB`);
}

// ── Voiced cuts: beats of narration over shots ─────────────────────────────

type Beat = { say?: string; shots: Shot[]; card?: { eyebrow?: string; title: string; subtitle?: string } };

/** Paced voices (a config with `pacing`) speak each sentence on their own, with the film's pauses between. */
async function narrate(beats: Beat[], with_: VoiceConfig = voice) {
  const said = beats.map((b) => b.say).filter((s): s is string => !!s);
  const lines = new Map<number, Line>();
  let k = 0;
  for (const [i, beat] of beats.entries()) {
    if (!beat.say) continue;
    const context = with_.modelId === "eleven_v3" ? {} : { previousText: said[k - 1], nextText: said[k + 1] };
    lines.set(i, await (with_.pacing ? speakPaced : speak)(beat.say, with_, context));
    k++;
  }
  return lines;
}

const firstWord = (line: Line) => line.alignment.character_start_times_seconds.find((_, i) => /\S/.test(line.alignment.characters[i] ?? "")) ?? 0;

async function cardPng(card: NonNullable<Beat["card"]>, size: { w: number; h: number }, file: string) {
  const { card: html } = await import("./lib/recorder");
  const browser = await chromium.launch({ channel: "chrome" });
  const page = await browser.newPage({ viewport: { width: size.w / 2, height: size.h / 2 }, deviceScaleFactor: 2 });
  await page.setContent(html(card.eyebrow, card.title, card.subtitle));
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(900);
  await page.screenshot({ path: file });
  await browser.close();
}

/**
 * Lays narration over beats: each beat lasts as long as its shots or its
 * line (plus a breath), whichever is longer — shots run longer into their
 * step to fill it, and hold their last frame only if the step runs out.
 */
async function voiced(
  id: string,
  beats: Beat[],
  renderShot: (shot: Shot, file: string, length: number) => void | Promise<void>,
  size: { w: number; h: number },
  with_: VoiceConfig = voice,
) {
  const dir = fresh(id);
  const lines = await narrate(beats, with_);
  // A paced voice (the teaser) gets One Saturday's rules: 1.5 s before a
  // first word that opens the film, each beat's first word 0.1 s after its
  // cut (never before), and about stepGap between beats.
  const paced = with_.pacing;
  const boundaries: Array<{ beat: number; cut: number; word: number }> = [];
  let liftAt = 0;
  const parts: string[] = [];
  const placed: Array<{ step: number; line: Line; at: number }> = [];
  let clock = 0;
  for (const [i, beat] of beats.entries()) {
    const line = lines.get(i);
    const planned = beat.shots.reduce((sum, s) => sum + s.len, 0) || 3;
    const last = i === beats.length - 1;
    if (last) liftAt = clock;
    const offset = line && paced ? Math.max(0, (i === 0 ? 1.5 : 0.1) - firstWord(line)) : 0.15;
    const need = line ? (paced ? offset + line.durationSec + (last ? 1.3 : paced.stepGap - 0.1) : line.durationSec + 0.6) : planned;
    const scale = Math.max(1, need / planned);
    if (line) {
      placed.push({ step: i, line, at: clock + offset });
      boundaries.push({ beat: i, cut: clock, word: clock + offset + firstWord(line) });
    }
    if (beat.card) {
      const png = path.join(dir, "work", `card-${i}.png`);
      await cardPng(beat.card, size, png);
      const file = path.join(dir, "work", `b${i}-card.mp4`);
      ffmpeg(["-loop", "1", "-t", need.toFixed(3), "-i", png, "-vf", `scale=${size.w}:${size.h},fps=30,format=yuv420p`, "-c:v", "libx264", "-preset", "medium", "-crf", "16", file]);
      parts.push(file);
      clock += need;
      continue;
    }
    for (const [j, shot] of beat.shots.entries()) {
      const file = path.join(dir, "work", `b${i}-s${j}.mp4`);
      await renderShot({ ...shot, len: shot.len * scale }, file, shot.len * scale);
      parts.push(file);
      clock += probe(file);
    }
  }
  // Picture: straight cuts (each beat is its own thought).
  writeFileSync(path.join(dir, "work", "parts.txt"), parts.map((p) => `file '${p}'`).join("\n") + "\n");
  const picture = path.join(dir, "work", "picture.mp4");
  ffmpeg(["-f", "concat", "-safe", "0", "-i", path.join(dir, "work", "parts.txt"), "-c:v", "libx264", "-preset", "slow", "-crf", "19", "-pix_fmt", "yuv420p", picture]);
  const length = probe(picture);
  // Voice: each line where its beat starts, -16 LUFS, mono → stereo later.
  const inputs = placed.flatMap((p) => ["-i", p.line.audioPath]);
  const delays = placed.map((p, i) => `[${i + 1}:a]adelay=${Math.round(p.at * 1000)}:all=1[a${i}]`).join(";");
  const voiceTrack = path.join(dir, "work", "voice.mp4");
  ffmpeg([
    "-i", picture, ...inputs,
    "-filter_complex", `${delays};${placed.map((_, i) => `[a${i}]`).join("")}amix=inputs=${placed.length}:normalize=0:dropout_transition=0,apad,atrim=0:${length.toFixed(3)},loudnorm=I=-16:TP=-1.5:LRA=11[aout]`,
    "-map", "0:v", "-map", "[aout]", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-ac", "1", "-ar", "44100", voiceTrack,
  ]);
  writeFileSync(path.join(dir, `${id}.vtt`), captions(placed));
  if (paced)
    for (const x of boundaries) {
      const lead = x.word - x.cut;
      console.log(`   beat ${x.beat}: cut ${x.cut.toFixed(2)}  first word ${x.word.toFixed(2)}  (${lead.toFixed(2)} s)`);
      if (lead < 0) throw new Error(`Beat ${x.beat}'s line starts before its picture.`);
    }
  return { dir, voiceTrack, length, placed, liftAt };
}

async function withBed(dir: string, id: string, voiceTrack: string, length: number, seed: number, style: BedStyle = "calm", liftAt?: number) {
  const bed = path.join(dir, "work", "bed.wav");
  makeMusicBed(length + 1, bed, seed, style, { liftAt });
  const out = path.join(dir, `${id}.mp4`);
  withMusic(voiceTrack, bed, 0, length, out, style);
  return out;
}

// ── The teaser (16:9) ──────────────────────────────────────────────────────

const TEASER: Beat[] = [
  { card: { eyebrow: "StudioCue", title: "One wedding, start to finish", subtitle: "A year of work, in a minute." }, shots: [{ ch: 1, step: 0, len: 2.2 }] },
  { say: "A couple finds you. Their inquiry lands on your Today screen, with a reply already written.", shots: [{ ch: 1, step: 3, len: 2, skip: 2.5 }, { ch: 1, step: 5, len: 4, skip: 3.2 }] },
  { say: "You read it, and send.", shots: [{ ch: 1, step: 6, len: 2.5 }] },
  { say: "They book a call, and accept your proposal on their phone.", shots: [{ ch: 2, step: 1, len: 2.5 }, { ch: 3, step: 5, len: 3, skip: 2.5 }] },
  { say: "The agreement goes out, signed for you. They sign, pay the retainer, and they're booked. No chasing.", shots: [{ ch: 3, step: 8, len: 3.5 }, { ch: 3, step: 13, len: 3.5 }] },
  { say: "Your second shooter says yes in one tap.", shots: [{ ch: 4, step: 4, len: 3 }] },
  { say: "Months later, StudioCue drafts the day from their answers. Your couple approves it, and your crew gets the day sheet.", shots: [{ ch: 6, step: 5, len: 3 }, { ch: 6, step: 8, len: 3 }, { ch: 6, step: 10, len: 3, skip: 5 }] },
  { say: "Then the gallery, the review, and the job wraps itself up.", shots: [{ ch: 8, step: 8, len: 2.5, skip: 2.5 }, { ch: 8, step: 10, len: 2.5, skip: 2.5 }, { ch: 8, step: 12, len: 2.5 }] },
  { say: "Every wedding, inquiry to album. Already prepared.", card: { eyebrow: "StudioCue", title: "Every wedding, inquiry to album.", subtitle: "Start your free trial at studio-cue.com" }, shots: [] },
];

async function makeTeaser() {
  const id = "mk-teaser";
  // The current journey takes have every page load cut out, so the teaser's
  // longer, voice-paced shots never run into an "Opening your…" screen.
  TAKES = OUT;
  // Matilda, paced, over the lively bed that lifts into the end card (Conor, 2026-10-06).
  const { dir, voiceTrack, length, liftAt } = await voiced(id, TEASER, (shot, file, len) => {
    const { start, end } = window({ ...shot, len });
    const hold = Math.max(0, len - (end - start));
    landscapeShot({ ...shot, len }, file, hold);
  }, { w: 1920, h: 1080 }, TEASER_VOICE);
  const out = await withBed(dir, id, voiceTrack, length, 11, "lively", liftAt);
  poster(out, 6, path.join(dir, `${id}.jpg`));
  writeFileSync(path.join(dir, "meta.json"), JSON.stringify({ durationSec: Math.round(length * 10) / 10, orientation: "landscape", chapters: [], transcript: TEASER.map((b) => b.say).filter(Boolean).join(" ") }, null, 2));
  rmSync(path.join(dir, "work"), { recursive: true, force: true });
  console.log(`✓ ${id}: ${length.toFixed(1)}s`);
}

// ── Vertical social cuts (9:16) ────────────────────────────────────────────

const V = { w: 1080, h: 1920 };
const PHONE = { w: 760, h: 1645 }; // the phone screen, inset in the frame

/** The frame around the phone: brand paper, a heading, the phone bezel. */
async function verticalChrome(title: string, eyebrow: string, file: string) {
  const browser = await chromium.launch({ channel: "chrome" });
  const page = await browser.newPage({ viewport: { width: V.w, height: V.h } });
  const x = (V.w - PHONE.w) / 2, y = 235;
  await page.setContent(`<!doctype html><html><body style="margin:0;width:${V.w}px;height:${V.h}px;background:#F4F1EA;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;overflow:hidden">
    <div style="position:absolute;left:0;right:0;top:62px;text-align:center">
      <div style="font-size:26px;letter-spacing:.16em;text-transform:uppercase;color:#2E6B4B;font-weight:600">${eyebrow}</div>
      <div style="margin-top:10px;font-family:Georgia,'Times New Roman',serif;font-size:58px;color:#1E2521;letter-spacing:-.01em">${title}</div>
    </div>
    <div style="position:absolute;left:${x - 14}px;top:${y - 14}px;width:${PHONE.w + 28}px;height:${PHONE.h + 28}px;border-radius:${Math.round(PHONE.w * 0.125) + 14}px;background:#15191a;box-shadow:0 26px 70px rgba(30,37,33,.28)"></div>
  </body></html>`);
  await page.screenshot({ path: file });
  const mask = file.replace(/\.png$/, "-mask.png");
  await page.setViewportSize({ width: PHONE.w, height: PHONE.h });
  await page.setContent(`<body style="margin:0;background:#000"><div style="width:${PHONE.w}px;height:${PHONE.h}px;border-radius:${Math.round(PHONE.w * 0.125)}px;background:#fff"></div></body>`);
  await page.screenshot({ path: mask });
  await browser.close();
  return { mask, x, y };
}

function assSubtitles(placed: Array<{ line: Line; at: number }>, file: string) {
  const vtt = captions(placed.map((p, i) => ({ step: i, ...p })));
  const toAss = (t: string) => {
    const [h, m, s] = t.split(":");
    return `${Number(h)}:${m}:${Number(s).toFixed(2).padStart(5, "0")}`;
  };
  const events = vtt
    .split(/\n\n+/)
    .filter((b) => b.includes("-->"))
    .map((b) => {
      const [time, ...text] = b.split("\n");
      const [a, z] = time!.split(" --> ");
      return `Dialogue: 0,${toAss(a!)},${toAss(z!)},Cap,,0,0,0,,${text.join("\\N")}`;
    });
  writeFileSync(
    file,
    `[Script Info]\nScriptType: v4.00+\nPlayResX: ${V.w}\nPlayResY: ${V.h}\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Cap,Helvetica Neue,46,&H00FFFFFF,&H00FFFFFF,&H00211E1E,&HC0211E1E,1,0,0,0,100,100,0,0,3,14,0,2,80,80,70,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n${events.join("\n")}\n`,
  );
}

const SOCIAL: Record<string, { eyebrow: string; title: string; persona: "couple" | "crew"; beats: Beat[] }> = {
  "social-couple": {
    eyebrow: "StudioCue",
    title: "What your couple sees",
    persona: "couple",
    beats: [
      { say: "This is what your couple sees, from the first hello to the photos.", shots: [{ ch: 1, step: 1, len: 3 }] },
      { say: "They tell you about their day, and pick a time to talk.", shots: [{ ch: 2, step: 1, len: 3 }] },
      { say: "They choose their package, and sign the agreement on their phone.", shots: [{ ch: 3, step: 5, len: 2.5, skip: 2.5 }, { ch: 3, step: 8, len: 3 }] },
      { say: "Their form arrives half filled in.", shots: [{ ch: 6, step: 3, len: 2.5 }] },
      { say: "They approve the timeline,", shots: [{ ch: 6, step: 8, len: 3 }] },
      { say: "and their photos land in the same place.", shots: [{ ch: 8, step: 8, len: 3, skip: 2.5 }] },
      { say: "One link, all year. StudioCue.", shots: [{ ch: 8, step: 10, len: 2.5, skip: 2.5 }] },
    ],
  },
  "social-crew": {
    eyebrow: "StudioCue",
    title: "What your crew sees",
    persona: "crew",
    beats: [
      { say: "This is what your second shooter sees.", shots: [{ ch: 4, step: 3, len: 3 }] },
      { say: "The offer: date, times, place and fee. One tap to say yes.", shots: [{ ch: 4, step: 3, len: 2.5, skip: 1.5 }, { ch: 4, step: 4, len: 2.5 }] },
      { say: "Months later, the day sheet arrives, with everything to handle carefully.", shots: [{ ch: 6, step: 10, len: 3.5, skip: 5 }] },
      { say: "Two days out, a reminder with their call time.", shots: [{ ch: 7, step: 3, len: 3 }] },
      { say: "They read it, and confirm.", shots: [{ ch: 7, step: 4, len: 3, skip: 3 }] },
      { say: "After the day, hours and expenses, straight from their phone. StudioCue.", shots: [{ ch: 8, step: 2, len: 4 }] },
    ],
  },
};

async function makeSocial(id: string) {
  const spec = SOCIAL[id]!;
  // Apart from <id>/, which voiced() clears before it starts.
  const dir0 = path.join(OUT, `${id}.chrome`);
  mkdirSync(dir0, { recursive: true });
  const chrome = path.join(dir0, "chrome.png");
  const { mask, x, y } = await verticalChrome(spec.title, spec.eyebrow, chrome);
  const { dir, voiceTrack, length, placed } = await voiced(
    id,
    spec.beats,
    (shot, file, len) => {
      const { c, start, end } = window({ ...shot, len });
      const stream = path.join(c.dir, "streams", `${spec.persona}.mp4`);
      if (!existsSync(stream)) throw new Error(`${stream} is missing: make journey-${shot.ch} with HOW_TO_KEEP_STREAMS=1.`);
      const hold = Math.max(0, len - (end - start));
      ffmpeg([
        "-loop", "1", "-t", len.toFixed(3), "-i", chrome,
        "-ss", start.toFixed(3), "-t", (end - start).toFixed(3), "-i", stream,
        "-loop", "1", "-t", len.toFixed(3), "-i", mask,
        "-filter_complex",
        `[1:v]scale=${PHONE.w}:${PHONE.h}:flags=lanczos,tpad=stop_mode=clone:stop_duration=${hold.toFixed(3)},format=rgba[p];[2:v]format=gray,scale=${PHONE.w}:${PHONE.h}[m];[p][m]alphamerge[pm];[0:v][pm]overlay=${x}:${y}:shortest=1,fps=30,format=yuv420p[out]`,
        "-map", "[out]", "-t", len.toFixed(3), "-c:v", "libx264", "-preset", "medium", "-crf", "17", file,
      ]);
    },
    V,
  );
  const ass = path.join(dir, "work", "captions.ass");
  assSubtitles(placed, ass);
  const burned = path.join(dir, "work", "burned.mp4");
  ffmpeg(["-i", voiceTrack, "-vf", `subtitles=${ass}`, "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "copy", burned]);
  const out = await withBed(dir, id, burned, length, 23);
  poster(out, 1.5, path.join(dir, `${id}.jpg`));
  rmSync(path.join(dir, "work"), { recursive: true, force: true });
  rmSync(dir0, { recursive: true, force: true });
  console.log(`✓ ${id}: ${length.toFixed(1)}s`);
}

// ───────────────────────────────────────────────────────────────────────────

const wanted = process.argv.slice(2);
const all = [...Object.keys(LOOPS), "mk-teaser", ...Object.keys(SOCIAL)];
for (const id of wanted.length ? wanted : all) {
  if (id in LOOPS) makeLoop(id);
  else if (id === "mk-teaser") await makeTeaser();
  else if (id in SOCIAL) await makeSocial(id);
  else throw new Error(`Unknown cut "${id}". Known: ${all.join(", ")}`);
}
