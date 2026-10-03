/**
 * Tells Bing (and the other IndexNow engines: Yandex, Seznam, Naver) that
 * studio-cue.com's pages exist or changed, so they're crawled within hours
 * instead of whenever a crawler wanders by. Google doesn't take IndexNow;
 * for Google, submit the sitemap in Search Console.
 *
 *   npx tsx scripts/seo/indexnow.ts            # every URL in the live sitemap
 *   npx tsx scripts/seo/indexnow.ts /about /   # just these paths
 *
 * Run after a rollout that adds or changes public pages. The key is the file
 * public/<key>.txt, which proves the site is ours.
 */
import { readdirSync } from "node:fs";
import path from "node:path";

const SITE = "https://studio-cue.com";
const key = readdirSync(path.join(process.cwd(), "public"))
  .find((file) => /^[0-9a-f]{32}\.txt$/.test(file))
  ?.replace(/\.txt$/, "");
if (!key) throw new Error("No IndexNow key file in public/.");

const paths = process.argv.slice(2);
const urls = paths.length
  ? paths.map((p) => `${SITE}${p.startsWith("/") ? p : `/${p}`}`)
  : [...(await (await fetch(`${SITE}/sitemap.xml`)).text()).matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1]!);

const keyCheck = await fetch(`${SITE}/${key}.txt`);
if (!keyCheck.ok || (await keyCheck.text()).trim() !== key) throw new Error(`${SITE}/${key}.txt isn't live yet: roll out first.`);

const response = await fetch("https://api.indexnow.org/indexnow", {
  method: "POST",
  headers: { "content-type": "application/json; charset=utf-8" },
  body: JSON.stringify({ host: "studio-cue.com", key, keyLocation: `${SITE}/${key}.txt`, urlList: urls }),
});
console.log(`IndexNow: ${response.status} ${response.statusText} for ${urls.length} URLs`);
if (response.status >= 400) process.exit(1);
