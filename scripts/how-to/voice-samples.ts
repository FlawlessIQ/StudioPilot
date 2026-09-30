/**
 * Voice audition for the how-to videos: the same paragraph read by a short
 * list of ElevenLabs voices, so the studio owner can pick the narrator by ear.
 *
 *   npx tsx scripts/how-to/voice-samples.ts             # shortlist from your voice library
 *   npx tsx scripts/how-to/voice-samples.ts <id> <id>   # specific voices
 *
 * Writes $HOW_TO_HOME/voice-samples/<name>.mp3 and prints each voice's id.
 * The chosen id goes in scripts/how-to/voice.config.json.
 */
import { copyFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { elevenlabs, HOW_TO_HOME, speak, type VoiceConfig } from "./lib/voice";

const SAMPLE =
  "Today is where you start each day. It shows everything waiting on you, most urgent first. " +
  "Work through Prepared for you: replies, reminders and bills StudioCue has already drafted. " +
  "Approve sends one as written, or Review opens it so you can make it yours.";

type Voice = { voice_id: string; name: string; category?: string; labels?: Record<string, string>; description?: string };

/**
 * Premade voices worth hearing for calm, clear product narration. Used when
 * the key can't list the voice library (a text-to-speech-only key cannot).
 */
const PREMADE: Voice[] = [
  { voice_id: "UII4xWDUviYCKDpBl5jC", name: "Scoreboard narrator" },
  { voice_id: "nPczCjzI2devNBz1zQrb", name: "Brian" },
  { voice_id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel" },
  { voice_id: "EXAVITQu4vr4xnSDxMaL", name: "Sarah" },
  { voice_id: "FGY2WhTYpPnrIDTdsKH5", name: "Laura" },
  { voice_id: "iP95p4xoKVk53GoZ742B", name: "Chris" },
  { voice_id: "cgSgspJ2msm6clMCkdW9", name: "Jessica" },
];

const wanted = process.argv.slice(2);
const voices = await elevenlabs<{ voices: Voice[] }>("/voices")
  .then((result): Voice[] => result.voices)
  .catch((): Voice[] => (wanted.length ? wanted.map((id) => ({ voice_id: id, name: id })) : PREMADE));

const byScore = (voice: Voice) => {
  const labels = Object.values(voice.labels ?? {}).join(" ").toLowerCase() + " " + (voice.description ?? "").toLowerCase();
  let score = 0;
  if (/american/.test(labels)) score += 3;
  if (/narrat|conversational|informative|educational|calm|warm|friendly/.test(labels)) score += 2;
  if (/young|middle/.test(labels)) score += 1;
  if (/old|character|anim|video games|meditation|asmr/.test(labels)) score -= 3;
  return score;
};

const chosen = wanted.length
  ? voices.filter((voice) => wanted.includes(voice.voice_id))
  : [...voices].sort((a, b) => byScore(b) - byScore(a)).slice(0, 6);

const out = path.join(HOW_TO_HOME, "voice-samples");
mkdirSync(out, { recursive: true });
for (const voice of chosen) {
  const config: VoiceConfig = {
    voiceId: voice.voice_id,
    modelId: process.env.ELEVENLABS_MODEL ?? "eleven_multilingual_v2",
    settings: { stability: 0.55, similarity_boost: 0.75, style: 0.15, use_speaker_boost: true, speed: 1.0 },
    seed: 1007,
    outputFormat: "mp3_44100_128",
  };
  const line = await speak(SAMPLE, config).catch((error: Error) => {
    console.log(`${voice.name}: ${error.message.slice(0, 120)}`);
    return null;
  });
  if (!line) continue;
  const file = path.join(out, `${voice.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.mp3`);
  copyFileSync(line.audioPath, file);
  const labels = Object.values(voice.labels ?? {}).join(", ");
  console.log(`${voice.name.padEnd(18)} ${voice.voice_id}  ${line.durationSec.toFixed(1)}s  ${labels}\n  ${file}`);
}
