/**
 * Joins the journey film's chapters into one film.
 *
 *   npx tsx scripts/how-to/join.ts            # journey-1 … journey-N → journey (upbeat bed)
 *   npx tsx scripts/how-to/join.ts calm       # …over the original calm bed
 *
 * Each chapter is made on its own (make.ts journey-<n>), so one can be
 * re-cut without re-recording the rest. This stitches their videos end to
 * end, shifts each chapter's captions and chapter marks by where it starts,
 * and writes the joined film as `journey` beside them, with a meta.json the
 * publisher reads like any how-to's. The picture is never re-encoded: every
 * chapter comes out of compose.ts with the same codec settings.
 *
 * Music (lib/music.ts) goes under the joined film as one continuous piece,
 * and under each chapter clip as that chapter's stretch of the same piece, so
 * a chapter on the journey page sounds like the film it came from. The
 * voice-only takes (<id>.voice.mp4) are what's joined; <id>.mp4 is the mix.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { makeMusicBed, withMusic, type BedStyle } from "./lib/music";
import { HOW_TO_HOME } from "./lib/voice";

const OUT = path.join(HOW_TO_HOME, "out");
const ffmpeg = (args: string[]) => execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...args], { stdio: "inherit" });

const chapters: string[] = [];
for (let n = 1; existsSync(path.join(OUT, `journey-${n}`, `journey-${n}.mp4`)); n++) chapters.push(`journey-${n}`);
// Takes made before compose.ts kept a voice-only copy are voice-only already.
const voiceOf = (id: string) => path.join(OUT, id, `${id}.voice.mp4`);
for (const id of chapters) if (!existsSync(voiceOf(id))) renameSync(path.join(OUT, id, `${id}.mp4`), voiceOf(id));
if (!chapters.length) throw new Error("No journey chapters made yet (make.ts journey-1 …).");

type Meta = { durationSec: number; chapters: Array<{ at: number; title: string }>; transcript: string };
const metas = chapters.map((id) => JSON.parse(readFileSync(path.join(OUT, id, "meta.json"), "utf8")) as Meta);
// Where each chapter starts in the film: the true length of the chapter files, not the rounded meta.
const lengths = chapters.map((id) =>
  Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", voiceOf(id)]).toString().trim()),
);
const starts = lengths.map((_, i) => lengths.slice(0, i).reduce((a, b) => a + b, 0));

const dir = path.join(OUT, "journey");
mkdirSync(dir, { recursive: true });
writeFileSync(path.join(dir, "parts.txt"), chapters.map((id) => `file '${voiceOf(id)}'`).join("\n") + "\n");
const voiceFilm = path.join(dir, "journey.voice.mp4");
ffmpeg(["-f", "concat", "-safe", "0", "-i", path.join(dir, "parts.txt"), "-c", "copy", "-movflags", "+faststart", voiceFilm]);

const total = lengths.reduce((a, b) => a + b, 0);
const bed = path.join(dir, "music.wav");
// Upbeat since 2026-10-06 (Conor: "lively and upbeat"); `join.ts calm` brings back the original bed.
const MUSIC: BedStyle = process.argv.includes("calm") ? "calm" : "upbeat";
makeMusicBed(total + 1, bed, 7, MUSIC);
const video = path.join(dir, "journey.mp4");
withMusic(voiceFilm, bed, 0, total, video, MUSIC);
chapters.forEach((id, i) => withMusic(voiceOf(id), bed, starts[i]!, lengths[i]!, path.join(OUT, id, `${id}.mp4`), MUSIC));

const stamp = (s: number) => {
  const ms = Math.max(0, Math.round(s * 1000));
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), sec = Math.floor((ms % 60000) / 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`;
};
const seconds = (t: string) => {
  const [h, m, s] = t.split(":");
  return Number(h) * 3600 + Number(m) * 60 + Number(s);
};
const cues = chapters.flatMap((id, i) =>
  readFileSync(path.join(OUT, id, `${id}.vtt`), "utf8")
    .split(/\n\n+/)
    .filter((block) => block.includes("-->"))
    .map((block) => block.replace(/^(\S+) --> (\S+)/, (_, a: string, b: string) => `${stamp(seconds(a) + starts[i]!)} --> ${stamp(seconds(b) + starts[i]!)}`)),
);
writeFileSync(path.join(dir, "journey.vtt"), `WEBVTT\n\n${cues.join("\n\n")}\n`);

// One mark per chapter of the film (each chapter's first mark), so the player's chapter list reads as the story.
const marks = metas.map((meta, i) => ({ at: Math.round((starts[i]! + (meta.chapters[0]?.at ?? 0)) * 10) / 10, title: meta.chapters[0]?.title ?? `Part ${i + 1}` }));
marks[0] = { ...marks[0]!, at: 0 };
const durationSec = Math.round(lengths.reduce((a, b) => a + b, 0) * 10) / 10;
writeFileSync(
  path.join(dir, "meta.json"),
  JSON.stringify({ durationSec, orientation: "landscape", chapters: marks, transcript: metas.map((m) => m.transcript).join(" ") }, null, 2),
);
// The poster: the first chapter's, which shows the story starting.
ffmpeg(["-i", path.join(OUT, chapters[0]!, `${chapters[0]}.jpg`), path.join(dir, "journey.jpg")]);
console.log(`✓ journey: ${chapters.length} chapters, ${durationSec}s → ${video}`);
