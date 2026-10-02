/**
 * Turns a journey recording into the published files, like assemble.ts does
 * for a single-screen how-to — but framing each step by its layout:
 *
 *   studio  the studio's desktop in a rounded window
 *   phone   one phone, with its caption beside it ("What Ella sees")
 *   split   the studio on the left, the phone on the right, both live
 *   card    a title card, full frame
 *
 * Under every framed step runs the timeline bar: six stages from inquiry to
 * closed, and a marker that says how far from the wedding this moment is.
 * That bar is what lets fourteen months read in four minutes.
 *
 * Each screen's frames become a constant-rate stream over the whole take;
 * each step is then cut from those streams, laid over its frame ("chrome",
 * drawn in HTML), and the steps are joined and the voice laid under them.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import type { HowToScript, Persona } from "./define";
import { RIBBON_STAGES } from "./define";
import { captions } from "./assemble";
import type { JourneyMark, JourneyRecording } from "./journey-recorder";
import type { Frame } from "./recorder";
import type { Line } from "./voice";

const ffmpeg = (args: string[]) => execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...args], { stdio: "inherit" });

const W = 1920, H = 1080;
type Rect = { x: number; y: number; w: number; h: number };
const STUDIO_FULL: Rect = { x: 120, y: 16, w: 1680, h: 944 }; // even sizes: yuv420p
const STUDIO_SPLIT: Rect = { x: 80, y: 196, w: 1248, h: 702 };
const PHONE_SOLO: Rect = { x: 1150, y: 27, w: 440, h: 952 };
const PHONE_SPLIT: Rect = { x: 1418, y: 112, w: 400, h: 866 };
const PAPER = "#F4F1EA", INK = "#1E2521", GREEN = "#2E6B4B";

const NAMES: Record<Persona, string> = { studio: "You", couple: "Your couple", crew: "Your crew" };

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function ribbon(when: JourneyMark["when"]): string {
  const left = 300, right = 1620, y = 1046;
  const x = (at: number) => left + (right - left) * Math.max(0, Math.min(1, at));
  const stops = RIBBON_STAGES.map((label, i) => {
    const at = i / (RIBBON_STAGES.length - 1);
    const past = when ? at <= when.at + 1e-6 : false;
    return `<div class="stop${past ? " past" : ""}" style="left:${x(at)}px"><i></i><span>${label}</span></div>`;
  }).join("");
  const marker = when
    ? `<div class="marker" style="left:${x(when.at)}px"><b>${esc(when.label)}</b></div>`
    : "";
  return `<div class="track" style="left:${left}px;width:${right - left}px;top:${y}px"><div class="done" style="width:${when ? x(when.at) - left : 0}px"></div></div>${stops}${marker}`;
}

function chromeHtml(mark: JourneyMark): string {
  const box = (r: Rect, radius: number, cls: string) =>
    `<div class="${cls}" style="left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px;border-radius:${radius}px"></div>`;
  const bezel = (r: Rect) => box({ x: r.x - 11, y: r.y - 11, w: r.w + 22, h: r.h + 22 }, Math.round(r.w * 0.125) + 11, "bezel");
  const phoneName = mark.phone ? NAMES[mark.phone] : "";
  let body = "";
  if (mark.layout === "studio") {
    body = box(STUDIO_FULL, 16, "window");
  } else if (mark.layout === "split") {
    body =
      box(STUDIO_SPLIT, 14, "window") +
      `<div class="tag" style="left:${STUDIO_SPLIT.x}px;top:${STUDIO_SPLIT.y - 52}px">${NAMES.studio}</div>` +
      bezel(PHONE_SPLIT) +
      `<div class="tag" style="left:${PHONE_SPLIT.x - 11}px;top:${PHONE_SPLIT.y - 64}px">${esc(mark.caption?.title ?? phoneName)}</div>`;
  } else if (mark.layout === "phone") {
    const title = mark.caption?.title ?? `What ${phoneName.toLowerCase()} sees`;
    body =
      bezel(PHONE_SOLO) +
      `<div class="caption"><div class="eyebrow">${esc(phoneName)}</div><h2>${esc(title)}</h2>${
        mark.caption?.detail ? `<p>${esc(mark.caption.detail)}</p>` : ""
      }</div>`;
  }
  return `<!doctype html><html><head><style>
    html,body{margin:0;width:${W}px;height:${H}px;background:${PAPER};font-family:"Helvetica Neue",Helvetica,Arial,sans-serif;color:${INK};overflow:hidden}
    .window{position:absolute;background:#fff;box-shadow:0 18px 50px rgba(30,37,33,.16),0 2px 6px rgba(30,37,33,.08)}
    .bezel{position:absolute;background:#15191a;box-shadow:0 22px 60px rgba(30,37,33,.28)}
    .tag{position:absolute;font-size:24px;font-weight:600;letter-spacing:.01em;color:${INK}}
    .caption{position:absolute;left:250px;top:0;bottom:80px;width:760px;display:flex;flex-direction:column;justify-content:center;gap:16px}
    .caption .eyebrow{font-size:20px;letter-spacing:.16em;text-transform:uppercase;color:${GREEN};font-weight:600}
    .caption h2{margin:0;font-family:Georgia,"Times New Roman",serif;font-weight:500;font-size:62px;line-height:1.06;letter-spacing:-.015em}
    .caption p{margin:0;font-size:27px;line-height:1.4;color:#4a554e;max-width:30ch}
    .track{position:absolute;height:4px;border-radius:2px;background:#D9D3C5}
    .track .done{height:100%;border-radius:2px;background:${GREEN}}
    .stop{position:absolute;top:1040px;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:7px}
    .stop i{width:16px;height:16px;border-radius:50%;background:${PAPER};border:3px solid #CFC8B8;box-sizing:border-box}
    .stop.past i{border-color:${GREEN};background:${GREEN}}
    .stop span{font-size:15px;letter-spacing:.06em;text-transform:uppercase;color:#7d857f;font-weight:600}
    .stop.past span{color:${INK}}
    .marker{position:absolute;top:1036px;transform:translate(-50%,-100%)}
    .marker b{display:block;white-space:nowrap;background:${INK};color:#F4F1EA;font-size:17px;font-weight:600;padding:5px 12px;border-radius:999px}
  </style></head><body>${body}${ribbon(mark.when)}</body></html>`;
}

function maskHtml(radius: number, w: number, h: number) {
  return `<!doctype html><html><body style="margin:0;background:#000"><div style="width:${w}px;height:${h}px;border-radius:${radius}px;background:#fff"></div></body></html>`;
}

/** Drops cut time from every stream and from the marks, as assemble.ts does for one. */
function cutOut(rec: JourneyRecording): JourneyRecording {
  const cuts = [...rec.cuts].sort((a, b) => a.from - b.from);
  if (!cuts.length) return rec;
  const shift = (t: number) => t - cuts.reduce((sum, c) => sum + (t >= c.to ? c.to - c.from : t > c.from ? t - c.from : 0), 0);
  const streams: JourneyRecording["streams"] = {};
  for (const [persona, frames] of Object.entries(rec.streams) as Array<[Persona, Frame[]]>) {
    const kept = frames.filter((frame, i, all) => {
      const inside = cuts.find((c) => frame.t >= c.from && frame.t < c.to);
      if (!inside) return true;
      const next = all[i + 1];
      return !next || next.t >= inside.to;
    });
    streams[persona] = kept.map((frame) => {
      const inside = cuts.find((c) => frame.t >= c.from && frame.t < c.to);
      return { ...frame, t: shift(inside ? inside.to : frame.t) };
    });
  }
  return { streams, marks: rec.marks.map((m) => ({ ...m, t: shift(m.t) })), cuts: [], endT: shift(rec.endT) };
}

/** One screen's frames as a constant 30 fps stream from t0 for `duration`, each frame held until the next. */
function streamVideo(frames: Frame[], t0: number, duration: number, size: { w: number; h: number }, out: string, dir: string, name: string) {
  const before = frames.filter((f) => f.t <= t0).at(-1);
  const during = frames.filter((f) => f.t > t0 && f.t < t0 + duration);
  const list = [...(before ? [{ ...before, t: t0 }] : during.length ? [{ ...during[0]!, t: t0 }] : []), ...during];
  if (!list.length) return false;
  const lines = list
    .map((frame, i) => {
      const next = i + 1 < list.length ? list[i + 1]!.t : t0 + duration;
      return `file '${frame.file}'\nduration ${Math.max(0.001, next - frame.t).toFixed(4)}`;
    })
    .join("\n");
  const txt = path.join(dir, `${name}.txt`);
  writeFileSync(txt, `${lines}\nfile '${list.at(-1)!.file}'\n`);
  ffmpeg([
    "-f", "concat", "-safe", "0", "-i", txt,
    "-vf", `fps=30,scale=${size.w}:${size.h}:flags=lanczos,format=yuv420p`,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "12", "-t", duration.toFixed(3), out,
  ]);
  return true;
}

export async function compose(
  script: HowToScript,
  recording: JourneyRecording,
  lines: Map<number, Line>,
  outDir: string,
): Promise<{ file: string; poster: string; captions: string; meta: string; durationSec: number }> {
  const rec = cutOut(recording);
  const work = path.join(outDir, "compose");
  mkdirSync(work, { recursive: true });
  const t0 = rec.marks[0]!.t;
  const audioEnd = Math.max(0, ...[...lines.entries()].map(([step, line]) => rec.marks.find((m) => m.step === step)!.t - t0 + line.durationSec));
  const duration = Math.max(rec.endT - t0, audioEnd + 0.6);

  // Each screen, once, at the largest size it is ever shown.
  const streamFile: Partial<Record<Persona, string>> = {};
  for (const [persona, frames] of Object.entries(rec.streams) as Array<[Persona, Frame[]]>) {
    const size = persona === "studio" ? STUDIO_FULL : PHONE_SOLO;
    const file = path.join(work, `${persona}.mp4`);
    if (streamVideo(frames, t0, duration, size, file, work, persona)) streamFile[persona] = file;
  }

  // The frames and masks, drawn once each.
  const browser = await chromium.launch({ channel: "chrome" });
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  const shot = async (html: string, file: string, clip?: { w: number; h: number }) => {
    await page.setViewportSize(clip ? { width: clip.w, height: clip.h } : { width: W, height: H });
    await page.setContent(html);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: file });
  };
  const studioMask = path.join(work, "mask-studio.png");
  const phoneMask = path.join(work, "mask-phone.png");
  await shot(maskHtml(16, STUDIO_FULL.w, STUDIO_FULL.h), studioMask, STUDIO_FULL);
  await shot(maskHtml(Math.round(PHONE_SOLO.w * 0.125), PHONE_SOLO.w, PHONE_SOLO.h), phoneMask, PHONE_SOLO);

  const segments: string[] = [];
  for (const [i, mark] of rec.marks.entries()) {
    const from = mark.t - t0;
    const to = i + 1 < rec.marks.length ? rec.marks[i + 1]!.t - t0 : duration;
    const len = to - from;
    if (len <= 0.02) continue;
    const seg = path.join(work, `seg-${String(i).padStart(3, "0")}.mp4`);
    const chrome = mark.layout === "card" ? mark.cardFile! : path.join(work, `chrome-${i}.png`);
    if (mark.layout !== "card") await shot(chromeHtml(mark), chrome);

    const inputs = ["-loop", "1", "-t", len.toFixed(3), "-i", chrome];
    const parts: string[] = [];
    let last = "[0:v]";
    const lay = (persona: Persona, rect: Rect, mask: string, name: string) => {
      const file = streamFile[persona];
      if (!file) return;
      const n = inputs.filter((x) => x === "-i").length;
      inputs.push("-ss", from.toFixed(3), "-t", len.toFixed(3), "-i", file, "-loop", "1", "-t", len.toFixed(3), "-i", mask);
      parts.push(
        `[${n}:v]scale=${rect.w}:${rect.h}:flags=lanczos,format=rgba[${name}v]`,
        `[${n + 1}:v]format=gray,scale=${rect.w}:${rect.h}[${name}m]`,
        `[${name}v][${name}m]alphamerge[${name}]`,
        `${last}[${name}]overlay=${rect.x}:${rect.y}:shortest=1[${name}o]`,
      );
      last = `[${name}o]`;
    };
    if (mark.layout === "studio") lay("studio", STUDIO_FULL, studioMask, "s");
    if (mark.layout === "split") {
      lay("studio", STUDIO_SPLIT, studioMask, "s");
      if (mark.phone) lay(mark.phone, PHONE_SPLIT, phoneMask, "p");
    }
    if (mark.layout === "phone" && mark.phone) lay(mark.phone, PHONE_SOLO, phoneMask, "p");
    const graph = parts.length ? `${parts.join(";")};${last}fps=30,format=yuv420p[out]` : `[0:v]fps=30,scale=${W}:${H},format=yuv420p[out]`;
    ffmpeg([...inputs, "-filter_complex", graph, "-map", "[out]", "-c:v", "libx264", "-preset", "medium", "-crf", "17", "-r", "30", "-t", len.toFixed(3), seg]);
    segments.push(seg);
  }
  await browser.close();

  const joined = path.join(work, "video.mp4");
  writeFileSync(path.join(work, "segments.txt"), segments.map((s) => `file '${s}'`).join("\n") + "\n");
  ffmpeg(["-f", "concat", "-safe", "0", "-i", path.join(work, "segments.txt"), "-c", "copy", joined]);

  // The voice, step by step, exactly as assemble.ts lays it.
  const placed = [...lines.entries()].map(([step, line]) => ({ step, line, at: rec.marks.find((m) => m.step === step)!.t - t0 }));
  const video = path.join(outDir, `${script.id}.mp4`);
  const inputs = placed.flatMap((p) => ["-i", p.line.audioPath]);
  const delays = placed.map((p, i) => `[${i + 1}:a]adelay=${Math.round(p.at * 1000)}:all=1[a${i}]`).join(";");
  const mix = placed.length
    ? `${delays};${placed.map((_, i) => `[a${i}]`).join("")}amix=inputs=${placed.length}:normalize=0:dropout_transition=0,apad,atrim=0:${duration.toFixed(3)},loudnorm=I=-16:TP=-1.5:LRA=11[aout]`
    : `anullsrc=r=44100:cl=stereo,atrim=0:${duration.toFixed(3)}[aout]`;
  ffmpeg([
    "-i", joined, ...inputs,
    "-filter_complex", mix,
    "-map", "0:v", "-map", "[aout]",
    "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-profile:v", "high", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "160k", "-ar", "44100",
    "-t", duration.toFixed(3), "-movflags", "+faststart", video,
  ]);

  const posterStep = script.steps.findIndex((step) => step.poster);
  const posterMark = rec.marks.find((m) => m.step === posterStep);
  const posterAt = posterMark ? posterMark.t - t0 + 1.4 : Math.min(3, duration / 2);
  const poster = path.join(outDir, `${script.id}.jpg`);
  ffmpeg(["-ss", posterAt.toFixed(2), "-i", video, "-frames:v", "1", "-q:v", "3", poster]);

  const vtt = path.join(outDir, `${script.id}.vtt`);
  writeFileSync(vtt, captions(placed));

  const chapters = script.steps
    .map((step, i) => {
      const mark = rec.marks.find((m) => m.step === i);
      return step.chapter && mark ? { at: Math.max(0, Math.round((mark.t - t0) * 10) / 10), title: step.chapter } : null;
    })
    .filter((c): c is { at: number; title: string } => c !== null);
  const meta = path.join(outDir, "meta.json");
  writeFileSync(
    meta,
    JSON.stringify(
      { durationSec: Math.round(duration * 10) / 10, orientation: "landscape", chapters, transcript: script.steps.map((s) => s.say).filter(Boolean).join(" ") },
      null,
      2,
    ),
  );
  return { file: video, poster, captions: vtt, meta, durationSec: duration };
}
