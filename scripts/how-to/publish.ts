/**
 * Publishes approved how-to videos: uploads each video's MP4, poster and
 * captions to the public Storage folder (gs://…/public/how-to/, readable by
 * anyone under storage.rules, written only from here), then records them in
 * features/help/video-manifest.json, which is what switches a video on in the
 * app. Commit the manifest, then roll out.
 *
 *   npx tsx scripts/how-to/publish.ts today proposal …   # named videos
 *   npx tsx scripts/how-to/publish.ts --all              # everything made
 *
 * Files are versioned (<id>.v<n>.mp4) and cached forever, so a re-cut never
 * serves stale video: publishing a video again bumps its version.
 * Needs a gcloud login with write access to the production bucket.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HOW_TO_HOME } from "./lib/voice";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST = path.join(HERE, "..", "..", "features", "help", "video-manifest.json");
const BUCKET = process.env.HOW_TO_BUCKET ?? "gs://studiohub-prod.firebasestorage.app/public/how-to";
const OUT = path.join(HOW_TO_HOME, "out");

const args = process.argv.slice(2);
const ids = args.includes("--all")
  ? readdirSync(OUT).filter((id) => existsSync(path.join(OUT, id, `${id}.mp4`)))
  : args.filter((a) => !a.startsWith("--"));
if (!ids.length) throw new Error("Name the videos to publish, or pass --all.");

type Entry = Record<string, unknown> & { version: number };
const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as Record<string, Entry>;

for (const id of ids) {
  const dir = path.join(OUT, id);
  const meta = JSON.parse(readFileSync(path.join(dir, "meta.json"), "utf8")) as Record<string, unknown>;
  const version = (manifest[id]?.version ?? 0) + 1;
  const files = {
    file: { local: `${id}.mp4`, remote: `${id}.v${version}.mp4`, type: "video/mp4" },
    poster: { local: `${id}.jpg`, remote: `${id}.v${version}.jpg`, type: "image/jpeg" },
    captions: { local: `${id}.vtt`, remote: `${id}.v${version}.vtt`, type: "text/vtt" },
  };
  for (const f of Object.values(files)) {
    execFileSync(
      "gcloud",
      [
        "storage", "cp", path.join(dir, f.local), `${BUCKET}/${f.remote}`,
        `--content-type=${f.type}`,
        "--cache-control=public, max-age=31536000, immutable",
      ],
      { stdio: ["ignore", "ignore", "inherit"] },
    );
  }
  manifest[id] = {
    version,
    durationSec: meta.durationSec,
    orientation: meta.orientation,
    file: files.file.remote,
    poster: files.poster.remote,
    captions: files.captions.remote,
    chapters: meta.chapters,
    transcript: meta.transcript,
    recordedAt: new Date().toISOString().slice(0, 10),
    recordedCommit: execFileSync("git", ["rev-parse", "--short", "HEAD"]).toString().trim(),
  };
  console.log(`✓ ${id} v${version}`);
}

const sorted = Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(MANIFEST, `${JSON.stringify(sorted, null, 2)}\n`);
console.log(`Manifest: ${Object.keys(sorted).length} videos. Commit features/help/video-manifest.json, then roll out.`);
