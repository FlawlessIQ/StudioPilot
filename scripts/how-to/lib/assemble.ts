/**
 * Turns a recording and its narration into the published files:
 *   <id>.mp4      1080p H.264, voice at -16 LUFS, +faststart so it plays at once
 *   <id>.jpg      the poster
 *   <id>.vtt      captions, timed from ElevenLabs' character timings
 *   meta.json     duration, chapters and transcript for features/help/video-manifest.json
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import type { HowToScript } from "./define";
import type { Recording } from "./recorder";
import type { Line } from "./voice";

type Placed = { step: number; line: Line; at: number };

const ffmpeg = (args: string[]) => execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...args], { stdio: "inherit" });

/** Undo the pronunciation respellings, so captions read as the product spells things. */
function written(text: string): string {
  const back: Array<[string, string]> = [
    ["Studio Cue", "StudioCue"],
    ["C-O-I", "COI"],
    ["W 9", "W-9"],
  ];
  return back.reduce((out, [say, write]) => out.split(say).join(write), text);
}

const stamp = (s: number) => {
  const ms = Math.max(0, Math.round(s * 1000));
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), sec = Math.floor((ms % 60000) / 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`;
};

/** Two lines of at most 42 characters, broken at a space. */
function wrap(text: string): string {
  if (text.length <= 42) return text;
  const mid = text.length / 2;
  let best = -1;
  for (let i = 0; i < text.length; i++) if (text[i] === " " && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i;
  return best < 0 ? text : `${text.slice(0, best)}\n${text.slice(best + 1)}`;
}

export function captions(placed: Placed[]): string {
  const cues: string[] = [];
  for (const { line, at } of placed) {
    const { characters: chars, character_start_times_seconds: starts, character_end_times_seconds: ends } = line.alignment;
    let from = 0;
    for (let i = 0; i < chars.length; i++) {
      const text = chars.slice(from, i + 1).join("");
      const sentenceEnd = /[.!?]/.test(chars[i]!) && (chars[i + 1] === " " || i === chars.length - 1);
      const tooLong = text.length >= 70 && chars[i] === " ";
      const clauseBreak = text.length >= 40 && /[,;:—]/.test(chars[i]!) && chars[i + 1] === " ";
      if (sentenceEnd || tooLong || clauseBreak || i === chars.length - 1) {
        const cue = written(text.trim());
        if (cue) cues.push(`${stamp(at + starts[from]!)} --> ${stamp(at + ends[i]!)}\n${wrap(cue)}`);
        from = i + 1;
      }
    }
  }
  return `WEBVTT\n\n${cues.join("\n\n")}\n`;
}

export function assemble(
  script: HowToScript,
  recording: Recording,
  lines: Map<number, Line>,
  outDir: string,
): { file: string; poster: string; captions: string; meta: string; durationSec: number } {
  const { frames, marks } = recording;
  if (!frames.length) throw new Error("No frames were captured.");
  const t0 = frames[0]!.t;
  const placed: Placed[] = [...lines.entries()].map(([step, line]) => ({
    step,
    line,
    at: marks.find((mark) => mark.step === step)!.t - t0,
  }));
  const audioEnd = Math.max(0, ...placed.map((p) => p.at + p.line.durationSec));
  const duration = Math.max(recording.endT - t0, audioEnd + 0.6);

  // Frames → a constant 30 fps video, each frame held until the next arrived.
  const list = frames
    .map((frame, i) => {
      const next = i + 1 < frames.length ? frames[i + 1]!.t : t0 + duration;
      return `file '${frame.file}'\nduration ${Math.max(0.001, next - frame.t).toFixed(4)}`;
    })
    .join("\n");
  writeFileSync(path.join(outDir, "frames.txt"), `${list}\nfile '${frames.at(-1)!.file}'\n`);

  const phone = script.start.viewport === "phone";
  const scale = phone
    ? "scale=-2:1920:flags=lanczos,pad=1080:1920:(ow-iw)/2:0:color=0xF4F1EA"
    : "scale=1920:1080:flags=lanczos";
  const video = path.join(outDir, `${script.id}.mp4`);
  const inputs = placed.flatMap((p) => ["-i", p.line.audioPath]);
  const delays = placed.map((p, i) => `[${i + 1}:a]adelay=${Math.round(p.at * 1000)}:all=1[a${i}]`).join(";");
  const mix = placed.length
    ? `${delays};${placed.map((_, i) => `[a${i}]`).join("")}amix=inputs=${placed.length}:normalize=0:dropout_transition=0,apad,atrim=0:${duration.toFixed(3)},loudnorm=I=-16:TP=-1.5:LRA=11[aout]`
    : `anullsrc=r=44100:cl=stereo,atrim=0:${duration.toFixed(3)}[aout]`;
  ffmpeg([
    "-f", "concat", "-safe", "0", "-i", path.join(outDir, "frames.txt"),
    ...inputs,
    "-filter_complex", `[0:v]fps=30,${scale},format=yuv420p[vout];${mix}`,
    "-map", "[vout]", "-map", "[aout]",
    "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-profile:v", "high",
    "-c:a", "aac", "-b:a", "160k", "-ar", "44100",
    "-t", duration.toFixed(3), "-movflags", "+faststart",
    video,
  ]);

  const posterStep = script.steps.findIndex((step) => step.poster);
  const posterAt = posterStep >= 0 ? marks[posterStep]!.t - t0 + 1.4 : Math.min(3, duration / 2);
  const poster = path.join(outDir, `${script.id}.jpg`);
  ffmpeg(["-ss", posterAt.toFixed(2), "-i", video, "-frames:v", "1", "-q:v", "3", poster]);

  const vtt = path.join(outDir, `${script.id}.vtt`);
  writeFileSync(vtt, captions(placed));

  const chapters = script.steps
    .map((step, i) => (step.chapter ? { at: Math.max(0, Math.round((marks[i]!.t - t0) * 10) / 10), title: step.chapter } : null))
    .filter((c): c is { at: number; title: string } => c !== null);
  const meta = path.join(outDir, "meta.json");
  writeFileSync(
    meta,
    JSON.stringify(
      {
        durationSec: Math.round(duration * 10) / 10,
        orientation: phone ? "portrait" : "landscape",
        chapters,
        transcript: script.steps.map((s) => s.say).filter(Boolean).join(" "),
      },
      null,
      2,
    ),
  );
  return { file: video, poster, captions: vtt, meta, durationSec: duration };
}
