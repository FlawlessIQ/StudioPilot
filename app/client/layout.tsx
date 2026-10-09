import "@/app/app-styles";
import type { Metadata } from "next";
import { PortalShell } from "@/components/layout/portal-shell";

/**
 * The couple's tab used to inherit the root title, "StudioCue · Photography
 * Operations OS" — the B2B positioning, shown to a client looking at their own
 * wedding. The portal is branded to the studio everywhere else on the page.
 *
 * Not "Your photography project" either: the same portal serves a DJ's,
 * a makeup artist's and a hair stylist's clients, and this title is fixed at
 * build time, before anyone knows whose client is looking.
 */
export const metadata: Metadata = {
  title: {
    default: "Your project",
    template: "%s · Your project",
  },
};

export default function ClientLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <PortalShell>{children}</PortalShell>;
}
