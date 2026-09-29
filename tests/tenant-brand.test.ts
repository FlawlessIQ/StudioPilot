import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolveTenantBrand, safeBrandColor, safeLogoUrl } from "@/features/branding/tenant-brand";
import { contrastRatio, portalAccentStyle } from "@/features/design/studio-theme";

/**
 * Couples and crew see the studio's brand, not StudioCue's (decided
 * 2026-09-28; M1 of docs/mobile-first-client-crew-plan-2026-09-28.md).
 */
const source = (path: string) => readFileSync(`${process.cwd()}/${path}`, "utf8");

test("Settings → Branding wins, older fields still count", () => {
  const settings = resolveTenantBrand({
    brandName: "FlawlessIQ",
    businessName: "FlawlessIQ LLC",
    emailBranding: { primaryColor: "#7c2f3b", logoUrl: "https://cdn.example/logo.png" },
    brandColors: { primary: "#111111" },
    logoUrl: "https://cdn.example/old.png",
  });
  assert.deepEqual(settings, {
    brandName: "FlawlessIQ",
    primaryColor: "#7C2F3B",
    logoUrl: "https://cdn.example/logo.png",
  });

  const legacy = resolveTenantBrand({
    businessName: "GR Productions",
    brandColors: { primary: "#345c46" },
    logo: "https://cdn.example/gr.png",
  });
  assert.equal(legacy.brandName, "GR Productions");
  assert.equal(legacy.primaryColor, "#345C46");
  assert.equal(legacy.logoUrl, "https://cdn.example/gr.png");

  assert.deepEqual(resolveTenantBrand(null, "Your studio"), {
    brandName: "Your studio",
    primaryColor: null,
    logoUrl: null,
  });
});

test("only a real colour and an https logo get through", () => {
  assert.equal(safeBrandColor("#abc"), "#AABBCC");
  for (const bad of ["red", "#12345", "javascript:alert(1)", "", null, 7]) {
    assert.equal(safeBrandColor(bad), null, String(bad));
  }
  assert.equal(safeLogoUrl("https://cdn.example/a.png"), "https://cdn.example/a.png");
  for (const bad of ["http://cdn.example/a.png", "javascript:alert(1)", "data:image/png;base64,AA", "logo.png", ""]) {
    assert.equal(safeLogoUrl(bad), null, bad);
  }
});

test("the functions copy of the brand resolver matches features/", () => {
  const body = (path: string) => {
    const text = source(path);
    return text.slice(text.indexOf("export type TenantBrand = {"));
  };
  assert.equal(
    body("functions/src/branding/tenant-brand.ts"),
    body("features/branding/tenant-brand.ts"),
  );
});

/**
 * The client invitation page read only `brandAccentColor` and `logoUrl`, so a
 * logo saved in Settings → Branding (emailBranding.logoUrl) never reached it.
 */
test("both invitation previews resolve the brand the same way as everything else", () => {
  const client = source("functions/src/client/invitations.ts");
  assert.match(client, /resolveTenantBrand\(tenant\.data\(\)/);
  assert.match(client, /brandLogoUrl: brand\.logoUrl/);
  assert.doesNotMatch(client, /safeLogoUrl\(tenant\.get\("logoUrl"\)\)/);
  const crew = source("functions/src/crew/invitations.ts");
  assert.match(crew, /resolveTenantBrand\(tenant\.data\(\)/);
  assert.match(crew, /brandLogoUrl: brand\.logoUrl/);
});

test("the couple and crew portals show the studio, credited to StudioCue once", () => {
  for (const shell of ["components/layout/portal-shell.tsx", "components/crew/crew-portal-shell.tsx"]) {
    const text = source(shell);
    assert.doesNotMatch(text, /Studio<b>Cue<\/b>/, `${shell} still shows the StudioCue wordmark`);
    assert.doesNotMatch(text, /<CueMark/, shell);
    assert.match(text, /<StudioBrand brand=\{workspace\.tenantBrand\} \/>/, shell);
    assert.match(text, /portalAccentStyle\(workspace\.tenantBrand\?\.primaryColor\)/, shell);
    assert.match(text, /<PoweredByStudioCue \/>/, shell);
  }
  assert.match(source("features/auth/workspace-context.tsx"), /tenantBrand: resolveTenantBrand\(tenant\)/);
});

/** Emerald's accent failed AA under white text; the portal accent now comes from the clamped theme. */
test("the portal accent reads under white text", () => {
  assert.ok(contrastRatio("#0ea372", "#FFFFFF") < 4.5, "the old emerald accent did fail");
  for (const color of [null, "#0ea372", "#F2B8C6", "#7C2F3B"]) {
    const accent = portalAccentStyle(color)["--ds-claret"]!;
    assert.ok(contrastRatio(accent, "#FFFFFF") >= 4.5, `${color} → ${accent}`);
  }
});

test("the inquiry page is headed by the studio, not StudioCue", () => {
  const page = source("app/inquiry/page.tsx");
  const form = page.slice(page.indexOf('<main className="inquiry-page">'));
  assert.doesNotMatch(form, /<Logo \/>/);
  assert.match(form, /<StudioMark/);
  assert.match(form, /preview === "studio" \? \(\s*<Link href=\{backLink\.href\}>/);
});
