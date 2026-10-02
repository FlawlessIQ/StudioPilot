/**
 * A quiet music bed for the journey film, composed here rather than licensed.
 *
 * Conor asked (2026-10-02) for light, low background music, free. A track
 * downloaded from a "free" library brings a licence to read and keep; one
 * written by this file has none. It is deliberately simple — a warm pad, a
 * soft felt-piano arpeggio and a low root, around I–V–vi–IV in D at 70 bpm —
 * because it sits far under the narration and must never compete with it.
 * Deterministic: the same length gives the same music, so re-cuts match.
 *
 *   makeMusicBed(seconds, "bed.wav")  → 44.1 kHz stereo 16-bit WAV
 *   withMusic(voiceMp4, bedWav, from, length, outMp4)
 *     → the video with the bed laid under its voice, ducked while anyone
 *       speaks, in stereo, with the voice at its own -16 LUFS.
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const RATE = 44100;
const BPM = 70;
const BEAT = 60 / BPM;
const CHORD = 8 * BEAT; // two bars a chord

// MIDI notes. The lowest is the bass; the rest make the pad and the arpeggio.
const PROGRESSION = [
  [38, 57, 62, 66, 69], // D
  [33, 57, 61, 64, 69], // A
  [35, 54, 59, 62, 66], // Bm
  [31, 55, 59, 62, 67], // G
];

const freq = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

// One cycle of the pad's tone (five soft harmonics), read by phase: a table
// lookup a sample instead of five sines keeps a six-minute bed to seconds.
const TABLE = 4096;
const PAD_WAVE = Float32Array.from({ length: TABLE }, (_, i) => {
  let v = 0;
  for (let h = 1; h <= 5; h++) v += Math.sin((2 * Math.PI * h * i) / TABLE) / h ** 2.2;
  return v;
});

/** A small seeded random, so the arpeggio's human wobble is the same every time. */
function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** Freeverb-style room: four damped combs then two all-passes, per channel. */
function reverb(input: Float32Array, spread: number): Float32Array {
  const combs = [1557, 1617, 1491, 1422].map((d) => ({ buf: new Float32Array(d + spread), i: 0, store: 0 }));
  const alls = [556, 441].map((d) => ({ buf: new Float32Array(d + spread), i: 0 }));
  const out = new Float32Array(input.length);
  const feedback = 0.82, damp = 0.35;
  for (let n = 0; n < input.length; n++) {
    const x = input[n]! * 0.015;
    let sum = 0;
    for (const c of combs) {
      const y = c.buf[c.i]!;
      c.store = y * (1 - damp) + c.store * damp;
      c.buf[c.i] = x + c.store * feedback;
      c.i = (c.i + 1) % c.buf.length;
      sum += y;
    }
    for (const a of alls) {
      const b = a.buf[a.i]!;
      a.buf[a.i] = sum + b * 0.5;
      a.i = (a.i + 1) % a.buf.length;
      sum = b - sum;
    }
    out[n] = sum;
  }
  return out;
}

export function makeMusicBed(seconds: number, outWav: string, seed = 7): void {
  const length = Math.ceil((seconds + 2) * RATE);
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  const rand = seeded(seed);
  const chords = Math.ceil(seconds / CHORD) + 1;

  for (let c = 0; c < chords; c++) {
    const notes = PROGRESSION[c % PROGRESSION.length]!;
    const start = c * CHORD;
    // Every fourth pass round the progression is pad alone: room to breathe.
    const cycle = Math.floor(c / PROGRESSION.length);
    const withArp = c >= 2 && cycle % 4 !== 3;

    // The pad: upper voices, soft harmonics, two slightly detuned copies,
    // a slow swell in and a long overlap into the next chord.
    const padFrom = Math.floor(start * RATE);
    const padLen = Math.floor((CHORD + 2.2) * RATE);
    for (const note of notes.slice(1)) {
      const f = freq(note);
      for (const detune of [-0.0025, 0.0025]) {
        const fd = f * (1 + detune);
        const pan = detune < 0 ? 0.42 : 0.58;
        for (let k = 0; k < padLen && padFrom + k < length; k++) {
          const t = k / RATE;
          const env = Math.min(1, t / 1.6) * Math.min(1, Math.max(0, (CHORD + 2.2 - t) / 2.2));
          const v = PAD_WAVE[Math.floor(((fd * t) % 1) * TABLE)]! * env * 0.022;
          left[padFrom + k]! += v * (1 - pan);
          right[padFrom + k]! += v * pan;
        }
      }
    }

    // The bass: the root, an octave of warmth, nothing more.
    const fb = freq(notes[0]!);
    for (let k = 0; k < padLen && padFrom + k < length; k++) {
      const t = k / RATE;
      const env = Math.min(1, t / 0.8) * Math.min(1, Math.max(0, (CHORD + 2.2 - t) / 2.2));
      const v = (Math.sin(2 * Math.PI * fb * t) + 0.25 * Math.sin(4 * Math.PI * fb * t)) * env * 0.05;
      left[padFrom + k]! += v;
      right[padFrom + k]! += v;
    }

    // The arpeggio: felt-piano eighths over the chord, an octave up, with a
    // few left out and a little give in the timing and touch.
    if (withArp) {
      const tones = notes.slice(2).map((n) => n + 12);
      const pattern = [0, 1, 2, 1, 0, 2, 1, 2, 0, 1, 2, 1, 2, 1, 0, 1];
      for (let step = 0; step < 16; step++) {
        if (rand() < 0.22) continue;
        const note = tones[pattern[step]! % tones.length]!;
        const f = freq(note);
        const at = start + step * (BEAT / 2) + (rand() - 0.5) * 0.02;
        const velocity = 0.75 + rand() * 0.35;
        const pan = 0.35 + rand() * 0.3;
        const from = Math.floor(at * RATE);
        const len = Math.floor(2.4 * RATE);
        for (let k = 0; k < len && from + k < length; k++) {
          const t = k / RATE;
          const env = Math.min(1, t / 0.006) * Math.exp(-t / 0.7);
          const v =
            (Math.sin(2 * Math.PI * f * t) + 0.28 * Math.sin(4 * Math.PI * f * t) * Math.exp(-t / 0.3) + 0.08 * Math.sin(6 * Math.PI * f * t) * Math.exp(-t / 0.15)) *
            env * 0.03 * velocity;
          left[from + k]! += v * (1 - pan);
          right[from + k]! += v * pan;
        }
      }
    }
  }

  // A soft one-pole low-pass, the room, and gentle fades at either end.
  const smooth = (x: Float32Array) => {
    let y = 0;
    const a = 0.32;
    for (let n = 0; n < x.length; n++) x[n] = y = y + a * (x[n]! - y);
  };
  smooth(left);
  smooth(right);
  const wetL = reverb(left, 0);
  const wetR = reverb(right, 23);
  const total = Math.floor(seconds * RATE);
  let peak = 0;
  for (let n = 0; n < total; n++) {
    const t = n / RATE;
    const fade = Math.min(1, t / 3) * Math.min(1, Math.max(0, (seconds - t) / 4));
    left[n] = (left[n]! * 0.8 + wetL[n]! * 0.35) * fade;
    right[n] = (right[n]! * 0.8 + wetR[n]! * 0.35) * fade;
    peak = Math.max(peak, Math.abs(left[n]!), Math.abs(right[n]!));
  }

  // 16-bit stereo WAV, peaks at about -6 dBFS.
  const gain = peak > 0 ? 0.5 / peak : 1;
  const data = Buffer.alloc(total * 4);
  for (let n = 0; n < total; n++) {
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, left[n]! * gain)) * 32767), n * 4);
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, right[n]! * gain)) * 32767), n * 4 + 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(2, 22);
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 4, 28);
  header.writeUInt16LE(4, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  writeFileSync(outWav, Buffer.concat([header, data]));
}

/**
 * Lays `length` seconds of the bed, from `from`, under a video's voice: the
 * bed sits low (about 15 dB under the voice alone, about 22 dB under it while
 * anyone speaks; nothing below 120 Hz to muddy it) and ducks further while anyone
 * speaks; the voice keeps its own -16 LUFS, in stereo. The picture is
 * copied untouched.
 */
export function withMusic(voiceMp4: string, bedWav: string, from: number, length: number, outMp4: string): void {
  const fadeOut = Math.max(0, length - 1.5);
  execFileSync(
    "ffmpeg",
    [
      "-y", "-loglevel", "error",
      "-i", voiceMp4,
      "-ss", from.toFixed(3), "-t", length.toFixed(3), "-i", bedWav,
      "-filter_complex",
      [
        // Mono voice to both sides at full level (a plain stereo upmix drops it 3 dB).
        "[0:a]pan=stereo|c0=c0|c1=c0,aresample=44100,asplit=2[voice][key]",
        `[1:a]aformat=sample_rates=44100:channel_layouts=stereo,highpass=f=120,volume=0.26,afade=t=in:d=1.2,afade=t=out:st=${fadeOut.toFixed(3)}:d=1.5[bed]`,
        "[bed][key]sidechaincompress=threshold=0.02:ratio=6:attack=25:release=650[ducked]",
        // No loudnorm here: the voice is already at -16 LUFS (compose.ts), and a
        // one-pass loudnorm lifts the quiet stretches — it brought the bed up
        // to the voice's level under every title card. A limiter catches peaks.
        "[voice][ducked]amix=inputs=2:normalize=0:duration=first,alimiter=limit=0.89:level=false,aformat=sample_rates=44100:channel_layouts=stereo[a]",
      ].join(";"),
      "-map", "0:v", "-map", "[a]",
      "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ac", "2", "-ar", "44100",
      "-movflags", "+faststart", outMp4,
    ],
    { stdio: "inherit" },
  );
}
