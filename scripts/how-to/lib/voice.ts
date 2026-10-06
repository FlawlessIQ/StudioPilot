/**
 * Narration for the how-to videos, through ElevenLabs.
 *
 * Every line is generated with timings for each character
 * (`/with-timestamps`), which gives the video its step lengths and its
 * captions without anyone nudging anything by hand. Lines are cached by a
 * hash of the text and every setting, so re-recording a video after a UI
 * change costs nothing unless the words changed.
 *
 * The key comes from ELEVENLABS_API_KEY (in .env.local); it is never logged,
 * committed or sent anywhere but api.elevenlabs.io.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export type VoiceConfig = {
  voiceId: string;
  modelId: string;
  /** stability, similarity_boost, style, speed, use_speaker_boost */
  settings: Record<string, number | boolean>;
  /** Fixed so a re-take of unchanged words sounds the same. */
  seed: number;
  outputFormat: string;
  /**
   * Pauses a film sets itself rather than leaving to the model (Conor,
   * 2026-10-06: the narrator "doesn't pause when she should"): each sentence
   * is rendered on its own and joined with `sentenceGap` seconds of silence,
   * and a step holds `stepGap` seconds after its line unless it says otherwise.
   */
  pacing?: { sentenceGap: number; stepGap: number };
};

export type Alignment = {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
};

export type Line = {
  text: string;
  audioPath: string;
  durationSec: number;
  alignment: Alignment;
};

const API = "https://api.elevenlabs.io/v1";
export const HOW_TO_HOME = process.env.HOW_TO_HOME ?? path.join(homedir(), ".cache", "studiocue-how-to");
const CACHE = path.join(HOW_TO_HOME, "voice-cache");

/** Words the voice would otherwise say wrongly, and how to say them. */
export const PRONUNCIATION: Array<[RegExp, string]> = [
  [/\bStudioCue\b/g, "Studio Cue"],
  [/\bCOI\b/g, "C-O-I"],
  [/\bW-9\b/g, "W 9"],
  [/\bQuickBooks\b/g, "QuickBooks"],
];

export function spoken(text: string): string {
  return PRONUNCIATION.reduce((out, [pattern, say]) => out.replace(pattern, say), text);
}

export function apiKey(): string {
  let key = process.env.ELEVENLABS_API_KEY;
  if (!key && existsSync(".env.local")) {
    const line = readFileSync(".env.local", "utf8").split("\n").find((l) => l.startsWith("ELEVENLABS_API_KEY="));
    key = line?.slice("ELEVENLABS_API_KEY=".length).trim().replace(/^["']|["']$/g, "");
  }
  if (!key) throw new Error("ELEVENLABS_API_KEY is not set. Add it to .env.local.");
  return key;
}

export async function elevenlabs<T>(pathname: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API}${pathname}`, {
    ...init,
    headers: { "xi-api-key": apiKey(), "content-type": "application/json", ...(init.headers ?? {}) },
  });
  if (!response.ok) throw new Error(`ElevenLabs ${pathname}: ${response.status} ${await response.text()}`);
  return (await response.json()) as T;
}

/** A line that would need ElevenLabs while HOW_TO_VOICE_OFFLINE is set; `characters` is what it would cost. */
export class VoiceNotCached extends Error {
  constructor(readonly text: string) {
    super(`Not in the voice cache: "${text}"`);
  }
  get characters() {
    return this.text.length;
  }
}

/** One line of narration, from the cache when the words and settings are unchanged. */
export async function speak(
  text: string,
  voice: VoiceConfig,
  context: { previousText?: string; nextText?: string } = {},
): Promise<Line> {
  const body = {
    text: spoken(text),
    model_id: voice.modelId,
    voice_settings: voice.settings,
    seed: voice.seed,
    ...(context.previousText ? { previous_text: spoken(context.previousText) } : {}),
    ...(context.nextText ? { next_text: spoken(context.nextText) } : {}),
  };
  const hash = createHash("sha256").update(JSON.stringify({ voice: voice.voiceId, format: voice.outputFormat, body })).digest("hex").slice(0, 20);
  mkdirSync(CACHE, { recursive: true });
  const audioPath = path.join(CACHE, `${hash}.mp3`);
  const metaPath = path.join(CACHE, `${hash}.json`);
  if (!existsSync(audioPath) || !existsSync(metaPath)) {
    // HOW_TO_VOICE_OFFLINE=1: render only from the cache (no credits spent),
    // and say what is missing instead.
    if (process.env.HOW_TO_VOICE_OFFLINE) throw new VoiceNotCached(body.text);
    const result = await elevenlabs<{ audio_base64: string; alignment: Alignment }>(
      `/text-to-speech/${voice.voiceId}/with-timestamps?output_format=${voice.outputFormat}`,
      { method: "POST", body: JSON.stringify(body) },
    );
    writeFileSync(audioPath, Buffer.from(result.audio_base64, "base64"));
    writeFileSync(metaPath, JSON.stringify(result.alignment));
  }
  const alignment = JSON.parse(readFileSync(metaPath, "utf8")) as Alignment;
  const ends = alignment.character_end_times_seconds;
  return { text, audioPath, durationSec: ends.length ? ends[ends.length - 1]! : 0, alignment };
}

/**
 * A step's narration with the film's own pauses: each sentence spoken on its
 * own, trimmed to its last word, and joined with `sentenceGap` of silence.
 * The alignment is joined the same way, so captions still follow the words.
 * Without `pacing`, or for a single sentence, this is `speak`.
 */
export async function speakPaced(text: string, voice: VoiceConfig, context: { previousText?: string; nextText?: string } = {}): Promise<Line> {
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (!voice.pacing || sentences.length < 2) return speak(text, voice, context);
  // eleven_v3 doesn't take the neighbouring text.
  const stitched = voice.modelId !== "eleven_v3";
  const parts: Line[] = [];
  for (const [i, sentence] of sentences.entries()) {
    const around = stitched ? { previousText: sentences[i - 1] ?? context.previousText, nextText: sentences[i + 1] ?? context.nextText } : {};
    parts.push(await speak(sentence, voice, around));
  }
  const gap = voice.pacing.sentenceGap;
  const hash = createHash("sha256").update(JSON.stringify({ parts: parts.map((p) => p.audioPath), gap })).digest("hex").slice(0, 20);
  const audioPath = path.join(CACHE, `paced-${hash}.mp3`);
  const characters: string[] = [], starts: number[] = [], ends: number[] = [];
  let offset = 0;
  for (const [i, part] of parts.entries()) {
    if (i > 0) {
      characters.push(" ");
      starts.push(offset - gap);
      ends.push(offset);
    }
    characters.push(...part.alignment.characters);
    starts.push(...part.alignment.character_start_times_seconds.map((t) => t + offset));
    ends.push(...part.alignment.character_end_times_seconds.map((t) => t + offset));
    offset += part.durationSec + gap;
  }
  if (!existsSync(audioPath)) {
    const inputs = parts.flatMap((p) => ["-i", p.audioPath]);
    const chain = parts
      .map((p, i) => `[${i}:a]aresample=44100,aformat=channel_layouts=mono,atrim=0:${p.durationSec.toFixed(3)}${i < parts.length - 1 ? `,apad=pad_dur=${gap}` : ""}[p${i}]`)
      .join(";");
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...inputs, "-filter_complex", `${chain};${parts.map((_, i) => `[p${i}]`).join("")}concat=n=${parts.length}:v=0:a=1[a]`, "-map", "[a]", "-c:a", "libmp3lame", "-b:a", "128k", audioPath]);
  }
  return { text, audioPath, durationSec: offset - gap, alignment: { characters, character_start_times_seconds: starts, character_end_times_seconds: ends } };
}
