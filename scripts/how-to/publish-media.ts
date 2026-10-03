/**
 * Publishes the website's short clips (cutdowns.ts: mk-hero-loop, mk-loop-*,
 * mk-teaser) to the same public media folder as the how-to videos, under the
 * versioned names features/marketing/media.ts reads.
 *
 *   npx tsx scripts/how-to/publish-media.ts v1 mk-hero-loop mk-teaser …
 *
 * Unlike publish.ts there is no manifest: the version is in the name the site
 * already asks for, so a re-cut is published as v2 and media.ts is bumped to
 * match in the same commit. Files are cached forever. Needs a gcloud login
 * with write access to the production bucket.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { HOW_TO_HOME } from "./lib/voice";

const BUCKET = process.env.HOW_TO_BUCKET ?? "gs://studiohub-prod.firebasestorage.app/public/how-to";
const [version, ...ids] = process.argv.slice(2);
if (!version || !/^v\d+$/.test(version) || !ids.length) throw new Error("usage: publish-media.ts v1 <id> [<id> …]");

const TYPES: Record<string, string> = { mp4: "video/mp4", jpg: "image/jpeg", vtt: "text/vtt" };
for (const id of ids) {
  for (const [ext, type] of Object.entries(TYPES)) {
    const local = path.join(HOW_TO_HOME, "out", id, `${id}.${ext}`);
    if (!existsSync(local)) continue;
    execFileSync(
      "gcloud",
      ["storage", "cp", local, `${BUCKET}/${id}.${version}.${ext}`, `--content-type=${type}`, "--cache-control=public, max-age=31536000, immutable"],
      { stdio: ["ignore", "ignore", "inherit"] },
    );
  }
  console.log(`✓ ${id}.${version}`);
}
