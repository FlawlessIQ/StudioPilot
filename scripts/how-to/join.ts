/**
 * Joins the journey film's chapters into one film.
 *
 *   npx tsx scripts/how-to/join.ts            # journey-1 … journey-N → journey
 *
 * Each chapter is made on its own (make.ts journey-<n>), so one can be
 * re-cut without re-recording the rest. This stitches their videos end to
 * end, shifts each chapter's captions and chapter marks by where it starts,
 * and writes the joined film as `journey` beside them, with a meta.json the
 * publisher reads like any how-to's. Nothing is re-encoded: every chapter
 * comes out of compose.ts with the same codec settings.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { HOW_TO_HOME } from "./lib/voice";

const OUT = path.join(HOW_TO_HOME, "out");
const ffmpeg = (args: string[]) => execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...args], { stdio: "inherit" });

const chapters: string[] = [];
for (let n = 1; existsSync(path.join(OUT, `journey-${n}`, `journey-${n}.mp4`)); n++) chapters.push(`journey-${n}`);
if (!chapters.length) throw new Error("No journey chapters made yet (make.ts journey-1 …).");

type Meta = { durationSec: number; chapters: Array<{ at: number; title: string }>; transcript: string };
const metas = chapters.map((id) => JSON.parse(readFileSync(path.join(OUT, id, "meta.json"), "utf8")) as Meta);
// Where each chapter starts in the film: the true length of the chapter files, not the rounded meta.
const lengths = chapters.map((id) =>
  Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path.join(OUT, id, `${id}.mp4`)]).toString().trim()),
);
const starts = lengths.map((_, i) => lengths.slice(0, i).reduce((a, b) => a + b, 0));

const dir = path.join(OUT, "journey");
mkdirSync(dir, { recursive: true });
writeFileSync(path.join(dir, "parts.txt"), chapters.map((id) => `file '${path.join(OUT, id, `${id}.mp4`)}'`).join("\n") + "\n");
const video = path.join(dir, "journey.mp4");
ffmpeg(["-f", "concat", "-safe", "0", "-i", path.join(dir, "parts.txt"), "-c", "copy", "-movflags", "+faststart", video]);

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
