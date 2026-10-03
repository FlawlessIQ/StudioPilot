# Being found by name: "StudioCue" / "Studio Cue" (2026-10-03)

Goal: a search for **StudioCue** or **studio cue** shows studio-cue.com first,
with our name, logo and pages.

## Where we started

- **Barely indexed.** Search Console (property since 2026-08-04, sitemap
  read 2026-09-26) had 3 pages indexed and 6 "discovered, not indexed";
  `/about`, `/pricing` and the journey page were unknown to Google.
- **"studio cue" is taken by audio gear.** Results are recording-studio cue
  systems (Radial Studio-Q, cue mixers). We win that query by being a
  well-defined *entity* named StudioCue, with links and profiles pointing at
  it — not by repeating the words.
- **`www.studio-cue.com` doesn't resolve** (no DNS record), so anyone who
  types www gets an error, and links to www are wasted.
- **`studiocue.com` (no hyphen) is a parked domain**, registered 2026-04-15
  at Dynadot, redirecting to a for-sale lander. Most people will type it.
- **The App Hosting address served a duplicate of every page.**
- Good already: unique titles and descriptions, canonical URLs, sitemap,
  robots, social cards per page, FAQ and video structured data, fast static
  pages, ~40 indexable how-to guides.

## Done in code (live)

| | |
|---|---|
| **Brand entity** | Organization + WebSite + SoftwareApplication JSON-LD on `/`: name *StudioCue*, alternateName *Studio Cue*, logo, description, price range. This is what Google uses for the site name, the logo in results and a future knowledge panel. `components/seo/brand-schema.tsx` |
| **About page** | `/about` — what StudioCue is ("sometimes written Studio Cue"), who it's for, how it was built. Linked from every footer, in the sitemap. |
| **Duplicate host** | `*.hosted.app` now answers `X-Robots-Tag: noindex`. |
| **Privacy** | `/share`, `/reply`, `/d` (private token links) disallowed and noindex, like `/i`. |
| **Support page** | canonical + a real description. |
| **AI search** | `/llms.txt` — a plain summary for ChatGPT/Perplexity/Claude-style search. |
| **Bing & co.** | IndexNow key + `scripts/seo/indexnow.ts`; every sitemap URL submitted. Run it after each rollout that adds pages. |

## What needs you (in order of impact)

1. ~~**Google Search Console**~~ — done 2026-10-03: domain property
   verified, sitemap resubmitted, indexing requested for `/`, `/about`,
   `/features`, `/pricing`, `/wedding-photographers`,
   `/how-to/wedding-journey`. Request more (≈10 a day) from URL Inspection.
2. **Bing Webmaster Tools** — sign in at bing.com/webmasters → **Import from Google Search Console** (one click). Bing also feeds DuckDuckGo, Yahoo and ChatGPT search.
3. ~~**Fix `www`**~~ — done 2026-10-03: proxied `CNAME www → studio-cue.com`
   + redirect rule `*://www.studio-cue.com/*` → `https://studio-cue.com/${2}`
   (301, query kept). Verified with curl.
4. ~~**`studiocue.com`**~~ — deferred 2026-10-03: listed at ~$3k on
   GoDaddy; not worth it before revenue. Revisit once paying. Search for the
   name doesn't depend on it; only people typing the address do.
5. **Profiles that say "StudioCue" and link to studio-cue.com** — each one is a vote for the entity. Then send me the URLs and I'll add them to `BRAND_SAME_AS`:
   - **YouTube channel "StudioCue"**: upload the 6-minute film, the COI video and the how-to videos (titles start with "StudioCue — …", description links to studio-cue.com). YouTube results show up for brand searches.
   - **LinkedIn company page**, **Instagram** (post the vertical clips), **Facebook page**, **X**.
   - **Product Hunt** launch when ready.
   - **Capterra / G2 / GetApp** listings (free; Capterra ranks for "photography studio software").
6. **Links from real sites** — GR Productions' site linking "Run with StudioCue" to studio-cue.com is worth more than any directory. Any photography community post, podcast or blog that mentions StudioCue with a link helps.
7. **Google Business Profile** — only if StudioCue has a business address to list; optional for software.

## What to expect

- Once submitted (steps 1–2), **"StudioCue"** should show studio-cue.com first within days to a couple of weeks — the name is unique.
- **"studio cue"** (two words) competes with years of audio-gear pages. It typically follows within weeks once Google has the entity (the structured data's alternateName), a few profiles (step 5) and a few real links (step 6). There's no way to force it faster; these are the levers.
- Track it in Search Console → Performance → Queries.
