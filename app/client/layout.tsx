import type { Metadata } from "next";
import { PortalShell } from "@/components/layout/portal-shell";

/**
 * The couple's tab used to inherit the root title, "StudioCue · Photography
 * Operations OS" — the B2B positioning, shown to a client looking at their own
 * wedding. The portal is branded to the studio everywhere else on the page.
 */
export const metadata: Metadata = {
  title: {
    default: "Your photography project",
    template: "%s · Your photography project",
  },
};

export default function ClientLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <PortalShell>{children}</PortalShell>;
}
