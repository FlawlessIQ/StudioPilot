import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { NATIVE_SIGNING_GENERALLY_AVAILABLE } from "@/features/contracts/rollout";
import { isOfferedProvider } from "@/features/integrations/schema";

/**
 * What the public site says about the product, held to the code that decides
 * it (docs/marketing-video-onboarding-plan-2026-10-02.md §0).
 *
 * Each claim here was wrong on the site at some point: e-sign "coming soon"
 * after it shipped, SMS billed as an extra when no SMS exists, "Most popular"
 * on a plan with no customers, and every "See it in StudioCue" link opening a
 * static mock with the old navigation. When the mechanism changes, the test
 * that fails says which page to rewrite.
 */
const read = (path: string) => readFileSync(path, "utf8");
/** Strings and JSX text, roughly: the source without its comments. */
const copy = (path: string) =>
  read(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

const MARKETING = [
  "app/page.tsx",
  "app/pricing/page.tsx",
  "app/integrations/page.tsx",
  "app/features/page.tsx",
  "app/wedding-photographers/page.tsx",
  "app/corporate-photographers/page.tsx",
  "app/sports-photographers/page.tsx",
  "app/for-clients/page.tsx",
  "app/for-crew/page.tsx",
  "components/marketing/marketing-layout.tsx",
  "components/marketing/studio-proof.tsx",
];

test("signing online in StudioCue is claimed only while it is on for every studio", () => {
  const claims = MARKETING.filter((path) => /sign(?:ed)? online|Signing, built in/i.test(copy(path)));
  assert.ok(claims.length > 0, "nothing says agreements are signed online any more — drop this check");
  assert.equal(
    NATIVE_SIGNING_GENERALLY_AVAILABLE,
    true,
    `native signing is no longer on for everyone; rewrite the signing claims in ${claims.join(", ")}`,
  );
  const integrations = copy("app/integrations/page.tsx");
  assert.doesNotMatch(integrations, /title: "E-signature",\s*badge: "Coming soon"/, "e-sign is live, not coming soon");
});

test("no signing vendor or Stripe payments are offered on the site while the product hides them", () => {
  for (const [provider, name] of [
    ["docusign", /docusign/i],
    ["dropbox_sign", /dropbox sign/i],
    ["stripe", /\bstripe\b/i],
  ] as const) {
    if (isOfferedProvider(provider)) continue;
    for (const path of MARKETING)
      assert.doesNotMatch(
        copy(path),
        name,
        `${path} names ${provider}, which a studio cannot connect (features/integrations/schema.ts offeredProviders)`,
      );
  }
});

test("pricing bills nothing that does not exist", () => {
  // No SMS send path exists; the integrations page lists it as coming soon.
  for (const path of ["app/pricing/page.tsx", "app/page.tsx"]) assert.doesNotMatch(copy(path), /\bSMS\b/, path);
});

test("no plan is called popular before anyone has bought one", () => {
  for (const path of ["app/pricing/page.tsx", "app/page.tsx"]) {
    assert.doesNotMatch(copy(path), /Most popular|Best for teams/, path);
  }
});

test("the stale product mock is gone and nothing links to it", () => {
  assert.ok(!existsSync("app/studio-preview"), "app/studio-preview is back");
  assert.match(
    read("next.config.ts"),
    /source: "\/studio-preview", destination: "\/how-to\/wedding-journey", permanent: true/,
    "/studio-preview should redirect to the journey page",
  );
  for (const path of [...MARKETING, "app/sitemap.ts"])
    assert.doesNotMatch(read(path), /\/studio-preview|Product tour|Explore the live product/, path);
});

test("GR Productions is quoted only with the words Gabriel said", () => {
  const proof = copy("components/marketing/studio-proof.tsx");
  const quotes = proof.match(/&ldquo;([^&]+)&rdquo;/g) ?? [];
  assert.deepEqual(quotes, ["&ldquo;I review it and send it.&rdquo;"], "a new quote needs Gabriel's approval first");
});

test("every link to a stage of the journey page names a real stage", async () => {
  const { EXPECTED_TIMELINE } = await import("@/features/journey/expected-timeline");
  const ids = new Set(EXPECTED_TIMELINE.map((stage) => stage.id));
  const linked = [...MARKETING, "app/how-to/page.tsx"].flatMap((path) =>
    [...read(path).matchAll(/journeyStageHref\("([^"]+)"\)|#stage-([a-z-]+)/g)].map((match) => ({
      path,
      id: match[1] ?? match[2],
    })),
  );
  assert.ok(linked.length > 0, "no stage links left — drop this check");
  for (const { path, id } of linked) assert.ok(ids.has(id), `${path} links to #stage-${id}, which the page doesn't have`);
});
