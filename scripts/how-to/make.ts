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
import { mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { HowToScript } from "./lib/define";
import { assemble } from "./lib/assemble";
import { record } from "./lib/recorder";
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
const reset = () => execFileSync(path.join(HERE, "stack.sh"), ["reset"], { stdio: "inherit" });

for (const id of ids) {
  const script = (await import(path.join(HERE, "videos", `${id}.ts`))).default as HowToScript;
  const outDir = path.join(HOW_TO_HOME, "out", id);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  if (check) {
    reset();
    await record(script, () => 0, outDir, { dryRun: true });
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

  reset();
  console.log(`Recording ${id}…`);
  const recording = await record(script, holdFor, outDir);
  const result = assemble(script, recording, lines, outDir);
  console.log(`✓ ${id}: ${result.durationSec.toFixed(1)}s → ${result.file}`);
}
