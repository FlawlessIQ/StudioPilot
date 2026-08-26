import type { Metadata } from "next";
import { CrewPortalShell } from "@/components/crew/crew-portal-shell";

/**
 * The client portal got its own title in the copy pass and crew did not, so a
 * subcontractor's tab still read "StudioCue · Photography Operations OS". Less
 * jarring than it was for a couple — crew are a professional audience — but the
 * two portals should not disagree about this.
 */
export const metadata: Metadata = {
  title: {
    default: "Your assignments",
    template: "%s · Your assignments",
  },
};

export default function CrewLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <CrewPortalShell>{children}</CrewPortalShell>;
}
