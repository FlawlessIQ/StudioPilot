/**
 * Music beds from ElevenLabs Music, for films the synthesized beds
 * (lib/music.ts) can't carry: real guitars and drums (Conor, 2026-10-19:
 * the synthesized "rock" was "electro pop rock"). Each take is saved with
 * the plan that made it, to be mixed by social-ad.ts --music-file.
 *
 *   npx tsx scripts/how-to/music-takes.ts rock          # 3 takes
 *   npx tsx scripts/how-to/music-takes.ts rock 2        # just take 2
 *
 * Spends ElevenLabs credits (about 30 s of music per take). The plan's
 * sections are pinned (music_v1 respects their durations), so the lift lands
 * where the end card does: LIFT_MS into the track.
 * Output: $HOW_TO_HOME/music/<style>-take-<n>.{mp3,json}.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { apiKey, HOW_TO_HOME } from "./lib/voice";

const LIFT_MS = 25_900;
const LENGTH_MS = 31_500;

const GLOBAL = {
  positive: ["hard rock", "alternative rock", "distorted electric guitars", "live drum kit", "electric bass", "140 bpm", "energetic", "driving", "instrumental"],
  negative: ["vocals", "singing", "choir", "synthesizer", "electronic", "EDM", "pop", "slow intro", "fade in", "ambient"],
};

/** Three takes: two pinned plans with different energy in the middle, and one free prompt. */
const TAKES: Array<{ name: string; body: Record<string, unknown> }> = [
  {
    name: "plan-riff",
    body: {
      model_id: "music_v1",
      seed: 1907,
      composition_plan: {
        positive_global_styles: GLOBAL.positive,
        negative_global_styles: GLOBAL.negative,
        sections: [
          { section_name: "Riff", positive_local_styles: ["full band from the first beat", "punchy guitar riff", "crash on the downbeat"], negative_local_styles: ["quiet intro", "solo instrument"], duration_ms: 3_400, lines: [] },
          { section_name: "Drive", positive_local_styles: ["palm-muted guitar chugs", "steady driving drums", "bass locked to the kick", "room for a voiceover", "consistent energy"], negative_local_styles: ["guitar solo", "breakdown", "drop out"], duration_ms: LIFT_MS - 3_400, lines: [] },
          { section_name: "Chorus", positive_local_styles: ["big open power chords", "crash cymbals", "full energy", "ends on a final hit"], negative_local_styles: ["fade out", "slow down"], duration_ms: LENGTH_MS - LIFT_MS, lines: [] },
        ],
      },
    },
  },
  {
    name: "plan-anthem",
    body: {
      model_id: "music_v1",
      seed: 2604,
      composition_plan: {
        positive_global_styles: [...GLOBAL.positive, "stadium rock", "anthemic"],
        negative_global_styles: GLOBAL.negative,
        sections: [
          { section_name: "Intro hit", positive_local_styles: ["drum fill into the band", "big guitar chord stabs"], negative_local_styles: ["quiet intro"], duration_ms: 3_400, lines: [] },
          { section_name: "Verse", positive_local_styles: ["tight eighth-note rhythm guitar", "four-on-the-floor rock beat", "bass groove", "room for a voiceover"], negative_local_styles: ["guitar solo", "breakdown"], duration_ms: LIFT_MS - 3_400, lines: [] },
          { section_name: "Final chorus", positive_local_styles: ["anthemic chorus", "open ringing guitars", "crash cymbals", "ends on a big final chord"], negative_local_styles: ["fade out"], duration_ms: LENGTH_MS - LIFT_MS, lines: [] },
        ],
      },
    },
  },
  {
    name: "prompt",
    body: {
      model_id: "music_v1",
      force_instrumental: true,
      music_length_ms: LENGTH_MS,
      prompt:
        "High-energy instrumental hard rock bed for a 30-second ad, 140 bpm. Full band from the very first beat: distorted electric guitars, live drums, electric bass. Steady driving verse that leaves room for a voiceover, then a big chorus lift with crash cymbals at 26 seconds, ending on a final hit. No vocals, no synths.",
    },
  },
];

const style = process.argv[2] ?? "rock";
if (style !== "rock") throw new Error(`Only "rock" takes are defined.`);
const only = process.argv.slice(3).map(Number).filter(Boolean);
const dir = path.join(HOW_TO_HOME, "music");
mkdirSync(dir, { recursive: true });

for (const [i, take] of TAKES.entries()) {
  if (only.length && !only.includes(i + 1)) continue;
  const response = await fetch("https://api.elevenlabs.io/v1/music?output_format=mp3_44100_192", {
    method: "POST",
    headers: { "xi-api-key": apiKey(), "content-type": "application/json" },
    body: JSON.stringify(take.body),
  });
  if (!response.ok) throw new Error(`Take ${i + 1} (${take.name}): ${response.status} ${await response.text()}`);
  const file = path.join(dir, `${style}-take-${i + 1}.mp3`);
  writeFileSync(file, Buffer.from(await response.arrayBuffer()));
  writeFileSync(file.replace(/\.mp3$/, ".json"), JSON.stringify({ ...take, songId: response.headers.get("song-id"), liftMs: LIFT_MS }, null, 2));
  console.log(`✓ take ${i + 1} (${take.name}) → ${file}`);
}
