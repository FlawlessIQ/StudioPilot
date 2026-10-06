/**
 * A quiet music bed for the journey film, composed here rather than licensed.
 *
 * Conor asked (2026-10-02) for light, low background music, free. A track
 * downloaded from a "free" library brings a licence to read and keep; one
 * written by this file has none. It is deliberately simple — a warm pad, a
 * soft felt-piano arpeggio and a plucked bass, around I–V–vi–IV in D —
 * because it sits under the narration and must never compete with it. Made
 * brighter and a little louder at Conor's ask (2026-10-02): 96 bpm, a
 * bouncing bass and a soft off-beat shaker.
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
const BPM = 96;
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

/** "calm": the journey film's original bed. "upbeat": lively, for the sales films (below). */
export type BedStyle = "calm" | "upbeat" | "lively";

export function makeMusicBed(seconds: number, outWav: string, seed = 7, style: BedStyle = "calm", options: { liftAt?: number } = {}): void {
  if (style === "upbeat") return makeUpbeatBed(seconds, outWav, seed, options.liftAt);
  if (style === "lively") return makeUpbeatBed(seconds, outWav, seed, options.liftAt, true);
  const length = Math.ceil((seconds + 2) * RATE);
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  // The shaker is kept apart and added after the low-pass, which would
  // otherwise take away all it is.
  const hatL = new Float32Array(length);
  const hatR = new Float32Array(length);
  const rand = seeded(seed);
  const chords = Math.ceil(seconds / CHORD) + 1;

  for (let c = 0; c < chords; c++) {
    const notes = PROGRESSION[c % PROGRESSION.length]!;
    const start = c * CHORD;
    // Every fourth pass round the progression drops the shaker: room to breathe.
    const cycle = Math.floor(c / PROGRESSION.length);
    const withArp = c >= 1;

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
          const env = Math.min(1, t / 0.7) * Math.min(1, Math.max(0, (CHORD + 2.2 - t) / 2.2));
          const v = PAD_WAVE[Math.floor(((fd * t) % 1) * TABLE)]! * env * 0.022;
          left[padFrom + k]! += v * (1 - pan);
          right[padFrom + k]! += v * pan;
        }
      }
    }

    // The bass: a plucked line that bounces on the beat — root, root, fifth,
    // root, octave in each bar — an octave up from a true bass, so the 120 Hz
    // high-pass under the voice leaves it audible.
    const root = notes[0]! + 12;
    const bassLine: Array<[number, number]> = [[0, root], [1.5, root], [2, root + 7], [3, root], [3.5, root + 12]];
    for (let bar = 0; bar < 2; bar++) {
      for (const [beat, note] of bassLine) {
        const f = freq(note);
        const from = Math.floor((start + (bar * 4 + beat) * BEAT) * RATE);
        const len = Math.floor(0.9 * RATE);
        for (let k = 0; k < len && from + k < length; k++) {
          const t = k / RATE;
          const env = Math.min(1, t / 0.004) * Math.exp(-t / 0.28);
          const v = (Math.sin(2 * Math.PI * f * t) + 0.35 * Math.sin(4 * Math.PI * f * t) * Math.exp(-t / 0.12)) * env * 0.05;
          left[from + k]! += v;
          right[from + k]! += v;
        }
      }
    }

    // A soft shaker on the off-beats: filtered noise, a few milliseconds long.
    if (c >= 1 && cycle % 4 !== 3) {
      for (let beat = 0; beat < 8; beat++) {
        const from = Math.floor((start + (beat + 0.5) * BEAT + (rand() - 0.5) * 0.008) * RATE);
        const len = Math.floor(0.09 * RATE);
        const pan = 0.6 + rand() * 0.15;
        let previous = 0;
        for (let k = 0; k < len && from + k < length; k++) {
          const t = k / RATE;
          const noise = rand() * 2 - 1;
          const high = noise - previous; // a first difference: only the hiss
          previous = noise;
          const v = high * Math.exp(-t / 0.022) * 0.02;
          hatL[from + k]! += v * (1 - pan);
          hatR[from + k]! += v * pan;
        }
      }
    }

    // The arpeggio: felt-piano eighths over the chord, an octave up, with a
    // few left out and a little give in the timing and touch.
    if (withArp) {
      const tones = notes.slice(2).map((n) => n + 12);
      const pattern = [0, 1, 2, 1, 0, 2, 1, 2, 0, 1, 2, 1, 2, 1, 0, 1];
      for (let step = 0; step < 16; step++) {
        if (rand() < 0.12) continue;
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
    left[n] = (left[n]! * 0.8 + wetL[n]! * 0.35 + hatL[n]!) * fade;
    right[n] = (right[n]! * 0.8 + wetR[n]! * 0.35 + hatR[n]!) * fade;
    peak = Math.max(peak, Math.abs(left[n]!), Math.abs(right[n]!));
  }

  writeWav(left, right, total, peak, outWav);
}

/** 16-bit stereo WAV, peaks at about -6 dBFS. */
function writeWav(left: Float32Array, right: Float32Array, total: number, peak: number, outWav: string) {
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
 * bed sits low (about 11 dB under the voice alone, about 15 dB under it while
 * anyone speaks; nothing below 120 Hz to muddy it) and ducks further while anyone
 * speaks; the voice keeps its own -16 LUFS, in stereo. The picture is
 * copied untouched.
 */
export function withMusic(voiceMp4: string, bedWav: string, from: number, length: number, outMp4: string, style: BedStyle = "calm"): void {
  const fadeOut = Math.max(0, length - 1.5);
  // The upbeat bed is busier, so it sits a little lower, keeps its kick
  // (high-pass at 70 Hz, not 120) and ducks harder and faster while anyone
  // speaks: about 9 dB under a line (measured against Matilda at -16 LUFS),
  // back up within half a second of a pause.
  // The lively bed (the trial teaser) sits further forward still, and ducks
  // about 9 dB under her, measured as RMS over a spoken line (LUFS gating
  // hides the dips): the key is boosted (level_sc) so short words still bite.
  const bedChain = { upbeat: "highpass=f=70,volume=0.40", lively: "highpass=f=60,volume=0.62", calm: "highpass=f=120,volume=0.42" }[style];
  const duck = {
    upbeat: "threshold=0.05:ratio=4:attack=12:release=380:knee=4",
    lively: "threshold=0.02:ratio=12:attack=8:release=300:knee=2:level_sc=6",
    calm: "threshold=0.03:ratio=3.5:attack=25:release=500",
  }[style];
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
        `[1:a]aformat=sample_rates=44100:channel_layouts=stereo,${bedChain},afade=t=in:d=1.2,afade=t=out:st=${fadeOut.toFixed(3)}:d=1.5[bed]`,
        `[bed][key]sidechaincompress=${duck}[ducked]`,
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

/**
 * The upbeat bed (Conor, 2026-10-06: "lively and upbeat"), for the sales
 * films. Same rules as the calm one, written here, so it has no licence: 122
 * bpm in D major, one chord a bar round I–V–vi–IV; a soft four-on-the-floor
 * kick, claps on two and four, a sixteenth-note shaker; an octave-bouncing
 * bass; bright off-beat chord stabs, a bell line every other pass and a thin
 * pad. `liftAt` (seconds) builds a two-bar riser into that moment and opens
 * up after it, for the end card. Deterministic, like the calm bed.
 */
function makeUpbeatBed(seconds: number, outWav: string, seed: number, liftAt?: number, lively = false): void {
  // Lively (the trial teaser, Conor 2026-10-06: "much more upbeat"): 128 bpm
  // in E, a snare under the claps, open hats, a bright saw lead hook every
  // bar, and a four-bar build with a snare roll into the end. Its extra parts
  // draw from their own random stream, so the upbeat bed is unchanged.
  const bpm = lively ? 128 : 122;
  const shift = lively ? 2 : 0;
  const rand2 = seeded(seed + 1000);
  const beat = 60 / bpm;
  const bar = 4 * beat;
  const length = Math.ceil((seconds + 2) * RATE);
  const left = new Float32Array(length), right = new Float32Array(length);
  // Drums stay dry and skip the low-pass, like the calm bed's shaker.
  const drumL = new Float32Array(length), drumR = new Float32Array(length);
  const rand = seeded(seed);
  const add = (buf: Float32Array, from: number, len: number, voice: (t: number) => number) => {
    for (let k = 0; k < len && from + k < length; k++) buf[from + k]! += voice(k / RATE);
  };
  const stereo = (l: Float32Array, r: Float32Array, at: number, dur: number, pan: number, voice: (t: number) => number) => {
    const from = Math.floor(at * RATE), len = Math.floor(dur * RATE);
    add(l, from, len, (t) => voice(t) * (1 - pan));
    add(r, from, len, (t) => voice(t) * pan);
  };
  const lifted = (at: number) => liftAt !== undefined && at >= liftAt;
  const bars = Math.ceil(seconds / bar) + 1;

  for (let b = 0; b < bars; b++) {
    const start = b * bar;
    const notes = PROGRESSION[b % PROGRESSION.length]!.map((n) => n + shift);
    const cycle = Math.floor(b / PROGRESSION.length);
    const intro = b < 2; // two bars in before the drums: the bed arrives, then moves
    const open = lifted(start);

    // Kick: every beat, soft and short; a falling sine.
    if (!intro)
      for (let q = 0; q < 4; q++)
        stereo(drumL, drumR, start + q * beat, 0.3, 0.5, (t) => {
          const phase = 2 * Math.PI * (48 * t + (62 / 28) * (1 - Math.exp(-28 * t)));
          return Math.sin(phase) * Math.exp(-t / 0.11) * 0.36;
        });
    // Claps on two and four: three quick bursts of filtered noise and a short tail.
    if (!intro)
      for (const q of [1, 3]) {
        let previous = 0, low = 0;
        stereo(drumL, drumR, start + q * beat, 0.25, 0.46 + rand() * 0.08, (t) => {
          const noise = rand() * 2 - 1;
          const high = noise - previous;
          previous = noise;
          low += 0.35 * (high - low);
          const bursts = t < 0.024 ? Math.exp(-((t % 0.008) / 0.0025)) : Math.exp(-(t - 0.024) / 0.07);
          return low * bursts * 0.11;
        });
      }
    // Shaker: sixteenths, the off-beats leaning in.
    if (!intro)
      for (let x = 0; x < 16; x++) {
        let previous = 0;
        const accent = x % 4 === 2 ? 1 : x % 2 === 1 ? 0.55 : 0.35;
        stereo(drumL, drumR, start + x * (beat / 4) + (rand() - 0.5) * 0.004, 0.06, 0.62 + rand() * 0.12, (t) => {
          const noise = rand() * 2 - 1;
          const high = noise - previous;
          previous = noise;
          return high * Math.exp(-t / 0.016) * 0.026 * accent;
        });
      }

    // Bass: eighths bouncing root–octave, a fifth on the way back.
    const root = notes[0]! + 12;
    const line = [0, 12, 0, 12, 7, 12, 0, 12];
    for (const [e, interval] of line.entries()) {
      if (intro && e % 2) continue;
      const f = freq(root + interval);
      stereo(left, right, start + e * (beat / 2), 0.32, 0.5, (t) => {
        const env = Math.min(1, t / 0.004) * Math.exp(-t / 0.15);
        let v = 0;
        for (let h = 1; h <= 4; h++) v += Math.sin(2 * Math.PI * h * f * t) / h ** 1.6;
        return v * env * 0.05;
      });
    }

    // Stabs: the chord on every off-beat, short and bright (an octave up after the lift).
    const stab = notes.slice(1).map((n) => n + 12 + (open ? 12 : 0));
    for (let e = 1; e < 8; e += 2) {
      for (const note of stab) {
        const f = freq(note);
        stereo(left, right, start + e * (beat / 2) + (rand() - 0.5) * 0.006, 0.4, 0.35 + rand() * 0.3, (t) => {
          const env = Math.min(1, t / 0.003) * Math.exp(-t / 0.085);
          return (Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(8 * Math.PI * f * t) * Math.exp(-t / 0.03)) * env * 0.02;
        });
      }
    }

    // A bell line every other pass round the progression: the hook.
    if (!intro && (cycle % 2 === 1 || open)) {
      const tones = notes.slice(2).map((n) => n + 24);
      const pattern = [0, -1, 1, 2, -1, 1, 0, -1];
      for (const [e, which] of pattern.entries()) {
        if (which < 0) continue;
        const f = freq(tones[which % tones.length]!);
        stereo(left, right, start + e * (beat / 2), 1.2, 0.55, (t) => {
          const env = Math.min(1, t / 0.004) * Math.exp(-t / 0.35);
          return (Math.sin(2 * Math.PI * f * t) + 0.18 * Math.sin(2 * Math.PI * 2.76 * f * t) * Math.exp(-t / 0.12)) * env * 0.022;
        });
      }
    }

    // A thin pad under it all.
    for (const note of notes.slice(1)) {
      const f = freq(note);
      stereo(left, right, start, bar + 0.6, note % 2 ? 0.4 : 0.6, (t) => {
        const env = Math.min(1, t / 0.3) * Math.min(1, Math.max(0, (bar + 0.6 - t) / 0.6));
        return PAD_WAVE[Math.floor(((f * t) % 1) * TABLE)]! * env * 0.011;
      });
    }

    if (lively && !intro) {
      // A snare body under the claps.
      for (const q of [1, 3])
        stereo(drumL, drumR, start + q * beat, 0.25, 0.5, (t) => {
          const body = Math.sin(2 * Math.PI * 185 * t) * Math.exp(-t / 0.05);
          return (body * 0.6 + (rand2() * 2 - 1) * 0.5) * Math.exp(-t / 0.09) * 0.09;
        });
      // Open hats on the off-beats.
      for (let e = 1; e < 8; e += 2) {
        let previous = 0;
        stereo(drumL, drumR, start + e * (beat / 2), 0.2, 0.35, (t) => {
          const noise = rand2() * 2 - 1;
          const high = noise - previous;
          previous = noise;
          return high * Math.exp(-t / 0.06) * 0.032;
        });
      }
      // The lead: a bright saw hook in eighths over the chord, every bar.
      const tones = notes.slice(1).map((n) => n + 24);
      const hook = [0, -1, 2, 1, -1, 2, 3, 1];
      for (const [e, which] of hook.entries()) {
        if (which < 0) continue;
        const f = freq(tones[which % tones.length]!);
        stereo(left, right, start + e * (beat / 2), 0.5, 0.45 + (e % 2) * 0.1, (t) => {
          const env = Math.min(1, t / 0.005) * Math.exp(-t / 0.16);
          let v = 0;
          for (let h = 1; h <= 6; h++) v += Math.sin(2 * Math.PI * h * f * t) / h;
          return v * env * 0.014;
        });
      }
    }
  }

  // The lively bed's bigger build: a snare roll that speeds up over the
  // last four bars, under the riser below.
  if (lively && liftAt !== undefined && liftAt < seconds) {
    const rollFrom = Math.max(0, liftAt - 4 * bar);
    for (let t0 = rollFrom; t0 < liftAt - 0.02; ) {
      const p = (t0 - rollFrom) / (liftAt - rollFrom);
      stereo(drumL, drumR, t0, 0.12, 0.5, (t) => (rand2() * 2 - 1) * Math.exp(-t / 0.035) * (0.03 + 0.07 * p));
      t0 += p < 0.5 ? beat / 2 : p < 0.8 ? beat / 4 : beat / 8;
    }
  }

  // The lift: a two-bar noise riser into liftAt, then a soft crash.
  if (liftAt !== undefined && liftAt < seconds) {
    const rise = 2 * bar;
    let previous = 0, low = 0;
    stereo(drumL, drumR, Math.max(0, liftAt - rise), rise, 0.5, (t) => {
      const p = t / rise;
      const noise = rand() * 2 - 1;
      const high = noise - previous;
      previous = noise;
      low += (0.05 + 0.6 * p) * (high - low); // opens up as it rises
      return low * p * p * 0.09;
    });
    let prev = 0;
    stereo(drumL, drumR, liftAt, 1.8, 0.5, (t) => {
      const noise = rand() * 2 - 1;
      const high = noise - prev;
      prev = noise;
      return high * Math.exp(-t / 0.5) * 0.05;
    });
  }

  const smooth = (x: Float32Array) => {
    let y = 0;
    for (let n = 0; n < x.length; n++) x[n] = y = y + 0.45 * (x[n]! - y);
  };
  smooth(left);
  smooth(right);
  const wetL = reverb(left, 0), wetR = reverb(right, 23);
  const total = Math.floor(seconds * RATE);
  let peak = 0;
  for (let n = 0; n < total; n++) {
    const t = n / RATE;
    const fade = Math.min(1, t / 1.5) * Math.min(1, Math.max(0, (seconds - t) / 3));
    left[n] = (left[n]! * 0.85 + wetL[n]! * 0.22 + drumL[n]!) * fade;
    right[n] = (right[n]! * 0.85 + wetR[n]! * 0.22 + drumR[n]!) * fade;
    peak = Math.max(peak, Math.abs(left[n]!), Math.abs(right[n]!));
  }
  writeWav(left, right, total, peak, outWav);
}
