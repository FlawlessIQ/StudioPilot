"use client";

import type { ReactNode } from "react";
import { StudioDomainPage } from "@/components/studio/live-domain-view";
import { useWorkspace } from "@/features/auth/workspace-context";
import { newPackageIntro, packagesPageDescription } from "@/components/crm/package-copy";

/**
 * The Packages list, described in the studio's own trade (package-copy.ts).
 * The route is a server component and the trade is the workspace's, so the
 * page hands its notice in and this reads the trade.
 */
export function PackagesDomainPage({ beforeContent }: { beforeContent?: ReactNode }) {
  const trade = useWorkspace().tenantTrade;
  return (
    <StudioDomainPage
      domain="packages"
      eyebrow="Catalog"
      title="Packages"
      description={packagesPageDescription(trade)}
      action={{ href: "/studio/packages/new", label: "Create package" }}
      beforeContent={beforeContent}
    />
  );
}

/** "Create a package", introduced in the studio's own trade. */
export function NewPackageIntro() {
  return <p>{newPackageIntro(useWorkspace().tenantTrade)}</p>;
}
