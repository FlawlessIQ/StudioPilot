"use client";

import type { TenantBrand } from "@/features/branding/tenant-brand";

/**
 * The studio's mark in a couple's or crew member's portal: its logo, or its
 * initial on its colour, beside its name. The portals used to show
 * StudioCue's mark and wordmark; couples are buying from the studio
 * (docs/mobile-first-client-crew-plan-2026-09-28.md). StudioCue is credited
 * once, quietly, under the navigation.
 */
export function StudioBrand({ brand }: { brand: TenantBrand | null | undefined }) {
  const name = brand?.brandName ?? "Your studio";
  return (
    <>
      <span className="ds-brand-mark ds-studio-mark" aria-hidden="true">
        {brand?.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- a studio's uploaded logo
          <img alt="" src={brand.logoUrl} />
        ) : (
          name.trim().charAt(0).toUpperCase() || "S"
        )}
      </span>
      <span className="ds-brand-word ds-studio-name">{name}</span>
    </>
  );
}

export function PoweredByStudioCue() {
  return <p className="ds-powered-by">Powered by StudioCue</p>;
}
