/**
 * Makes one how-to video, or checks that a script still runs.
 *
 *   npx tsx scripts/how-to/make.ts today           # narrate, record, assemble
 *   npx tsx scripts/how-to/make.ts today --check   # run the actions only: no voice, no recording
 *   npx tsx scripts/how-to/make.ts --check-all     # every script (the drift check, §5 of the plan)
 *
 * Needs the how-to stack (scripts/how-to/stack.sh up). Before each take the
 * emulators are restored from the snapshot, so every video starts from the
 * same demo studio. Output: $HOW_TO_HOME/out/<id>/ — nothing is published
 * from here; publish.ts does that once a video is approved.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { HowToScript } from "./lib/define";
import { assemble } from "./lib/assemble";
import { record } from "./lib/recorder";
import { compose } from "./lib/compose";
import { recordJourney } from "./lib/journey-recorder";
import { HOW_TO_HOME, speak, type Line, type VoiceConfig } from "./lib/voice";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const check = args.includes("--check") || args.includes("--check-all");
const ids = args.includes("--check-all")
  ? readdirSync(path.join(HERE, "videos")).filter((f) => f.endsWith(".ts")).map((f) => f.replace(/\.ts$/, ""))
  : args.filter((a) => !a.startsWith("--"));
if (!ids.length) throw new Error("Name a video, e.g. `make.ts today`.");

// The seed password and the ElevenLabs key live in .env.local.
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
  if (match && !process.env[match[1]!]) process.env[match[1]!] = match[2]!.replace(/^["']|["']$/g, "");
}

const voice = JSON.parse(readFileSync(path.join(HERE, "voice.config.json"), "utf8")) as VoiceConfig;
const reset = (snapshot?: string) => execFileSync(path.join(HERE, "stack.sh"), ["reset", ...(snapshot ? [snapshot] : [])], { stdio: "inherit" });

/**
 * Journey films (a `cast`) are chapters of one story: `journey-3` starts from
 * the world `journey-2` left, saved here after each take or check. The first
 * chapter starts from the demo snapshot like any how-to.
 */
const JOURNEY_SNAPSHOTS = path.join(HOW_TO_HOME, "journey-snapshots");
const chapterBefore = (id: string) => {
  const match = /^journey-(\d+)$/.exec(id);
  if (!match || Number(match[1]) <= 1) return undefined;
  const previous = path.join(JOURNEY_SNAPSHOTS, `journey-${Number(match[1]) - 1}`);
  if (!existsSync(previous)) throw new Error(`Make journey-${Number(match[1]) - 1} first: its snapshot is where this chapter starts.`);
  return previous;
};
const saveChapter = (id: string) =>
  execFileSync(path.join(HERE, "stack.sh"), ["export", path.join(JOURNEY_SNAPSHOTS, id)], { stdio: "inherit" });

for (const id of ids) {
  const script = (await import(path.join(HERE, "videos", `${id}.ts`))).default as HowToScript;
  const outDir = path.join(HOW_TO_HOME, "out", id);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const journey = Boolean(script.cast);
  const storyModule = journey ? await import("./journey/story") : null;
  const story = storyModule ? { story: storyModule.story, resolvePath: storyModule.resolvePath, respond: storyModule.respond } : null;

  if (check) {
    reset(journey ? chapterBefore(id) : undefined);
    if (journey) {
      await recordJourney(script, () => 0, outDir, { dryRun: true, ...story! });
      saveChapter(id);
    } else await record(script, () => 0, outDir, { dryRun: true });
    console.log(`✓ ${id}: every step ran`);
    continue;
  }

  // Narration first: its lengths set how long each step is held.
  const said = script.steps.map((step, i) => ({ i, text: step.say })).filter((s): s is { i: number; text: string } => !!s.text);
  const lines = new Map<number, Line>();
  for (const [k, { i, text }] of said.entries()) {
    lines.set(i, await speak(text, voice, { previousText: said[k - 1]?.text, nextText: said[k + 1]?.text }));
  }
  const holdFor = (i: number) => {
    const line = lines.get(i);
    const pause = (script.steps[i]!.pauseAfterMs ?? 700) / 1000;
    return line ? line.durationSec + pause : 0;
  };

  reset(journey ? chapterBefore(id) : undefined);
  console.log(`Recording ${id}…`);
  let result: { durationSec: number; file: string };
  if (journey) {
    const recording = await recordJourney(script, holdFor, outDir, { ...story! });
    saveChapter(id);
    result = await compose(script, recording, lines, outDir);
    rmSync(path.join(outDir, "compose"), { recursive: true, force: true });
  } else {
    const recording = await record(script, holdFor, outDir);
    result = assemble(script, recording, lines, outDir);
  }
  // Raw frames run to hundreds of megabytes a take; the video is what's kept.
  rmSync(path.join(outDir, "frames"), { recursive: true, force: true });
  rmSync(path.join(outDir, "frames.txt"), { force: true });
  console.log(`✓ ${id}: ${result.durationSec.toFixed(1)}s → ${result.file}`);
}
